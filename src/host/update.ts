/**
 * 版本比较与"有没有新版"的查询。
 *
 * 为什么放在**宿主**而不是客户端直接 fetch：客户端那侧要过 CORS / 可能的 CSP 和桌面端
 * 网络策略，宿主本来就是普通 Node，顺便还能做超时与缓存。只读 GET，没有任何副作用。
 * 这也是插件**唯一**的外发请求，别在别处再加。
 */
import { messageOf } from "./fs-utils.js";
import { LOCAL_VERSION, PLUGIN_NAME } from "./manifest.js";
import type { UpdateInfo } from "../shared/protocol.js";

const UPDATE_REGISTRY = "https://registry.npmjs.org";
/** 10 分钟内复用上次结果：打开配置页不该每次都打 registry。 */
const UPDATE_TTL_MS = 10 * 60 * 1000;
const UPDATE_TIMEOUT_MS = 5000;

let updateCache: { at: number; value: UpdateInfo } | null = null;

/**
 * 宽松 semver 比较：只按数字段比，带 prerelease 后缀的算更低
 * （`0.1.1` > `0.1.1-rc.1`，`0.2.0` > `0.1.9`）。够判断"有没有新版"，不引依赖。
 * 导出是为了让 `scripts/smoke.mjs` 直接单测它（浏览器里用不到）。
 */
export function compareVersions(left: string, right: string): number {
	const parse = (value: string) => {
		const [core, ...rest] = String(value).replace(/^v/, "").split("-");
		return { parts: (core ?? "").split(".").map((part) => Number.parseInt(part, 10) || 0), prerelease: rest.length > 0 };
	};
	const a = parse(left);
	const b = parse(right);
	for (let index = 0; index < Math.max(a.parts.length, b.parts.length); index += 1) {
		const difference = (a.parts[index] ?? 0) - (b.parts[index] ?? 0);
		if (difference !== 0) return difference > 0 ? 1 : -1;
	}
	if (a.prerelease === b.prerelease) return 0;
	return a.prerelease ? -1 : 1;
}

export async function checkForUpdate(force?: boolean): Promise<UpdateInfo> {
	const now = Date.now();
	if (force !== true && updateCache !== null && now - updateCache.at < UPDATE_TTL_MS) return updateCache.value;
	const base: UpdateInfo = { current: LOCAL_VERSION, latest: null, outdated: false, checkedAt: now };
	let value: UpdateInfo;
	try {
		const response = await fetch(`${UPDATE_REGISTRY}/${PLUGIN_NAME}/latest`, {
			headers: { accept: "application/json" },
			signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS)
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const body: unknown = await response.json();
		const version = (body as { version?: unknown } | null)?.version;
		const latest = typeof version === "string" && version !== "" ? version : null;
		if (latest === null) throw new Error("registry 没有返回 version 字段");
		value = {
			...base,
			latest,
			outdated: LOCAL_VERSION !== null && compareVersions(latest, LOCAL_VERSION) > 0,
			checkedAt: Date.now()
		};
	} catch (error) {
		// 离线 / 超时 / 代理不通都走这里：界面照常显示版本号，只是没有更新提示。
		value = { ...base, error: messageOf(error) };
	}
	updateCache = { at: Date.now(), value };
	return value;
}

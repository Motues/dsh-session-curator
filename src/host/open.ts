/**
 * 「复制路径 / 在资源管理器中显示」的宿主侧：**只认自己算出来的目录**。
 *
 * 安全边界（这一段是这个文件存在的全部理由）：
 *   - 路径**不接受客户端传**：只吃 `sessionId`，由宿主自己按 `<DSH_HOME>/sessions/<slug>/<id>`
 *     拼出来。客户端就算传了别的路径也没用 —— 入参里根本没有路径字段。
 *   - 拼出来之后再 `resolve()` 一次并断言它落在**允许的根**（`<DSH_HOME>/sessions`）
 *     之下。这一道是为了挡住 `../` 之类的 id（线协议的 `idsOf()` 只保证是
 *     非空字符串，不保证它不是一个相对路径）。
 *   - 只有 `target: "reveal"` 才会真的去叫系统文件管理器，而且只用**固定的可执行名**
 *     （`explorer.exe` / `open` / `xdg-open`），参数是那个已经校验过的目录。不拼 shell 字符串，
 *     走 `spawn` + 参数数组，所以路径里的空格 / 引号 / `&` 都不会被解释成命令。
 *
 * 为什么不用 `shell.openPath`（Electron 的 API）：宿主半区跑在 DSH 的 Electron 主进程里，
 * 但插件是普通 ESM 模块，拿不到 `electron` 模块（那是 DSH 自己的依赖，junction 挂载下
 * Node 按 realpath 解析根本找不到 —— 与 AGENTS.md §5 禁止裸导入 `@deepseek-ai/*` 同一条
 * 理由）。所以这里退到"用平台自带的文件管理器命令"，零依赖。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { messageOf } from "./fs-utils.js";
import { sessionsRoot } from "./paths.js";
import type { SessionDirInfo } from "./session-manager.js";
import type { OpenResult, OpenTarget } from "../shared/protocol.js";

/** 打开目录需要的管理器能力（只要"这个 id 的目录在哪"这一个事实）。 */
export interface OpenHost {
	scanSessionDirs(): Promise<Map<string, SessionDirInfo>>;
}

/** `path` / `reveal`：`reveal` 之外的任何值都当成 `path`（只读，最保守的那条）。 */
export function openTargetOf(value: unknown): OpenTarget {
	return value === "reveal" ? "reveal" : "path";
}

/**
 * 允许的根：整个会话目录。`resolve()` 之后比较，且要求"相等或以 `<root>+分隔符`
 * 开头" —— 单比 `startsWith(root)` 会把 `<DSH_HOME>/sessions-evil` 放进来。
 */
function allowedRoots(): string[] {
	return [resolve(sessionsRoot())];
}

function inside(root: string, target: string): boolean {
	return target === root || target.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** 平台对应的文件管理器命令；不支持的平台返回 null（`path` 仍然可用）。 */
function revealCommand(): { command: string; args: string[] } | null {
	if (process.platform === "win32") return { command: "explorer.exe", args: [] };
	if (process.platform === "darwin") return { command: "open", args: [] };
	if (process.platform === "linux") return { command: "xdg-open", args: [] };
	return null;
}

/**
 * 把文件管理器叫起来。**不等它退出**：`explorer.exe` 会立刻返回、`xdg-open` 可能一直活着，
 * 等它就会把端点请求挂住。所以 `detached` + `stdio: "ignore"` + `unref()`，
 * 只监听 `error`（命令不存在那种）；真正"有没有打开"由用户自己看得到。
 */
function reveal(path: string): { ok: true } | { ok: false; reason: string } {
	const command = revealCommand();
	if (command === null) return { ok: false, reason: `不支持的平台：${process.platform}` };
	try {
		const child = spawn(command.command, [...command.args, path], { detached: true, stdio: "ignore" });
		child.on("error", () => {
			// 没有文件管理器（无头环境）不该让请求失败：路径已经回了，界面提示用户手动打开。
		});
		child.unref();
		return { ok: true };
	} catch (error) {
		return { ok: false, reason: messageOf(error) };
	}
}

/**
 * `open` 端点：算路径 → 校验 → （可选）叫文件管理器。
 *
 * `sessionId` 必须能在磁盘上找到；找不到就抛错，由信封兜住（与 `describe` 一致）。
 */
export async function openSession(host: OpenHost, ids: string[], target: OpenTarget): Promise<OpenResult> {
	const sessionId = ids[0];
	if (typeof sessionId !== "string" || sessionId === "") throw new Error("缺少会话 id");

	const dirs = await host.scanSessionDirs();
	const path = dirs.get(sessionId)?.dir ?? null;
	if (path === null) throw new Error("找不到这个会话的日志目录（磁盘上不存在）");

	const resolved = resolve(path);
	const roots = allowedRoots();
	if (!roots.some((root) => inside(root, resolved))) {
		// 到不了这里才说明 id 里有 `../` 之类的东西 —— 直接拒绝，别去碰根目录外面的路径。
		throw new Error("拒绝打开：这个路径不在 DSH 的会话目录里");
	}
	if (!existsSync(resolved)) throw new Error("日志目录已经不在了");

	if (target !== "reveal") return { sessionId, path: resolved, revealed: false };
	const opened = reveal(resolved);
	return opened.ok
		? { sessionId, path: resolved, revealed: true }
		: { sessionId, path: resolved, revealed: false, reason: opened.reason };
}

/** 允许的根（导出给自检断言"路径校验真的挡得住 `../`"）。 */
export { allowedRoots, inside as insideRoot };

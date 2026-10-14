/**
 * 单个会话事实的**带缓存**读取（`describe` 端点），供侧边栏 hover 卡片用。
 *
 * 为什么要缓存：DSH 的 hover 卡片在指针停留 800ms 后打开，**每次划过都会开一次**；
 * 宿主的 `describe` 要 `listTrash()` + `scanSessionDirs()`（两个 readdir 树 + 每条目
 * `stat`）。不缓存就是"鼠标扫过侧边栏 = 几百次目录扫描"。
 *
 * 失效策略两层：
 *   1. 插件自己的写操作（`mutationStore` 自增）→ 立刻清空 —— 用户刚归档 / 删除完，
 *      再划回去必须看到新状态；
 *   2. TTL（30s）→ 兜住"别人改的"（DSH 自己归档、别的窗口删除）与会话日志在跑时不断
 *      长大的体积。两者取先到者。
 *
 * 并发去重也在这里：同一 id 的多次 hover 只发一个请求（`inflight`）。
 */
import { call } from "./api.js";
import { mutationStore } from "./dialog.js";
import type { SessionDetail } from "../shared/protocol.js";

/** 缓存多久算旧（毫秒）。够短，用户划回来时不会看到明显过期的体积。 */
const TTL_MS = 30_000;

interface CacheEntry {
	at: number;
	value: SessionDetail;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<SessionDetail>>();
let watching = false;

/** 清空缓存（`mutationStore` 自增时自动调用；自检也直接用它造确定的初始状态）。 */
export function forgetDetails(): void {
	cache.clear();
}

/** 第一次用到时挂上"写操作即失效"的订阅；模块只挂一次。 */
function watchMutations(): void {
	if (watching) return;
	watching = true;
	mutationStore.subscribe(forgetDetails);
}

/** 读一个会话的事实；走缓存 / 并发去重，失败时抛给调用方（hover 卡片自己降级）。 */
export async function describeSession(sessionId: string): Promise<SessionDetail> {
	watchMutations();
	const cached = cache.get(sessionId);
	if (cached !== undefined && Date.now() - cached.at < TTL_MS) return cached.value;
	const running = inflight.get(sessionId);
	if (running !== undefined) return running;
	const request = call<SessionDetail>("describe", { ids: [sessionId] })
		.then((value) => {
			cache.set(sessionId, { at: Date.now(), value });
			return value;
		})
		.finally(() => {
			inflight.delete(sessionId);
		});
	inflight.set(sessionId, request);
	return request;
}

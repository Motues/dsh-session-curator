/** 文件系统小工具 + 错误消息归一化。 */
import { promises as fsp } from "node:fs";
import { dirname, join } from "node:path";

/** 任何抛出物 → 一句人话（宿主 logger 与端点错误信封都用它）。 */
export function messageOf(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

/**
 * 最多 `limit` 个任务同时在跑；返回值**按入参顺序**排列。
 *
 * 为什么不用 `Promise.all(items.map(...))`：快照要一次给上百个目录做 `readdir` + `stat`，
 * 无上限并发会把磁盘打成一锅粥（Windows 上尤其明显，还会跟 DSH 自己的会话扫描抢 IO）。
 * 这里只做"有上限的并发"，超出的任务排队，单项抛错照原样往外冒（由调用方决定怎么办）。
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const size = items.length;
	const results: R[] = new Array(size);
	if (size === 0) return results;
	const width = Math.max(1, Math.min(Math.floor(limit) || 1, size));
	let next = 0;
	const run = async (): Promise<void> => {
		while (next < size) {
			const index = next;
			next += 1;
			results[index] = await worker(items[index] as T, index);
		}
	};
	await Promise.all(Array.from({ length: width }, run));
	return results;
}

/** 跨卷 rename 会抛 EXDEV，退回 copy + rm。 */
export async function moveDir(from: string, to: string): Promise<void> {
	await fsp.mkdir(dirname(to), { recursive: true });
	try {
		await fsp.rename(from, to);
		return;
	} catch (error) {
		if ((error as NodeJS.ErrnoException | null)?.code !== "EXDEV") throw error;
	}
	await fsp.cp(from, to, { recursive: true, force: true });
	await fsp.rm(from, { recursive: true, force: true });
}

export interface DirStats {
	bytes: number;
	files: number;
}

/**
 * 体积统计的**模块级缓存**：`目录 → { mtime, bytes, files }`。
 *
 * 为什么要缓存：一次快照要对每个归档 / 置顶 / 回收站会话做一次目录遍历（`readdir` +
 * 每条目一次 `stat`），而快照在每次变更、每次刷新、每次切页签后都会重算 —— 同一个目录
 * 在一次会话里会被反复统计，内容却根本没变。
 *
 * 失效判据是**目录自身的 mtime**：只统计顶层文件，而会话目录里只会新增 / 删除条目
 *（日志滚动、`__projcache.json` 搬进搬出），这两件事都会改目录 mtime。缓存里存的就是
 * 拿到这份统计时的 mtime，`dirStats()` 每次先 `stat` 一次目录，对不上就重新遍历。
 *
 * 除了 mtime 还比一次**条目数**（`readdir` 本来就要做，等于白送）：Windows 上目录 mtime
 * 的更新是异步落盘的 —— 刚写完一个文件、紧接着 `stat` 目录，mtime 可能还是旧的
 *（实测 `writeFile` 之后立刻 `stat` 拿到的是旧值，几毫秒后才变）。只比 mtime 的话，
 * 那个窗口里会把"刚加了文件"的目录当成没变。条目数对不上就重算，这个窗口就补上了。
 *
 * 注意这句"先 stat 一次"是**必要成本**，不是浪费：`readdir` 本身不给 mtime，而只比
 * 文件数/名字不足以判失效（同名的 `session.jsonl` 会被原地追加，名字和条数都不变，
 * 目录 mtime 也不变 —— 那种情况下我们保留旧值，偏差只可能"偏小"，且要等下一次目录增删
 * 才修正；这就是用 mtime 而非内容哈希的代价，换来的是不必读一遍全部日志）。
 */
interface CachedDirStats extends DirStats {
	mtimeMs: number;
	/** 拿到这份统计时的顶层条目数（见上面那段"Windows 的 mtime 落盘是异步的"）。 */
	entryCount: number;
}

const DIR_STATS_CACHE = new Map<string, CachedDirStats>();
/** 缓存上限：超过就整个清掉。磁盘目录数远小于它，这里只是防止长期运行无限增长。 */
const DIR_STATS_CACHE_LIMIT = 2000;

/** 给自检用：清掉缓存后重新统计（`scripts/smoke.mjs` 要断言"同一次快照内命中缓存"）。 */
export function forgetDirStats(): void {
	DIR_STATS_CACHE.clear();
}

/** 只统计顶层文件：会话目录里就是那几份日志。目录 mtime 没变就直接回缓存。 */
export async function dirStats(dir: string): Promise<DirStats> {
	let mtimeMs: number;
	let entries;
	try {
		const info = await fsp.stat(dir);
		mtimeMs = info.mtimeMs;
		entries = await fsp.readdir(dir, { withFileTypes: true });
	} catch {
		return { bytes: 0, files: 0 };
	}
	const cached = DIR_STATS_CACHE.get(dir);
	if (cached !== undefined && cached.mtimeMs === mtimeMs && cached.entryCount === entries.length) {
		return { bytes: cached.bytes, files: cached.files };
	}
	let bytes = 0;
	let files = 0;
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		try {
			const stat = await fsp.stat(join(dir, entry.name));
			bytes += stat.size;
			files += 1;
		} catch {
			// 竞态：文件刚好消失，忽略
		}
	}
	if (DIR_STATS_CACHE.size >= DIR_STATS_CACHE_LIMIT) DIR_STATS_CACHE.clear();
	DIR_STATS_CACHE.set(dir, { mtimeMs, entryCount: entries.length, bytes, files });
	return { bytes, files };
}

/**
 * 会话投影缓存里的元数据：标题 / cwd / 创建时间。缺文件或字段不符时回空字段
 * （调用方各自决定退到什么）。`storages/session_projcache/sessions/<id>.json`。
 */
export interface Projection {
	title: string | null;
	cwd: string | null;
	createdAt: number | null;
}

export async function readProjectionFile(file: string): Promise<Projection> {
	try {
		const parsed = JSON.parse(await fsp.readFile(file, "utf8"));
		const rows = parsed?.record?.rows;
		const identity = parsed?.record?.identity;
		const title = rows?.title?.val;
		return {
			title: typeof title === "string" && title !== "" ? title : null,
			cwd: typeof identity?.cwd === "string" ? identity.cwd : null,
			createdAt: typeof identity?.createdAt === "number" ? identity.createdAt : null
		};
	} catch {
		return { title: null, cwd: null, createdAt: null };
	}
}

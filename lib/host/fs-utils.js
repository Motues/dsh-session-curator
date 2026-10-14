/** 文件系统小工具 + 错误消息归一化。 */
import { promises as fsp } from "node:fs";
import { dirname, join } from "node:path";
/** 任何抛出物 → 一句人话（宿主 logger 与端点错误信封都用它）。 */
export function messageOf(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
/**
 * 最多 `limit` 个任务同时在跑；返回值**按入参顺序**排列。
 *
 * 为什么不用 `Promise.all(items.map(...))`：快照要一次给上百个目录做 `readdir` + `stat`，
 * 无上限并发会把磁盘打成一锅粥（Windows 上尤其明显，还会跟 DSH 自己的会话扫描抢 IO）。
 * 这里只做"有上限的并发"，超出的任务排队，单项抛错照原样往外冒（由调用方决定怎么办）。
 */
export async function mapLimit(items, limit, worker) {
    const size = items.length;
    const results = new Array(size);
    if (size === 0)
        return results;
    const width = Math.max(1, Math.min(Math.floor(limit) || 1, size));
    let next = 0;
    const run = async () => {
        while (next < size) {
            const index = next;
            next += 1;
            results[index] = await worker(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: width }, run));
    return results;
}
/** 跨卷 rename 会抛 EXDEV，退回 copy + rm。 */
export async function moveDir(from, to) {
    await fsp.mkdir(dirname(to), { recursive: true });
    try {
        await fsp.rename(from, to);
        return;
    }
    catch (error) {
        if (error?.code !== "EXDEV")
            throw error;
    }
    await fsp.cp(from, to, { recursive: true, force: true });
    await fsp.rm(from, { recursive: true, force: true });
}
const DIR_STATS_CACHE = new Map();
/** 缓存上限：超过就整个清掉。磁盘目录数远小于它，这里只是防止长期运行无限增长。 */
const DIR_STATS_CACHE_LIMIT = 2000;
/** 给自检用：清掉缓存后重新统计（`scripts/smoke.mjs` 要断言"同一次快照内命中缓存"）。 */
export function forgetDirStats() {
    DIR_STATS_CACHE.clear();
}
/** 只统计顶层文件：会话目录里就是那几份日志。目录 mtime 没变就直接回缓存。 */
export async function dirStats(dir) {
    let mtimeMs;
    let entries;
    try {
        const info = await fsp.stat(dir);
        mtimeMs = info.mtimeMs;
        entries = await fsp.readdir(dir, { withFileTypes: true });
    }
    catch {
        return { bytes: 0, files: 0 };
    }
    const cached = DIR_STATS_CACHE.get(dir);
    if (cached !== undefined && cached.mtimeMs === mtimeMs && cached.entryCount === entries.length) {
        return { bytes: cached.bytes, files: cached.files };
    }
    let bytes = 0;
    let files = 0;
    for (const entry of entries) {
        if (!entry.isFile())
            continue;
        try {
            const stat = await fsp.stat(join(dir, entry.name));
            bytes += stat.size;
            files += 1;
        }
        catch {
            // 竞态：文件刚好消失，忽略
        }
    }
    if (DIR_STATS_CACHE.size >= DIR_STATS_CACHE_LIMIT)
        DIR_STATS_CACHE.clear();
    DIR_STATS_CACHE.set(dir, { mtimeMs, entryCount: entries.length, bytes, files });
    return { bytes, files };
}
export async function readProjectionFile(file) {
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
    }
    catch {
        return { title: null, cwd: null, createdAt: null };
    }
}

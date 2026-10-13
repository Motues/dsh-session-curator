/** 文件系统小工具 + 错误消息归一化。 */
import { promises as fsp } from "node:fs";
import { dirname, join } from "node:path";
/** 任何抛出物 → 一句人话（宿主 logger 与端点错误信封都用它）。 */
export function messageOf(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
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
/** 只统计顶层文件：会话目录里就是那几份日志。 */
export async function dirStats(dir) {
    let bytes = 0;
    let files = 0;
    let entries;
    try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
    }
    catch {
        return { bytes: 0, files: 0 };
    }
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

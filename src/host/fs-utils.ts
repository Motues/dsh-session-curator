/** 文件系统小工具 + 错误消息归一化。 */
import { promises as fsp } from "node:fs";
import { dirname, join } from "node:path";

/** 任何抛出物 → 一句人话（宿主 logger 与端点错误信封都用它）。 */
export function messageOf(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
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

/** 只统计顶层文件：会话目录里就是那几份日志。 */
export async function dirStats(dir: string): Promise<DirStats> {
	let bytes = 0;
	let files = 0;
	let entries;
	try {
		entries = await fsp.readdir(dir, { withFileTypes: true });
	} catch {
		return { bytes: 0, files: 0 };
	}
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

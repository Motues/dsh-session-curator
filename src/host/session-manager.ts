/**
 * 会话管理器：**只读投影**（快照 / 标题 / 体积）+ 归档 / 置顶这类轻量变更。
 *
 * 危险操作（软删除 / 恢复 / 永久删除）在 `trash.ts` 里，那边带完整的事故注释；
 * 这里只负责把磁盘与 registry 的事实汇总成快照，以及逐项执行的框架 `each()`。
 */
import { promises as fsp } from "node:fs";
import { join } from "node:path";
import { dirStats, messageOf, readProjectionFile, type DirStats, type Projection } from "./fs-utils.js";
import { META_FILE, dshHomePath, projCacheFile, sessionsRoot, trashRoot } from "./paths.js";
import { LOCAL_VERSION } from "./manifest.js";
import { checkForUpdate } from "./update.js";
import { purgeSessions, restoreSessions, trashSessions } from "./trash.js";
import type { HostContext, WorkspaceLike, WorkspaceRegistryLike } from "./context.js";
import type { MutationResult, SessionRow, Snapshot, StepResult, TrashRow } from "../shared/protocol.js";

/** `<DSH_HOME>/sessions/<slug>/<sessionId>` 在磁盘上的位置。 */
export interface SessionDirInfo {
	dir: string;
	slug: string;
}

/** `each()` 的动作：返回值非空就记进这一项的 `steps`（给自检和排错看）。 */
export type ItemAction = (sessionId: string) => Promise<unknown>;

export class SessionManager {
	private readonly ctx: HostContext;

	constructor(ctx: HostContext) {
		this.ctx = ctx;
	}

	get registry(): WorkspaceRegistryLike {
		return this.ctx.workspaceRegistry;
	}

	// ── 只读投影 ─────────────────────────────────────────────────────────
	/** `<DSH_HOME>/sessions/<slug>/<sessionId>` → `{ dir, slug }` 索引。 */
	async scanSessionDirs(): Promise<Map<string, SessionDirInfo>> {
		const root = sessionsRoot();
		const map = new Map<string, SessionDirInfo>();
		let slugs;
		try {
			slugs = await fsp.readdir(root, { withFileTypes: true });
		} catch {
			return map;
		}
		for (const slug of slugs) {
			if (!slug.isDirectory()) continue;
			let ids;
			try {
				ids = await fsp.readdir(join(root, slug.name), { withFileTypes: true });
			} catch {
				continue;
			}
			for (const id of ids) {
				if (!id.isDirectory()) continue;
				if (!map.has(id.name)) map.set(id.name, { dir: join(root, slug.name, id.name), slug: slug.name });
			}
		}
		return map;
	}

	/** 投影缓存里的会话元数据（标题 / cwd / 创建时间）。缺文件时返回空字段。 */
	readProjection(sessionId: string): Promise<Projection> {
		return readProjectionFile(projCacheFile(sessionId));
	}

	dirStats(dir: string): Promise<DirStats> {
		return dirStats(dir);
	}

	findWorkspaceOf(sessionId: string): WorkspaceLike | undefined {
		for (const workspace of this.registry.list()) {
			const ids = workspace.sessionIds;
			if (Array.isArray(ids) && ids.includes(sessionId)) return workspace;
		}
		return undefined;
	}

	async describeSession(sessionId: string, dirs: Map<string, SessionDirInfo>): Promise<SessionRow> {
		const info = dirs.get(sessionId);
		const projection = await this.readProjection(sessionId);
		const workspace = this.findWorkspaceOf(sessionId);
		const stats = info ? await this.dirStats(info.dir) : { bytes: 0, files: 0 };
		return {
			sessionId,
			title: projection.title ?? (workspace ? workspace.title : null) ?? sessionId,
			cwd: projection.cwd ?? (workspace ? workspace.path : null),
			createdAt: projection.createdAt ?? null,
			workspaceId: workspace ? String(workspace.id) : null,
			workspaceTitle: workspace ? workspace.title : null,
			slug: info ? info.slug : null,
			onDisk: Boolean(info),
			bytes: stats.bytes,
			files: stats.files
		};
	}

	async listTrash(): Promise<TrashRow[]> {
		const root = trashRoot();
		let entries;
		try {
			entries = await fsp.readdir(root, { withFileTypes: true });
		} catch {
			return [];
		}
		const rows: TrashRow[] = [];
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const dir = join(root, entry.name);
			let meta: Record<string, unknown> | null = null;
			try {
				meta = JSON.parse(await fsp.readFile(join(dir, META_FILE), "utf8"));
			} catch {
				meta = null;
			}
			const stats = await this.dirStats(dir);
			rows.push({
				sessionId: entry.name,
				title: typeof meta?.title === "string" && meta.title !== "" ? meta.title : entry.name,
				cwd: typeof meta?.cwd === "string" ? meta.cwd : null,
				slug: typeof meta?.slug === "string" ? meta.slug : null,
				// 与 describeSession 对齐：客户端按"原来的工作区文件夹"分组要用到这两个字段。
				workspaceId: typeof meta?.workspaceId === "string" ? meta.workspaceId : null,
				workspaceTitle: typeof meta?.workspaceTitle === "string" ? meta.workspaceTitle : null,
				deletedAt: typeof meta?.deletedAt === "number" ? meta.deletedAt : 0,
				bytes: stats.bytes,
				files: stats.files,
				restorable: typeof meta?.slug === "string" && meta.slug !== ""
			});
		}
		rows.sort((left, right) => right.deletedAt - left.deletedAt);
		return rows;
	}

	/** 当前归档 / 置顶 / 回收站的完整快照，附带目录位置。 */
	async buildSnapshot(): Promise<Snapshot> {
		const registry = this.registry;
		const dirs = await this.scanSessionDirs();
		const trashed = await this.listTrash();
		// 回收站条目**只**归回收站页签。删除时我们故意让 id 留在归档集合里（那是 DSH
		// 唯一"从所有分组面消失"的机制，见 trash.ts），所以这里必须把交集滤掉：
		// 否则同一个会话会同时出现在"已归档"和"回收站"，而"已归档"那条还是没有目录的幽灵行。
		const inTrash = new Set(trashed.map((row) => row.sessionId));
		const archived: SessionRow[] = [];
		for (const sessionId of registry.archivedSessionIds) {
			// 顺带把"目录已经不在了"的 id 也滤掉：`archivedSessionIds` 是**只增不减**的记账
			//（DSH 自己的注释：目录没了的条目照样留在集合里），而 DSH 的侧边栏只从会话清单里
			// 取行 —— 这种 id 在它那边本来就不显示。列出来只会得到一条 0 B、点不动的幽灵行。
			if (inTrash.has(sessionId) || !dirs.has(sessionId)) continue;
			archived.push(await this.describeSession(sessionId, dirs));
		}
		const pinned: SessionRow[] = [];
		for (const sessionId of registry.pinnedSessionIds) {
			if (inTrash.has(sessionId) || !dirs.has(sessionId)) continue;
			pinned.push(await this.describeSession(sessionId, dirs));
		}
		let archivedBytes = 0;
		for (const row of archived) archivedBytes += row.bytes;
		let trashBytes = 0;
		for (const row of trashed) trashBytes += row.bytes;
		return {
			dshHome: dshHomePath(),
			version: LOCAL_VERSION,
			trashDir: trashRoot(),
			sessionsDir: sessionsRoot(),
			archived,
			pinned,
			trashed,
			totals: {
				archived: archived.length,
				archivedBytes,
				pinned: pinned.length,
				trashed: trashed.length,
				trashBytes
			}
		};
	}

	// ── 变更操作 ─────────────────────────────────────────────────────────
	snapshot(): Promise<Snapshot> {
		return this.buildSnapshot();
	}

	/** 逐个执行，单项失败只记录在 results 里，不影响其余项。 */
	async each(ids: string[], action: ItemAction): Promise<MutationResult> {
		const results: StepResult[] = [];
		for (const sessionId of ids) {
			try {
				const extra = await action(sessionId);
				const row: StepResult = { sessionId, ok: true };
				if (extra) row.steps = extra as string[];
				results.push(row);
			} catch (error) {
				results.push({ sessionId, ok: false, reason: messageOf(error) });
			}
		}
		return { results, ...(await this.buildSnapshot()) };
	}

	/** `stopActivity` 为 true 时先停掉会话正在跑的工作再归档。 */
	archive(ids: string[], stopActivity?: boolean): Promise<MutationResult> {
		return this.each(ids, (sessionId) => this.registry.archiveSession(sessionId, { stopActivity: Boolean(stopActivity) }));
	}

	unarchive(ids: string[]): Promise<MutationResult> {
		return this.each(ids, (sessionId) => this.registry.unarchiveSession(sessionId));
	}

	pin(ids: string[]): Promise<MutationResult> {
		return this.each(ids, (sessionId) => this.registry.pinSession(sessionId));
	}

	unpin(ids: string[]): Promise<MutationResult> {
		return this.each(ids, (sessionId) => this.registry.unpinSession(sessionId));
	}

	/** 正在跑的会话不允许删除，与官方归档同一条活动判据。 */
	async sessionActivity(sessionId: string): Promise<unknown[]> {
		try {
			const activity = await this.ctx.waterfall("workspace/session-activity", { sessionId }, () => Promise.resolve([]));
			return Array.isArray(activity) ? activity : [];
		} catch {
			return [];
		}
	}

	// ── 危险操作：实现在 trash.ts（那边有完整的事故注释） ─────────────────
	trash(ids: string[]): Promise<MutationResult> {
		return trashSessions(this, ids);
	}

	restore(ids: string[]): Promise<MutationResult> {
		return restoreSessions(this, ids);
	}

	purge(ids: string[]): Promise<MutationResult> {
		return purgeSessions(this, ids);
	}

	/** 更新检查：只读，结果在模块级缓存（见 update.ts）。 */
	checkUpdate(force?: boolean): Promise<unknown> {
		return checkForUpdate(force);
	}
}

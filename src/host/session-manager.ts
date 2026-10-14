/**
 * 会话管理器：**只读投影**（快照 / 标题 / 体积）+ 归档 / 置顶这类轻量变更。
 *
 * 危险操作（软删除 / 恢复 / 永久删除）在 `trash.ts` 里，那边带完整的事故注释；
 * 这里只负责把磁盘与 registry 的事实汇总成快照，以及逐项执行的框架 `each()`。
 */
import { promises as fsp } from "node:fs";
import { join } from "node:path";
import { dirStats, mapLimit, messageOf, readProjectionFile, type DirStats, type Projection } from "./fs-utils.js";
import { META_FILE, dshHomePath, projCacheFile, sessionsRoot, trashRoot } from "./paths.js";
import { LOCAL_VERSION } from "./manifest.js";
import { checkForUpdate } from "./update.js";
import { purgeOlderThan, purgeSessions, restoreSessions, trashSessions } from "./trash.js";
import { isExpired, retentionCutoff } from "./retention.js";
import { openSession } from "./open.js";
import type { HostContext, WorkspaceLike, WorkspaceRegistryLike } from "./context.js";
import type {
	MutationResult,
	OpenResult,
	OpenTarget,
	SessionDetail,
	SessionRow,
	Snapshot,
	StepResult,
	TrashRow,
	TrashStats,
	Usage,
	UsageGroup,
	UsageRow
} from "../shared/protocol.js";

/**
 * 文件系统侧的并发上限。快照一次要给上百个目录做 `readdir` + `stat`，串行 await 会让
 * 每次变更都慢一拍；无上限并发又会跟 DSH 自己的会话扫描抢 IO。8 是"够快且不过分"的折中。
 */
const FS_CONCURRENCY = 8;
/**
 * 活动判定的并发上限。每个会话问一次官方的 `workspace/session-activity`（瀑布钩子，
 * 可能被别的插件挂成异步 IO），所以给得比文件系统小一些。
 */
const ACTIVITY_CONCURRENCY = 4;

/** `usage` 的两个榜单各回几条（客户端的文案按同一个数字算）。 */
export const USAGE_TOP_LIMIT = 5;

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

	/**
	 * 一个会话的完整只读事实。
	 *
	 * 两件事互不依赖（投影缓存、磁盘体积），所以并发拿：单条的耗时从"两次串行 IO"
	 * 降到"最慢的那一次"。`findWorkspaceOf()` 是纯内存遍历，不必并发。
	 *
	 * `active` 由调用方注入（快照会先把整批活动判定并发算完）——`sessionActivity()` 是
	 * 瀑布钩子，逐行现问会让"有没有别的插件挂了这个钩子"直接变成列表的延迟。
	 */
	async describeSession(sessionId: string, dirs: Map<string, SessionDirInfo>, active: boolean): Promise<SessionRow> {
		const info = dirs.get(sessionId);
		const [projection, stats] = await Promise.all([
			this.readProjection(sessionId),
			info ? this.dirStats(info.dir) : Promise.resolve<DirStats>({ bytes: 0, files: 0 })
		]);
		const workspace = this.findWorkspaceOf(sessionId);
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
			files: stats.files,
			active
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
		// 每条都要读 `__trash.json` + 遍历目录：串行时条目一多就明显卡（回收站常驻几十条）。
		// 这里**故意**用最宽松的读法（坏 JSON / 缺字段 / 连版本都比插件新，都只是"字段缺失"）：
		// 一次列表不该因为某一条元数据坏了就整个炸掉。要按 schema 校验、并且会拒绝未知版本的是
		// `trash.ts` 的 `readTrashMeta()`（恢复那条路，见那边的注释）。
		const rows = await mapLimit(
			entries.filter((entry) => entry.isDirectory()),
			FS_CONCURRENCY,
			async (entry): Promise<TrashRow> => {
				const dir = join(root, entry.name);
				let meta: Record<string, unknown> | null = null;
				try {
					meta = JSON.parse(await fsp.readFile(join(dir, META_FILE), "utf8"));
				} catch {
					meta = null;
				}
				const stats = await this.dirStats(dir);
				return {
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
				};
			}
		);
		rows.sort((left, right) => right.deletedAt - left.deletedAt);
		return rows;
	}

	/** 当前归档 / 置顶 / 回收站的完整快照，附带目录位置。 */
	async buildSnapshot(): Promise<Snapshot> {
		const registry = this.registry;
		// 三个只读来源互不依赖：目录索引（哪些 id 在磁盘上）、回收站清单、registry 记账。
		const [dirs, trashed] = await Promise.all([this.scanSessionDirs(), this.listTrash()]);
		// 回收站条目**只**归回收站页签。删除时我们故意让 id 留在归档集合里（那是 DSH
		// 唯一"从所有分组面消失"的机制，见 trash.ts），所以这里必须把交集滤掉：
		// 否则同一个会话会同时出现在"已归档"和"回收站"，而"已归档"那条还是没有目录的幽灵行。
		const inTrash = new Set(trashed.map((row) => row.sessionId));
		const archivedIds: string[] = [];
		for (const sessionId of registry.archivedSessionIds) {
			// 顺带把"目录已经不在了"的 id 也滤掉：`archivedSessionIds` 是**只增不减**的记账
			//（DSH 自己的注释：目录没了的条目照样留在集合里），而 DSH 的侧边栏只从会话清单里
			// 取行 —— 这种 id 在它那边本来就不显示。列出来只会得到一条 0 B、点不动的幽灵行。
			if (inTrash.has(sessionId) || !dirs.has(sessionId)) continue;
			archivedIds.push(sessionId);
		}
		const pinnedIds: string[] = [];
		for (const sessionId of registry.pinnedSessionIds) {
			if (inTrash.has(sessionId) || !dirs.has(sessionId)) continue;
			pinnedIds.push(sessionId);
		}
		// 活动判定：两个集合一起去重问一遍（同一个 id 可能既归档又置顶）。结果既写进每行的
		// `active`，也平铺成 `activeSessionIds` 给客户端的跨页签批量用。
		const activeIds = await this.activeAmong([...new Set(archivedIds.concat(pinnedIds))]);
		// 逐条取事实：并发上限里跑，顺序仍按 registry 给的顺序（行不会整片跳位）。
		const [archived, pinned] = await Promise.all([
			mapLimit(archivedIds, FS_CONCURRENCY, (sessionId) => this.describeSession(sessionId, dirs, activeIds.has(sessionId))),
			mapLimit(pinnedIds, FS_CONCURRENCY, (sessionId) => this.describeSession(sessionId, dirs, activeIds.has(sessionId)))
		]);
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
			},
			activeSessionIds: [...activeIds]
		};
	}

	/** 一批 id 里哪些正在跑（有上限地并发问 `workspace/session-activity`）。 */
	async activeAmong(sessionIds: readonly string[]): Promise<Set<string>> {
		const flags = await mapLimit(
			sessionIds,
			ACTIVITY_CONCURRENCY,
			async (sessionId) => (await this.sessionActivity(sessionId)).length > 0
		);
		const active = new Set<string>();
		sessionIds.forEach((sessionId, index) => {
			if (flags[index] === true) active.add(sessionId);
		});
		return active;
	}

	// ── 变更操作 ─────────────────────────────────────────────────────────
	snapshot(): Promise<Snapshot> {
		return this.buildSnapshot();
	}

	/**
	 * **单个**会话的完整事实（第十个端点，侧边栏 hover 卡片用）。
	 *
	 * 入参复用 `ids`（线协议的 `idsOf()` 只接受字符串数组）：取第一条，其余忽略 ——
	 * hover 卡片一次只问一个会话，把它做成批量端点没有意义。
	 *
	 * 客户端的 hover 会在 800ms 之后触发、且**每次划过都会问**，所以这里刻意只做
	 * `listTrash()` + `scanSessionDirs()` + 单条 `dirStats()`，不做全量快照；
	 * 端到端的节流由客户端那份带 TTL 的缓存负责（`src/client/detail.ts`）。
	 */
	async describe(ids: string[]): Promise<SessionDetail> {
		const sessionId = ids[0];
		if (typeof sessionId !== "string" || sessionId === "") throw new Error("缺少会话 id");
		const registry = this.registry;
		const archived = registry.archivedSessionIds.includes(sessionId);
		const pinned = registry.pinnedSessionIds.includes(sessionId);
		// 活动判定与回收站清单互不依赖：一起等。回收站里的条目不可能正在跑（目录都搬走了），
		// 所以只有磁盘上那条路要用它的结果。
		const [trashed, activeList] = await Promise.all([
			this.listTrash().then((rows) => rows.find((row) => row.sessionId === sessionId)),
			this.sessionActivity(sessionId)
		]);
		const active = activeList.length > 0;
		if (trashed) {
			return {
				sessionId,
				title: trashed.title,
				cwd: trashed.cwd,
				workspaceId: trashed.workspaceId,
				workspaceTitle: trashed.workspaceTitle,
				slug: trashed.slug,
				// `__trash.json` 只记删除时间，恢复时才用得上创建时间，所以这里不硬凑。
				createdAt: null,
				bytes: trashed.bytes,
				files: trashed.files,
				onDisk: false,
				archived,
				pinned,
				// 回收站条目：目录已经搬走，谈不上"正在跑"。
				active: false,
				trashed: true,
				deletedAt: trashed.deletedAt,
				restorable: trashed.restorable
			};
		}
		const dirs = await this.scanSessionDirs();
		if (!dirs.has(sessionId)) throw new Error("找不到这个会话（日志目录不在磁盘上）");
		const row = await this.describeSession(sessionId, dirs, active);
		return {
			...row,
			archived,
			pinned,
			trashed: false,
			deletedAt: null,
			restorable: false
		};
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

	/**
	 * 回收站保留策略的**预览**（只读）：多少条、多少字节会被"清理 N 天前"带走。
	 *
	 * 只统计**真正能清掉**的条目 —— 老版本留下的、没有 `__trash.json`（`deletedAt` 为 0 或
	 * 缺 slug）的条目不算在内：它们连删除时间都不知道，`purge-older-than` 也一定会跳过，
	 * 预览要是把它们算进去，用户点确认后就会发现"说好的 5 条只删了 3 条"。
	 */
	async trashStats(days: number): Promise<TrashStats> {
		const rows = await this.listTrash();
		const cutoff = retentionCutoff(days);
		let count = 0;
		let bytes = 0;
		let totalBytes = 0;
		for (const row of rows) {
			totalBytes += row.bytes;
			if (isExpired(row, cutoff)) {
				count += 1;
				bytes += row.bytes;
			}
		}
		return { days, cutoff, count, bytes, totalCount: rows.length, totalBytes };
	}

	/** 「清理 N 天前」：与预览同一套判据，逐项失败不影响其余项。 */
	purgeOlderThan(days: number): Promise<MutationResult> {
		return purgeOlderThan(this, days);
	}

	/** 复制路径 / 在资源管理器中显示（实现在 `open.ts`，那边有完整的路径校验注释）。 */
	open(ids: string[], target: OpenTarget): Promise<OpenResult> {
		return openSession(this, ids, target);
	}

	/**
	 * 磁盘占用视图（只读）：整个 `<DSH_HOME>/sessions` 的占用合计 + 两个榜单。
	 *
	 * 与 `buildSnapshot()` 的关系：两者都读同一批目录，`dirStats()` 的 mtime 缓存让重复的
	 * 目录遍历只有第一次真的走磁盘；快照刚刚跑过的那批（归档 / 置顶）在这里直接命中缓存。
	 *
	 * 为什么要有这条端点而不是让客户端从快照里算：快照只有三个集合，**普通会话**（正在用的
	 * 那些）根本不在里面 —— 而"哪些会话最占地方"恰恰要问全部。
	 *
	 * 聚合按会话**当前所在的文件夹**（回收站条目用 `__trash.json` 里的原 cwd）：
	 * 与列表分组同一套键，用户看到的"工作区"是同一个东西。
	 */
	async usage(): Promise<Usage> {
		const registry = this.registry;
		const [dirs, trashed] = await Promise.all([this.scanSessionDirs(), this.listTrash()]);
		// 磁盘上的会话 + 回收站里的会话 = 全部会话（两边 id 不会重合，删除时目录已经搬走了）。
		const onDiskIds = [...dirs.keys()];
		const activeIds = await this.activeAmong(onDiskIds);
		const rows: UsageRow[] = [];
		const push = (row: UsageRow): void => {
			rows.push(row);
		};
		await mapLimit(onDiskIds, FS_CONCURRENCY, async (sessionId) => {
			const described = await this.describeSession(sessionId, dirs, activeIds.has(sessionId));
			push({
				sessionId,
				title: described.title,
				cwd: described.cwd,
				workspaceTitle: described.workspaceTitle,
				bytes: described.bytes,
				files: described.files,
				createdAt: described.createdAt,
				deletedAt: null,
				archived: registry.archivedSessionIds.includes(sessionId),
				pinned: registry.pinnedSessionIds.includes(sessionId),
				trashed: false,
				active: described.active
			});
		});
		for (const row of trashed) {
			push({
				sessionId: row.sessionId,
				title: row.title,
				cwd: row.cwd,
				workspaceTitle: row.workspaceTitle,
				bytes: row.bytes,
				files: row.files,
				createdAt: null,
				deletedAt: row.deletedAt > 0 ? row.deletedAt : null,
				archived: registry.archivedSessionIds.includes(row.sessionId),
				pinned: false,
				trashed: true,
				// 目录都搬进回收站了，谈不上"正在跑"。
				active: false
			});
		}

		let totalBytes = 0;
		const groups = new Map<string, UsageGroup>();
		for (const row of rows) {
			totalBytes += row.bytes;
			const key = groupKeyOfRow(row);
			const group = groups.get(key);
			if (group === undefined) {
				groups.set(key, { key, title: groupTitleOf(row), count: 1, bytes: row.bytes });
			} else {
				group.count += 1;
				group.bytes += row.bytes;
			}
		}
		// 榜单按"体积 / 时间"取前 N 条：客户端只画这几条，"最占地方"也不该把 191 行都发过去。
		const largest = [...rows].sort((left, right) => right.bytes - left.bytes).slice(0, USAGE_TOP_LIMIT);
		const oldest = [...rows]
			// 没有创建时间的沉底（`createdAt: null`）：`0` 会让它们排到最前面，看起来像"最老的"。
			.sort((left, right) => (left.createdAt ?? Number.POSITIVE_INFINITY) - (right.createdAt ?? Number.POSITIVE_INFINITY))
			.slice(0, USAGE_TOP_LIMIT);
		return {
			totalSessions: rows.length,
			totalBytes,
			onDiskSessions: onDiskIds.length,
			groups: [...groups.values()].sort((left, right) => right.bytes - left.bytes),
			largest,
			oldest
		};
	}

	/** 更新检查：只读，结果在模块级缓存（见 update.ts）。 */
	checkUpdate(force?: boolean): Promise<unknown> {
		return checkForUpdate(force);
	}
}

/**
 * 聚合用的分组键：与客户端 `groups.ts` 的 `groupKeyOf()` **同一套语义**（cwd 归一化后优先，
 * 其次 workspaceId，最后"未知目录"）。两边各写一份是因为客户端那份在浏览器里、这份在宿主，
 * 但规则必须一致 —— 否则"磁盘占用"里的工作区名会和列表分组对不上。
 */
function groupKeyOfRow(row: UsageRow): string {
	if (typeof row.cwd === "string" && row.cwd.trim() !== "") {
		return `cwd:${row.cwd
			.trim()
			.replace(/[\\/]+$/, "")
			.replace(/\\/g, "/")
			.toLowerCase()}`;
	}
	return "unknown";
}

/** 分组标题：workspaceTitle 优先，其次路径尾段，最后交给客户端填"未知目录"。 */
function groupTitleOf(row: UsageRow): string {
	if (typeof row.workspaceTitle === "string" && row.workspaceTitle !== "") return row.workspaceTitle;
	if (typeof row.cwd === "string" && row.cwd !== "") {
		const parts = row.cwd.split(/[\\/]/).filter((part) => part !== "");
		if (parts.length > 0) return parts[parts.length - 1] as string;
		return row.cwd;
	}
	return "";
}

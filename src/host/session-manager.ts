/**
 * 会话管理器：**只读投影**（快照 / 标题 / 体积）+ 归档 / 置顶这类轻量变更。
 *
 * 危险操作（物理删除）在 `delete.ts` 里，那边带完整的事故注释；
 * 这里只负责把磁盘与 registry 的事实汇总成快照，以及逐项执行的框架 `each()`。
 */
import { promises as fsp } from "node:fs";
import { join } from "node:path";
import { dirStats, mapLimit, messageOf, readProjectionFile, type DirStats, type Projection } from "./fs-utils.js";
import { dshHomePath, projCacheFile, sessionsRoot } from "./paths.js";
import { LOCAL_VERSION } from "./manifest.js";
import { checkForUpdate } from "./update.js";
import { deleteSessions } from "./delete.js";
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

	/** 当前归档 / 置顶的完整快照，附带目录位置。 */
	async buildSnapshot(): Promise<Snapshot> {
		const registry = this.registry;
		// 目录索引（哪些 id 真的在磁盘上）是唯一的只读来源；registry 记账可能包含已经删掉的 id。
		const dirs = await this.scanSessionDirs();
		const archivedIds: string[] = [];
		for (const sessionId of registry.archivedSessionIds) {
			// 把"目录已经不在了"的 id 滤掉：`archivedSessionIds` 是**只增不减**的记账
			//（DSH 自己的注释：目录没了的条目照样留在集合里），而 DSH 的侧边栏只从会话清单里
			// 取行 —— 这种 id 在它那边本来就不显示。列出来只会得到一条 0 B、点不动的幽灵行。
			if (!dirs.has(sessionId)) continue;
			archivedIds.push(sessionId);
		}
		const pinnedIds: string[] = [];
		for (const sessionId of registry.pinnedSessionIds) {
			if (!dirs.has(sessionId)) continue;
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
		return {
			dshHome: dshHomePath(),
			version: LOCAL_VERSION,
			sessionsDir: sessionsRoot(),
			archived,
			pinned,
			totals: {
				archived: archived.length,
				archivedBytes,
				pinned: pinned.length
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
	 * **单个**会话的完整事实（侧边栏 hover 卡片用）。
	 *
	 * 入参复用 `ids`（线协议的 `idsOf()` 只接受字符串数组）：取第一条，其余忽略 ——
	 * hover 卡片一次只问一个会话，把它做成批量端点没有意义。
	 *
	 * 客户端的 hover 会在 800ms 之后触发、且**每次划过都会问**，所以这里刻意只做
	 * `scanSessionDirs()` + 单条 `dirStats()`，不做全量快照；端到端的节流由客户端那份
	 * 带 TTL 的缓存负责（`src/client/detail.ts`）。
	 */
	async describe(ids: string[]): Promise<SessionDetail> {
		const sessionId = ids[0];
		if (typeof sessionId !== "string" || sessionId === "") throw new Error("缺少会话 id");
		const registry = this.registry;
		const archived = registry.archivedSessionIds.includes(sessionId);
		const pinned = registry.pinnedSessionIds.includes(sessionId);
		const dirs = await this.scanSessionDirs();
		if (!dirs.has(sessionId)) throw new Error("找不到这个会话（日志目录不在磁盘上）");
		const row = await this.describeSession(sessionId, dirs, (await this.sessionActivity(sessionId)).length > 0);
		return {
			...row,
			archived,
			pinned
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

	// ── 危险操作：物理删除，实现在 delete.ts（那边有完整的事故注释） ─────
	delete(ids: string[]): Promise<MutationResult> {
		return deleteSessions(this, ids);
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
	 * 为什么要有这条端点而不是让客户端从快照里算：快照只有两个集合，**普通会话**（正在用的
	 * 那些）根本不在里面 —— 而"哪些会话最占地方"恰恰要问全部。
	 *
	 * 聚合按会话**当前所在的文件夹**（投影缓存里的 cwd）：与列表分组同一套键，用户看到的
	 * "工作区"是同一个东西。
	 */
	async usage(): Promise<Usage> {
		const registry = this.registry;
		const dirs = await this.scanSessionDirs();
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
				archived: registry.archivedSessionIds.includes(sessionId),
				pinned: registry.pinnedSessionIds.includes(sessionId),
				active: described.active
			});
		});

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

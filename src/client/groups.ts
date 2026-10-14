/**
 * 按工作区文件夹分组、排序、折叠决策 —— 全是纯函数，`scripts/client.mjs` 直接单测。
 */
import { baseName } from "./format.js";
import type { TFn } from "./i18n.js";
import type { PanelRow } from "../shared/protocol.js";

export interface SessionGroup {
	/** 分组键：`cwd:<归一化路径>` / `id:<workspaceId>` / `unknown`。 */
	key: string;
	title: string;
	cwd: string | null;
	bytes: number;
	rows: PanelRow[];
}

/**
 * 一个工作区在**三个页签合起来**之后的样子（分组标题右侧「整个工作区」菜单的数据源）。
 *
 * 为什么要有它：列表一次只渲染一个页签，而"把这个项目整个收拾掉"必须跨页签 —— 同一个
 * 工作区的会话可能一部分在归档、一部分在置顶、一部分已经在回收站。
 *
 * 三个列表的分工（宿主那边的端点自己会跳过"已经到位"的条目，这里只是把状态摆出来，
 * 让界面知道"这个动作有没有意义"）：
 *   - `archivableIds`：所有**没在回收站**的会话（含已经归档的 —— 再归档一次是空操作，
 *     但界面上"整个工作区归档"仍然是一个有意义的说法：归档完这个工作区就清净了）；
 *   - `trashableIds`：所有**不在回收站**的会话（归档 / 置顶 / 普通，删除时宿主会先取消归档）；
 *   - `activeIds`：这个工作区里正在跑的会话。
 */
export interface WorkspaceSummary {
	key: string;
	archivableIds: string[];
	trashableIds: string[];
	activeIds: string[];
}

/**
 * 把三份行按工作区合起来算"整个工作区"的目标集合。
 *
 * 参数是三份**未过滤**的行（归档 / 置顶 / 回收站）—— 过滤只影响显示，不该改变
 * "整个工作区"的范围（与批量操作按整个页签算的语义一致）。
 *
 * 回收站里的条目**不进任何目标集合**：它的目录已经搬走了，既归档不了（早就在归档集合里
 * 藏着了）也不该再删一次（它就在回收站）。但它仍然参与建桶 —— 一个"只剩回收站条目"的
 * 工作区也该在菜单里如实显示（两项都禁用），而不是让菜单凭空消失。
 */
export function workspaceSummaries(archived: PanelRow[], pinned: PanelRow[], trashed: PanelRow[]): Map<string, WorkspaceSummary> {
	const summaries = new Map<string, WorkspaceSummary>();
	const bucketOf = (key: string): WorkspaceSummary => {
		let summary = summaries.get(key);
		if (summary === undefined) {
			summary = { key, archivableIds: [], trashableIds: [], activeIds: [] };
			summaries.set(key, summary);
		}
		return summary;
	};
	for (const rows of [archived, pinned]) {
		for (const row of rows) {
			const summary = bucketOf(groupKeyOf(row));
			summary.archivableIds.push(row.sessionId);
			summary.trashableIds.push(row.sessionId);
			if (row.active === true) summary.activeIds.push(row.sessionId);
		}
	}
	for (const row of trashed) bucketOf(groupKeyOf(row));
	return summaries;
}

/**
 * 分组键 = 会话**原来的工作区文件夹**。
 * 优先 cwd（Windows 大小写不敏感、末尾分隔符无关，所以归一化后再比），
 * 没有 cwd 时退到 workspaceId，两者都没有就落进"未知目录"那一组。
 */
export function groupKeyOf(row: PanelRow): string {
	if (typeof row.cwd === "string" && row.cwd.trim() !== "") {
		return `cwd:${row.cwd
			.trim()
			.replace(/[\\/]+$/, "")
			.replace(/\\/g, "/")
			.toLowerCase()}`;
	}
	if (typeof row.workspaceId === "string" && row.workspaceId !== "") return `id:${row.workspaceId}`;
	return "unknown";
}

/**
 * 分成 `[{ key, title, cwd, bytes, rows[] }]`。组内保持宿主给的顺序
 * （回收站本来就是"最近删除在前"）；组间按文件夹名排序，"未知目录"永远在最后 ——
 * 归档 / 取消归档之后列表不会整片跳位。
 */
export function groupRows(rows: PanelRow[], t: TFn): SessionGroup[] {
	const groups = new Map<string, SessionGroup>();
	for (const row of rows) {
		const key = groupKeyOf(row);
		let group = groups.get(key);
		if (group === undefined) {
			const cwd = typeof row.cwd === "string" && row.cwd !== "" ? row.cwd : null;
			const title =
				(typeof row.workspaceTitle === "string" && row.workspaceTitle !== "" ? row.workspaceTitle : null) ??
				(cwd === null ? null : baseName(cwd) || cwd) ??
				t("noProject");
			group = { key, title, cwd, bytes: 0, rows: [] };
			groups.set(key, group);
		}
		group.rows.push(row);
		if (typeof row.bytes === "number" && Number.isFinite(row.bytes)) group.bytes += row.bytes;
	}
	const list = [...groups.values()];
	list.sort((left, right) => {
		if (left.key === "unknown" || right.key === "unknown") {
			return left.key === right.key ? 0 : left.key === "unknown" ? 1 : -1;
		}
		return left.title.localeCompare(right.title);
	});
	return list;
}

export type OrderKey = "host" | "title" | "bytes" | "createdAt" | "deletedAt";

/**
 * 排序是显示层的事：`host` 就是宿主给的顺序（回收站是最近删除在前）。
 *
 * 两个时间键都是**新的在前**，并且"没有时间"的行永远沉底：`createdAt` 缺失在老会话上很常见
 * （投影缓存里没有 `identity.createdAt`），拿 0 去比会让它们排到最前面，看起来像"刚建的"。
 */
export function sortRows(rows: PanelRow[], order: OrderKey): PanelRow[] {
	const descending =
		(pick: (row: PanelRow) => number | null | undefined) =>
		(left: PanelRow, right: PanelRow): number => {
			const a = pick(left);
			const b = pick(right);
			const hasA = typeof a === "number" && Number.isFinite(a) && a > 0;
			const hasB = typeof b === "number" && Number.isFinite(b) && b > 0;
			if (!hasA && !hasB) return 0;
			if (!hasA) return 1;
			if (!hasB) return -1;
			return (b as number) - (a as number);
		};
	if (order === "title") {
		return [...rows].sort((left, right) => String(left.title ?? "").localeCompare(String(right.title ?? "")));
	}
	if (order === "bytes") {
		return [...rows].sort((left, right) => (right.bytes ?? 0) - (left.bytes ?? 0));
	}
	if (order === "createdAt") return [...rows].sort(descending((row) => row.createdAt));
	if (order === "deletedAt") return [...rows].sort(descending((row) => row.deletedAt));
	return rows;
}

// ── 搜索与过滤（只影响显示，见 settings-panel 的用法） ────────────────────
/** "最近"那一档的窗口：一周。 */
export const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** 时间过滤：`all` 不过滤；`recent` 只留最近一周的。 */
export type TimeFilter = "all" | "recent";

export interface FilterOptions {
	/** 搜索词：大小写不敏感的子串匹配（标题 + 原目录）。空串 = 不过滤。 */
	search: string;
	timeFilter: TimeFilter;
	/** 时间过滤用的"现在"；默认 `Date.now()`，自检传固定值。 */
	now?: number;
}

/** 回收站里的行没有"最近打开"可言，只有删除时间 —— 时间过滤只作用在归档 / 置顶页签。 */
function isTrashRow(row: PanelRow): boolean {
	return typeof row.deletedAt === "number";
}

/** 搜索词只看标题与原目录（`baseName` 之类都在里面，用户输入的是人能认出来的那几个字）。 */
export function matchesSearch(row: PanelRow, search: string): boolean {
	const needle = search.trim().toLowerCase();
	if (needle === "") return true;
	const haystacks = [row.title, row.cwd, row.workspaceTitle];
	return haystacks.some((value) => typeof value === "string" && value.toLowerCase().includes(needle));
}

/**
 * 时间过滤用的时间戳：归档 / 置顶行看 `createdAt`（本插件手上唯一的"这个会话有多老"的
 * 事实，取自投影缓存），回收站行看 `deletedAt`。
 */
export function timeStampOf(row: PanelRow): number | null {
	if (isTrashRow(row)) return typeof row.deletedAt === "number" && row.deletedAt > 0 ? row.deletedAt : null;
	if (typeof row.createdAt === "number" && row.createdAt > 0) return row.createdAt;
	return null;
}

/** 一条行是否命中当前过滤条件（"最近"那一档要求有时间戳且落在窗口内）。 */
export function matchesFilter(row: PanelRow, filter: FilterOptions): boolean {
	if (!matchesSearch(row, filter.search)) return false;
	if (filter.timeFilter !== "recent") return true;
	const stamp = timeStampOf(row);
	if (stamp === null) return false;
	return (filter.now ?? Date.now()) - stamp <= RECENT_WINDOW_MS;
}

/**
 * 过滤只影响**显示**：批量操作、勾选与计数仍然按整个页签的行算（语义没变，改的是"看见什么"）。
 * 顺序保持入参顺序 —— 过滤在排序之后做，用户选的排序不会被过滤打乱。
 */
export function filterRows(rows: PanelRow[], filter: FilterOptions): PanelRow[] {
	if (filter.search.trim() === "" && filter.timeFilter === "all") return rows;
	return rows.filter((row) => matchesFilter(row, filter));
}

/** 过滤条件是不是"什么都没筛"（面板用它决定要不要显示"已过滤"那一行）。 */
export function isFilterActive(filter: FilterOptions): boolean {
	return filter.search.trim() !== "" || filter.timeFilter !== "all";
}

// ── 折叠状态 ─────────────────────────────────────────────────────────────
/** 配置页里的"分组默认状态"。 */
export type GroupDefault = "expanded" | "collapsed";
/** 手动点过的分组：`key → 是否折叠`。只有与默认状态**不一致**的才留在里面。 */
export type CollapseOverrides = Record<string, boolean>;

/** 折叠状态按页签各记各的：同一个文件夹在归档页折叠，不影响回收站页。 */
export function collapseKey(tab: string, groupKey: string): string {
	return `${tab}:${groupKey}`;
}

/** 手动点过的看手动值；没点过的跟随配置里的默认状态（所以改配置会立刻生效）。 */
export function isGroupCollapsed(key: string, overrides: CollapseOverrides, fallback: GroupDefault): boolean {
	const manual = overrides[key];
	return manual === undefined ? fallback === "collapsed" : manual;
}

/**
 * 点一次分组标题后的新覆盖表。
 *
 * 翻回默认状态时**删掉**这条覆盖（而不是记一个与默认相同的值）：这样"手动翻回来"的
 * 文件夹之后仍然跟着配置走 —— 否则"改配置立即生效"会因为一次无意义的点击而永久失效。
 */
export function toggledCollapse(key: string, overrides: CollapseOverrides, fallback: GroupDefault): CollapseOverrides {
	const next = { ...overrides };
	const value = !isGroupCollapsed(key, overrides, fallback);
	if (value === (fallback === "collapsed")) delete next[key];
	else next[key] = value;
	return next;
}

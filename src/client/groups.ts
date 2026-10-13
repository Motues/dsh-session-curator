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
 * 分组键 = 会话**原来的工作区文件夹**。
 * 优先 cwd（Windows 大小写不敏感、末尾分隔符无关，所以归一化后再比），
 * 没有 cwd 时退到 workspaceId，两者都没有就落进"未知目录"那一组。
 */
export function groupKeyOf(row: PanelRow): string {
	if (typeof row.cwd === "string" && row.cwd.trim() !== "") {
		return `cwd:${row.cwd.trim().replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase()}`;
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
			const title = (typeof row.workspaceTitle === "string" && row.workspaceTitle !== "" ? row.workspaceTitle : null)
				?? (cwd === null ? null : baseName(cwd) || cwd)
				?? t("noProject");
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

export type OrderKey = "host" | "title" | "bytes";

/** 排序是显示层的事：`host` 就是宿主给的顺序（回收站是最近删除在前）。 */
export function sortRows(rows: PanelRow[], order: OrderKey): PanelRow[] {
	if (order === "title") {
		return [...rows].sort((left, right) => String(left.title ?? "").localeCompare(String(right.title ?? "")));
	}
	if (order === "bytes") {
		return [...rows].sort((left, right) => (right.bytes ?? 0) - (left.bytes ?? 0));
	}
	return rows;
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

/**
 * 面板自己的设置：`localStorage["dsh-session-curator.settings"]` 持久化，
 * 读不到 / 类型不符一律退回默认值（隐私模式、手改过的键、老版本留下的键都在此列）。
 */
import { createStore } from "./stores.js";
import type { GroupDefault, OrderKey, TimeFilter } from "./groups.js";

/** 三个数据页签；配置页**不能**当默认页签。 */
export type DataTab = "archived" | "pinned" | "trash";

/**
 * 回收站保留策略的**快捷档位**。默认 30 —— 这是**永久删除**，所以既不落盘成"自动清理"，
 * 也不让它悄悄跑：无论选档位还是填自定义天数，每次都要先看预览、再过一道确认弹窗
 *（见 `components/settings-panel.ts` 的保留策略一行与 `dialog.ts` 的 `purge-old`）。
 *
 * 档位只是快捷方式，**不是**取值上限：自定义天数由 `trashDaysCustom` 承担，合法区间见
 * `TRASH_DAYS_MIN` / `TRASH_DAYS_MAX`（与宿主 `retention.ts` 的夹取保持一致）。
 */
export const TRASH_RETENTION_DAYS: readonly number[] = [7, 30, 90];
/** 保留天数的默认档位（也是宿主 `daysOf()` 在入参缺失时的兜底）。 */
export const DEFAULT_TRASH_DAYS = 30;
/** 自定义天数的下限：0 会让截止时间变成"此刻"，等于把整个回收站当成过期。 */
export const TRASH_DAYS_MIN = 1;
/** 上限 3650 天（10 年）：与宿主 `retentionCutoff()` 夹取用的是同一个数字，改一处要改两处。 */
export const TRASH_DAYS_MAX = 3650;

/**
 * 解析用户填的自定义天数：空 / 非纯整数 / 越界一律返回 `null`（= 这次不生效，回落到档位）。
 *
 * 为什么"越界"也算无效而不是夹取：夹取会让输入框里的数字与真正生效的数字不一致
 *（用户填 99999，预览却按 3650 算）—— 那种"我填的和它算的不一样"最难解释。宁可让这一格
 * 不生效，界面把输入框标红并说明合法区间。
 */
export function parseCustomDays(raw: string): number | null {
	const trimmed = raw.trim();
	if (trimmed === "") return null;
	// 只接受纯整数：`Number("1e3")` / `Number("0x10")` / `Number(" 3 ")` 都能过 `Number()`，
	// 但那些不是用户在"填天数"时想表达的东西。
	if (!/^\d+$/.test(trimmed)) return null;
	const value = Number(trimmed);
	if (!Number.isSafeInteger(value) || value < TRASH_DAYS_MIN || value > TRASH_DAYS_MAX) return null;
	return value;
}

/**
 * 真正生效的保留天数：填了合法自定义值就用它，否则用档位。
 *
 * 预览（`trash-stats`）、清理（`purge-older-than`）与界面文案都必须走这一个函数 ——
 * 三处各算一遍，迟早出现"预览按 30 天算、真删按 7 天删"这种最坏的情况。
 */
export function effectiveTrashDays(settings: PanelSettings): number {
	return parseCustomDays(settings.trashDaysCustom) ?? settings.trashDays;
}

export interface PanelSettings {
	tab: DataTab;
	grouping: boolean;
	groupDefault: GroupDefault;
	showMeta: boolean;
	order: OrderKey;
	autoUpdate: boolean;
	/** 搜索词（持久化，切页签 / 重开面板都还在）。 */
	search: string;
	timeFilter: TimeFilter;
	/** 保留策略的**档位**选择（本身不触发任何删除）。 */
	trashDays: number;
	/** 自定义保留天数：空串 = 用档位；非空但非法时界面标红、也不生效。 */
	trashDaysCustom: string;
}

export const DEFAULT_SETTINGS: PanelSettings = {
	tab: "archived",
	grouping: true,
	// 与 0.1.1 的行为一致：分组默认是**展开**的，老用户升级后界面不变。
	groupDefault: "expanded",
	showMeta: true,
	order: "host",
	autoUpdate: true,
	search: "",
	timeFilter: "all",
	trashDays: DEFAULT_TRASH_DAYS,
	trashDaysCustom: ""
};

/** 搜索词长度上限：防止有人把整篇日志粘进来当过滤词（它每帧都要跑一遍 includes）。 */
const SEARCH_MAX_LENGTH = 200;

const SETTINGS_KEY = "dsh-session-curator.settings";

export function readSettings(): PanelSettings {
	try {
		const raw = globalThis.localStorage ? globalThis.localStorage.getItem(SETTINGS_KEY) : null;
		if (typeof raw !== "string" || raw === "") return { ...DEFAULT_SETTINGS };
		const parsed = JSON.parse(raw) as Record<string, unknown> | null;
		if (parsed === null || typeof parsed !== "object") return { ...DEFAULT_SETTINGS };
		const next: PanelSettings = { ...DEFAULT_SETTINGS };
		/** 逐键校验：取值不符就保留默认值（`tab: "config"` 也走这条路，配置页不能当默认页签）。 */
		const pick = <K extends keyof PanelSettings>(key: K, validate: (value: unknown) => PanelSettings[K] | undefined): void => {
			const value = validate(parsed[key]);
			if (value !== undefined) next[key] = value;
		};
		pick("tab", (value) => (value === "archived" || value === "pinned" || value === "trash" ? value : undefined));
		pick("grouping", (value) => (typeof value === "boolean" ? value : undefined));
		pick("groupDefault", (value) => (value === "expanded" || value === "collapsed" ? value : undefined));
		pick("showMeta", (value) => (typeof value === "boolean" ? value : undefined));
		pick("order", (value) =>
			value === "host" || value === "title" || value === "bytes" || value === "createdAt" || value === "deletedAt" ? value : undefined
		);
		pick("autoUpdate", (value) => (typeof value === "boolean" ? value : undefined));
		pick("search", (value) => (typeof value === "string" ? value.slice(0, SEARCH_MAX_LENGTH) : undefined));
		pick("timeFilter", (value) => (value === "all" || value === "recent" ? value : undefined));
		pick("trashDays", (value) => (typeof value === "number" && TRASH_RETENTION_DAYS.includes(value) ? value : undefined));
		// 自定义天数**原样存字符串**（含非法的），这样用户填错时下次打开还能看见自己填了什么；
		// 是否生效由 `effectiveTrashDays()` / `parseCustomDays()` 判，不在读设置这一步就丢掉。
		pick("trashDaysCustom", (value) => (typeof value === "string" ? value.slice(0, 8) : undefined));
		return next;
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export const settingsStore = createStore<PanelSettings>(readSettings());

export function updateSettings(patch: Partial<PanelSettings>): PanelSettings {
	const next = { ...settingsStore.get(), ...patch };
	if (typeof next.search === "string" && next.search.length > SEARCH_MAX_LENGTH) next.search = next.search.slice(0, SEARCH_MAX_LENGTH);
	settingsStore.set(next);
	try {
		if (globalThis.localStorage) globalThis.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
	} catch {
		// 隐私模式 / 配额满：设置本次会话内有效。
	}
	return next;
}

/** "按工作区分组"开关；初值来自设置，工具条上改它也会写回设置。 */
export const groupingStore = createStore<boolean>(settingsStore.get().grouping);

// ── 官方侧边栏的"显示已归档" ─────────────────────────────────────────────
/**
 * 官方那份"视图"存储的 localStorage 键：`@deepseek-ai/dsh-client-ui-workspace` 里
 * `defineStore({ …, persist: "dsh.workspace.view.v5" })`，整份 JSON 形如
 * `{ groupBy, orderBy, groupExpansion, sessionOrderByAccount, archivedFilter }`。
 * 侧边栏「视图选项」菜单里的 隐藏已归档 / 全部对话（显示已归档）/ 仅显示已归档
 * 写的就是 `archivedFilter`（`default` / `show` / `only`）。
 */
export const SIDEBAR_VIEW_KEY = "dsh.workspace.view.v5";

export type SidebarArchivedFilter = "default" | "show" | "only";

export function readSidebarArchived(): SidebarArchivedFilter {
	try {
		const raw = globalThis.localStorage ? globalThis.localStorage.getItem(SIDEBAR_VIEW_KEY) : null;
		if (typeof raw !== "string" || raw === "") return "default";
		const parsed = JSON.parse(raw) as { archivedFilter?: unknown } | null;
		const value = parsed !== null && typeof parsed === "object" ? parsed.archivedFilter : null;
		return value === "show" || value === "only" ? value : "default";
	} catch {
		return "default";
	}
}

/**
 * 只改 `archivedFilter` 一个字段，其余（分组方式 / 排序 / 折叠 / 手动顺序）原样保留。
 *
 * 为什么只能"写存储 + 刷新页面"：`@deepseek-ai/dsh-client-store` 的 `attachPersistence()`
 * **只在 store 创建时读一次** localStorage（之后只在自己变更时写），不监听 `storage` 事件；
 * 而那个实例活在官方 bundle 内部（`@deepseek-ai/dsh-client-ui-workspace` 只导出
 * `apply` / `inject`），插件既拿不到实例也拿不到它的写接口。刷新页面后官方 store 才会
 * 带着新值重建，侧边栏跟着变。
 */
export function writeSidebarArchived(show: boolean): boolean {
	try {
		if (!globalThis.localStorage) return false;
		const raw = globalThis.localStorage.getItem(SIDEBAR_VIEW_KEY);
		const parsed = raw === null || raw === "" ? null : (JSON.parse(raw) as Record<string, unknown> | null);
		const target = parsed === null || typeof parsed !== "object" || Array.isArray(parsed) ? {} : parsed;
		target.archivedFilter = show ? "show" : "default";
		globalThis.localStorage.setItem(SIDEBAR_VIEW_KEY, JSON.stringify(target));
		return true;
	} catch {
		return false;
	}
}

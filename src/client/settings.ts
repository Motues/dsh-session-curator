/**
 * 面板自己的设置：`localStorage["dsh-session-curator.settings"]` 持久化，
 * 读不到 / 类型不符一律退回默认值（隐私模式、手改过的键、老版本留下的键都在此列）。
 */
import { createStore } from "./stores.js";
import type { GroupDefault, OrderKey } from "./groups.js";

/** 三个数据页签；配置页**不能**当默认页签。 */
export type DataTab = "archived" | "pinned" | "trash";

export interface PanelSettings {
	tab: DataTab;
	grouping: boolean;
	groupDefault: GroupDefault;
	showMeta: boolean;
	order: OrderKey;
	autoUpdate: boolean;
}

export const DEFAULT_SETTINGS: PanelSettings = {
	tab: "archived",
	grouping: true,
	// 与 0.1.1 的行为一致：分组默认是**展开**的，老用户升级后界面不变。
	groupDefault: "expanded",
	showMeta: true,
	order: "host",
	autoUpdate: true
};

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
		pick("order", (value) => (value === "host" || value === "title" || value === "bytes" ? value : undefined));
		pick("autoUpdate", (value) => (typeof value === "boolean" ? value : undefined));
		return next;
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export const settingsStore = createStore<PanelSettings>(readSettings());

export function updateSettings(patch: Partial<PanelSettings>): PanelSettings {
	const next = { ...settingsStore.get(), ...patch };
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

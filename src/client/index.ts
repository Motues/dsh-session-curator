/**
 * dsh-session-curator — client 半区入口（装配层）。
 *
 * 六个贡献：
 *   1. `sidebar.workspaces.session.menu.item`（order 500，排在官方 archive 之后）：
 *      一行「删除会话」，点击后弹确认框，确认即软删除到回收站。
 *   2. `shell.overlay`：全局确认弹窗宿主（菜单项与设置面板共用）。
 *   3. `settings.section`（order 45）：会话管理面板 —— 已归档 / 已置顶 / 回收站 + 配置。
 *   4. `sidebar.session.row.hover`（order 50）：hover 卡片里补"体积 / 文件数 / 原目录 /
 *      在不在回收站"（官方卡片只画标题、相对时间与运行状态）。
 *   5. `sidebar.workspaces.session.row.action`（order 500）：行内「移入回收站」，
 *      不必再点开 ⋯ 菜单（官方自己的归档 / 置顶就在这个槽位里，顺序 100 / 200）。
 *   6. `shell.overlay`（order 70）：删除成功后的「撤销」toast。
 *
 * ⚠️ 本文件**不是**可以直接 <script> 加载的束：`lib/client.js` 的
 * `window.__ModuleLoader__.load({id, factory})` 外壳由 `scripts/build.mjs` 在构建时套上
 * （浏览器拿到的是 classic script，不能是 ESM，所以多文件必须在构建期合回一份）。
 */
import * as React from "react";
import { MenuItemButton } from "@deepseek-ai/dsh-client-ui-primitives";
import { DialogHost } from "./components/dialog-host.js";
import { SessionHover } from "./components/session-hover.js";
import { SessionManagerPanel } from "./components/settings-panel.js";
import { ToastHost } from "./components/toast-host.js";
import { TrashRowButton } from "./components/trash-row-button.js";
import { requestTrash } from "./dialog.js";
import { NS, dictionaries } from "./i18n.js";
import { reportError, setContext, type ClientContext } from "./runtime.js";
import type { TFn } from "./i18n.js";

/** 会话行「⋯」菜单里的删除项。 */
const MENU_ID = "session-curator.delete";
/** 全局确认弹窗宿主。 */
const OVERLAY_ID = "session-curator.dialog";
/** 删除成功后的「撤销」toast 宿主。 */
const TOAST_ID = "session-curator.toast";
/** hover 卡片里属于本插件的那一节。 */
const HOVER_ID = "session-curator.hover";
/** 会话行 hover 时的行内删除按钮。 */
const ROW_ACTION_ID = "session-curator.trash";
/** 本插件自己的设置页 id（也是"没得借"时的兜底）。 */
const SECTION_ID = "session-curator";
/**
 * 设置页导航栏的图标**不是注册时给的** —— 设置外壳
 * `@deepseek-ai/dsh-client-ui-settings-general` 的 `navIcon(id)` 是按 **section id 查表**：
 *
 * ```js
 * account → 人像 / models → 数据 / agent-presets → 预设 / plugins → 个性化
 * archived-sessions → 归档盒子 / 其它一律 → 齿轮（默认）
 * ```
 *
 * 我们的 `session-curator` 不在表里，所以一直是"默认齿轮"（`settings.section` 的
 * options 只读 id / order / label，外壳不看 icon 字段，插件没法自带导航图标）。
 * 表里**唯一没人用**的 id 是 `archived-sessions`，它映射到归档盒子图标 —— 语义刚好贴合
 * 本插件（归档 / 回收站管理），所以借用它。
 */
const NAV_SECTION_ID = "archived-sessions";

/**
 * 借 id 之前先看槽位账本：**一旦将来 DSH 自己注册了 `archived-sessions`，
 * 我们就退回自己的 id**（拿默认齿轮），绝不会跟官方撞车。
 *
 * 这里直接调 `ctx.slots.entries()` 而不是 `?.()`：账本缺失（老版本外壳）时靠 catch
 * 退回自己的 id —— 用 `?.` 会让"没有账本"和"账本是空的"给出同一个答案（借来的 id）。
 */
export function sectionIdFor(ctx: ClientContext): string {
	try {
		const taken = ctx.slots.entries("settings.section").some((entry) => entry?.options?.id === NAV_SECTION_ID);
		return taken ? SECTION_ID : NAV_SECTION_ID;
	} catch {
		// 拿不到账本（没有 entries）就退回自己的 id。
		return SECTION_ID;
	}
}

/** 会话行「⋯」菜单项的 props（DSH 的 `sidebar.workspaces.session.menu.item` 槽位给这些）。 */
interface SessionMenuItemProps {
	sessionId: string;
	displayTitle?: string;
	useMenuOpenState(): [unknown, (open: boolean) => void];
}

export const inject = ["slots", "locale"];

export function apply(ctx: ClientContext): void {
	setContext(ctx);
	ctx.effect(() => ctx.locale.register(NS, dictionaries), "dsh-session-curator: dictionaries");
	const t: TFn = ctx.locale.bind(NS);

	// 逐个贡献：某个槽位声明缺失时只丢这一个贡献，不连累其余的。
	const contribute = (slot: string, options: Record<string, unknown>, component: unknown, label: string): void => {
		try {
			ctx.slots.inject(slot, () => ctx.slots.register(options, component));
		} catch (error) {
			reportError(error);
			if (ctx.logger) ctx.logger.warn(`[session-curator] slot ${slot} 注册失败（${label}）`);
		}
	};

	// 1) 会话行「⋯」菜单里的删除项，排在官方 archive（400）之后。
	contribute(
		"sidebar.workspaces.session.menu.item",
		{
			name: "sidebar.workspaces.session.menu.item",
			id: MENU_ID,
			order: 500,
			label: () => t("menuDelete"),
			locale: NS
		},
		(props: SessionMenuItemProps) => {
			const [, setMenuOpen] = props.useMenuOpenState();
			return React.createElement(
				MenuItemButton,
				{
					danger: true,
					separatorBefore: true,
					onSelect: () => {
						setMenuOpen(false);
						requestTrash([props.sessionId], props.displayTitle || props.sessionId);
					}
				},
				t("menuDelete")
			);
		},
		"menu item"
	);

	// 2) 全局确认弹窗宿主。
	contribute(
		"shell.overlay",
		{
			name: "shell.overlay",
			id: OVERLAY_ID,
			order: 60,
			locale: NS
		},
		DialogHost,
		"dialog host"
	);

	// 3) 设置页：已归档 / 已置顶 / 回收站（id 见 sectionIdFor：为了导航栏的归档图标）。
	contribute(
		"settings.section",
		{
			name: "settings.section",
			id: sectionIdFor(ctx),
			order: 45,
			label: () => t("sectionLabel"),
			locale: NS
		},
		SessionManagerPanel,
		"settings section"
	);

	// 4) 会话行 hover 卡片里的"磁盘事实"一节（官方卡片只有标题 / 时间 / 运行状态）。
	contribute(
		"sidebar.session.row.hover",
		{
			name: "sidebar.session.row.hover",
			id: HOVER_ID,
			// 官方 ui-schedule 的任务列表在这个槽位是 order 10；我们排在它后面。
			order: 50,
			locale: NS
		},
		SessionHover,
		"hover card"
	);

	/**
	 * 5) 行内 hover 按钮：一只手就能删，不必点开 ⋯ 再点一次。
	 *
	 * 只是**快捷入口**，不新增语义：点击走同一个 `requestTrash()` → 同一份确认弹窗
	 *（软删除永远先问一次），确认后同样有撤销 toast。形状与官方自己的归档 / 置顶按钮一致
	 *（同在这个槽位，order 100 / 200），见 `components/trash-row-button.ts`。
	 */
	contribute(
		"sidebar.workspaces.session.row.action",
		{
			name: "sidebar.workspaces.session.row.action",
			id: ROW_ACTION_ID,
			order: 500,
			locale: NS
		},
		TrashRowButton,
		"row action"
	);

	// 6) 删除成功后的「撤销」toast（order 排在确认弹窗之后，两者互不遮挡）。
	contribute(
		"shell.overlay",
		{
			name: "shell.overlay",
			id: TOAST_ID,
			order: 70,
			locale: NS
		},
		ToastHost,
		"toast host"
	);
}

// 给 `scripts/client.mjs` 直接单测的东西（浏览器里用不到这些导出）：纯函数 / 纯组件，
// 外加几个模块级 store 与带缓存的读取器（自检要断言"缓存命中一次请求"这类行为）。
// hover 卡片与 toast 宿主不走这里 —— 自检从槽位账本里拿**注册上去的那一份**，
// 这样连"注册有没有接对"一起测了。
export { NS };
export {
	groupKeyOf,
	groupRows,
	collapseKey,
	isGroupCollapsed,
	toggledCollapse,
	sortRows,
	filterRows,
	matchesFilter,
	matchesSearch,
	isFilterActive,
	workspaceSummaries
} from "./groups.js";
export { TRASH_RETENTION_DAYS, TRASH_DAYS_MIN, TRASH_DAYS_MAX, parseCustomDays, effectiveTrashDays } from "./settings.js";
export { SessionRow } from "./components/session-row.js";
export { GroupHeader } from "./components/group-header.js";
export { Dropdown } from "./components/dropdown.js";
export { UsagePanel } from "./components/usage-panel.js";
export { describeSession, forgetDetails } from "./detail.js";
// 快照缓存的读/清：自检要造"冷启动（没有缓存）"这一帧，并断言第一份快照真的被记住了。
export { cachedSnapshot, forgetSnapshot } from "./snapshot.js";
export { showTrashUndo, showNotice, toastStore, undoTrash } from "./toast.js";
// 自检要清掉"待确认请求"（`client.dialogStore.set(null)`），所以这个 store 也导出来。
export { dialogStore } from "./dialog.js";

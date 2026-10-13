/**
 * 设置面板：已归档 / 已置顶 / 回收站三个数据页签 + 配置页。
 *
 * 这个文件只做"装配与状态"：分组 / 排序 / 折叠的**规则**在 `groups.ts`（纯函数、可单测），
 * 与宿主通信在 `api.ts`。控件形状（一行会话 + 一个 ⋯）由 `session-row.ts` 统一。
 */
import * as React from "react";
import {
	Button,
	IconPinOutlineRegular,
	IconRefreshOutlineRegular,
	IconTrashOutlineRegular,
	IconUnarchiveOutlineRegular,
	SegmentedControl,
	Switch
} from "@deepseek-ai/dsh-client-ui-primitives";
import { call, firstFailure } from "../api.js";
import { requestPurge, requestTrash, mutationStore } from "../dialog.js";
import { formatBytes } from "../format.js";
import {
	collapseKey,
	groupRows,
	isGroupCollapsed,
	sortRows,
	toggledCollapse,
	type CollapseOverrides,
	type GroupDefault,
	type SessionGroup
} from "../groups.js";
import { TAB_LABEL, text, type TFn } from "../i18n.js";
import { reportError } from "../runtime.js";
import {
	DEFAULT_SETTINGS,
	groupingStore,
	readSidebarArchived,
	settingsStore,
	updateSettings,
	writeSidebarArchived,
	type DataTab
} from "../settings.js";
import { useStore } from "../stores.js";
import { S } from "../styles.js";
import { updateStore, checkUpdate } from "../update.js";
import { GroupHeader } from "./group-header.js";
import { SessionRow, type RowMenu } from "./session-row.js";
import type { Endpoint, MutationResult, PanelRow, Snapshot } from "../../shared/protocol.js";

/** 面板上的页签：三个数据页签 + 配置页。 */
type PanelTab = DataTab | "config";
/** 会改动数据的端点（`run()` 只用来打这些）。 */
type MutationEndpoint = Exclude<Endpoint, "snapshot" | "check-update">;

/** 渲染块：分组时一个分组一块，平铺时整页一块（`group` 为 null）。 */
interface PanelBlock {
	key: string;
	group: SessionGroup | null;
	rows: PanelRow[];
}

export interface SessionManagerPanelProps {
	t: TFn;
}

export function SessionManagerPanel(props: SessionManagerPanelProps): React.ReactElement {
	const t = props.t;
	const settings = useStore(settingsStore);
	/** 初始页签来自配置页的"默认页签"。 */
	const [tab, setTab] = React.useState<PanelTab>(settings.tab);
	const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [loading, setLoading] = React.useState<boolean>(true);
	const [busy, setBusy] = React.useState<boolean>(false);
	const [selected, setSelected] = React.useState<string[]>([]);
	// 手动翻过的分组（`<tab>:<groupKey>` → 是否折叠）；没翻过的跟随配置里的默认状态。
	const [collapsedOverrides, setCollapsedOverrides] = React.useState<CollapseOverrides>({});
	// 同一时刻只允许一个行的「⋯」菜单开着：存 sessionId。
	const [menuFor, setMenuFor] = React.useState<string | null>(null);
	const grouping = useStore(groupingStore);
	const revision = useStore(mutationStore);
	const update = useStore(updateStore);
	// 官方侧边栏的"显示已归档"：初值从它自己的 localStorage 读；改完要刷新页面才生效，
	// 所以另外记住"挂载时是什么"，两者不一致时才提示刷新。
	const [sidebarArchived, setSidebarArchived] = React.useState(readSidebarArchived);
	const [sidebarAtMount] = React.useState(readSidebarArchived);

	const applyResult = (value: Snapshot | null): void => {
		if (value && value.archived) setSnapshot(value);
	};

	const refresh = React.useCallback(async (): Promise<void> => {
		setLoading(true);
		try {
			applyResult(await call<Snapshot>("snapshot", {}));
			setError(null);
		} catch (failure) {
			setError(reportError(failure));
		} finally {
			setLoading(false);
		}
	}, []);

	React.useEffect(() => {
		void refresh();
	}, [refresh, revision]);

	// 打开配置页时自动查一次更新（可以在配置页关掉；宿主那边 10 分钟内复用缓存）。
	React.useEffect(() => {
		if (tab !== "config" || !settings.autoUpdate || update.state !== "idle") return;
		void checkUpdate(false);
	}, [tab, settings.autoUpdate, update.state]);

	// 换页签时清空选择，避免把上一个页签的 id 带到下一个页签的操作里（折叠状态按页签各记各的）。
	React.useEffect(() => {
		setSelected([]);
		setMenuFor(null);
	}, [tab]);

	const run = async (endpoint: MutationEndpoint, ids: string[]): Promise<void> => {
		if (ids.length === 0) return;
		setBusy(true);
		try {
			const value = await call<MutationResult>(endpoint, { ids });
			applyResult(value);
			setError(firstFailure(value.results));
			setSelected([]);
		} catch (failure) {
			setError(reportError(failure));
		} finally {
			setBusy(false);
		}
	};

	const toggle = (sessionId: string): void => {
		setSelected((current) => current.includes(sessionId) ? current.filter((id) => id !== sessionId) : current.concat([sessionId]));
	};

	/** 整组一起选 / 取消选：组内全选就整组取消，否则补齐。 */
	const toggleGroup = (group: SessionGroup): void => {
		const ids = group.rows.map((row) => row.sessionId);
		const all = ids.every((id) => selected.includes(id));
		setSelected((current) => all
			? current.filter((id) => !ids.includes(id))
			: [...new Set(current.concat(ids))]);
	};

	/** 折叠 / 展开一个分组（规则见 `groups.ts` 的 `toggledCollapse`）。 */
	const toggleCollapse = (key: string): void => {
		setCollapsedOverrides((current) => toggledCollapse(key, current, settings.groupDefault));
	};

	const archived: PanelRow[] = snapshot ? snapshot.archived : [];
	const pinned: PanelRow[] = snapshot ? snapshot.pinned : [];
	const trashed: PanelRow[] = snapshot ? snapshot.trashed : [];
	const rows = sortRows(tab === "archived" ? archived : tab === "pinned" ? pinned : tab === "trash" ? trashed : [], settings.order);
	const selectedRows = rows.filter((row) => selected.includes(row.sessionId));

	// 分组只是显示层：选择、批量操作、计数仍然按整个页签的行来算。
	const groups = grouping ? groupRows(rows, t) : [];
	const blockOf = (group: SessionGroup): PanelBlock => {
		const key = collapseKey(tab, group.key);
		return { key, group, rows: isGroupCollapsed(key, collapsedOverrides, settings.groupDefault) ? [] : group.rows };
	};
	const blocks: PanelBlock[] = grouping ? groups.map(blockOf) : [{ key: `${tab}:flat`, group: null, rows }];

	const tabs: { id: PanelTab; label: string; count: number }[] = [
		{ id: "archived", label: t(TAB_LABEL.archived), count: archived.length },
		{ id: "pinned", label: t(TAB_LABEL.pinned), count: pinned.length },
		{ id: "trash", label: t(TAB_LABEL.trash), count: trashed.length },
		{ id: "config", label: t("titleConfig"), count: 0 }
	];

	/**
	 * 一行的「⋯」菜单内容。每个页签的动作本来就不同，但**控件形状统一**：
	 * 都是一行会话 + 一个 ⋯。
	 *
	 * 注意已归档那一组的第三项：以前是"永久删除"，可它走的是 `purge`，而 `purge`
	 * 只认回收站里的目录 —— 归档会话不在回收站，所以那个按钮**从来只会报
	 * "回收站里没有这个会话"**。现在改成真正可用的"移入回收站"（`trash`：先取消归档
	 * 再搬走，随时能恢复）。
	 */
	const rowMenu = (row: PanelRow): RowMenu => {
		const moveToTrash = {
			id: "trash",
			label: t("moveToTrash"),
			icon: React.createElement(IconTrashOutlineRegular, { size: 14 }),
			danger: true
		};
		if (tab === "archived") {
			return {
				items: [
					{ id: "unarchive", label: t("unarchive"), icon: React.createElement(IconUnarchiveOutlineRegular, { size: 14 }) },
					{ id: "pin", label: t("pin"), icon: React.createElement(IconPinOutlineRegular, { size: 14 }) },
					moveToTrash
				],
				run: (id) => {
					setMenuFor(null);
					if (id === "trash") requestTrash([row.sessionId], row.title);
					else void run(id as MutationEndpoint, [row.sessionId]);
				}
			};
		}
		if (tab === "pinned") {
			return {
				items: [
					{ id: "unpin", label: t("unpin"), icon: React.createElement(IconPinOutlineRegular, { size: 14 }) },
					moveToTrash
				],
				run: (id) => {
					setMenuFor(null);
					if (id === "trash") requestTrash([row.sessionId], row.title);
					else void run(id as MutationEndpoint, [row.sessionId]);
				}
			};
		}
		return {
			items: [
				{ id: "restore", label: t("restore"), icon: React.createElement(IconRefreshOutlineRegular, { size: 14 }) },
				{ id: "purge", label: t("purge"), icon: React.createElement(IconTrashOutlineRegular, { size: 14 }), danger: true }
			],
			run: (id) => {
				setMenuFor(null);
				if (id === "purge") requestPurge([row.sessionId], row.title);
				else void run(id as MutationEndpoint, [row.sessionId]);
			}
		};
	};

	const batch: { label: string; variant?: string; run: () => void }[] = [];
	if (tab === "archived" && selected.length > 0) {
		batch.push({ label: t("unarchive"), run: () => void run("unarchive", selected) });
		batch.push({ label: t("moveToTrash"), variant: "outline", run: () => requestTrash(selected, selectedRows[0] ? selectedRows[0].title : "") });
	}
	if (tab === "pinned" && selected.length > 0) {
		batch.push({ label: t("unpin"), run: () => void run("unpin", selected) });
		batch.push({ label: t("moveToTrash"), variant: "outline", run: () => requestTrash(selected, selectedRows[0] ? selectedRows[0].title : "") });
	}
	if (tab === "trash" && selected.length > 0) {
		batch.push({ label: t("restore"), run: () => void run("restore", selected) });
		batch.push({ label: t("purge"), variant: "outline", run: () => requestPurge(selected, selectedRows[0] ? selectedRows[0].title : "") });
	}

	const totals = snapshot ? snapshot.totals : null;
	const totalBytes = tab === "archived"
		? (totals ? totals.archivedBytes : 0)
		: tab === "trash"
			? (totals ? totals.trashBytes : 0)
			: 0;

	// 卡片里的显示节点：分组标题 + 行。第一个节点不要上边框（卡片自己有）。
	const nodes: React.ReactElement[] = [];
	let first = true;
	for (const block of blocks) {
		if (block.group !== null) {
			const group = block.group;
			const key = block.key;
			nodes.push(React.createElement(GroupHeader, {
				key: `group:${key}`,
				group,
				t,
				first,
				busy,
				selected,
				collapsed: isGroupCollapsed(key, collapsedOverrides, settings.groupDefault),
				onToggleGroup: () => toggleGroup(group),
				onToggleCollapse: () => toggleCollapse(key)
			}));
			first = false;
		}
		for (const row of block.rows) {
			nodes.push(React.createElement(SessionRow, {
				key: row.sessionId,
				row,
				t,
				first,
				busy,
				showCwd: block.group === null,
				showMeta: settings.showMeta,
				showDeletedAt: tab === "trash",
				checked: selected.includes(row.sessionId),
				onToggle: () => toggle(row.sessionId),
				menu: rowMenu(row),
				menuOpen: menuFor === row.sessionId,
				onToggleMenu: () => setMenuFor(menuFor === row.sessionId ? null : row.sessionId),
				onCloseMenu: () => setMenuFor(null)
			}));
			first = false;
		}
	}

	const isConfig = tab === "config";

	/** 配置页的一行：左边"标签 + 说明"，右边控件。 */
	const configRow = (key: string, label: string, hint: string | null, control: React.ReactElement, firstRow?: boolean): React.ReactElement => React.createElement(
		"div",
		{ key, style: firstRow ? { ...S.configRow, borderTop: "none" } : S.configRow },
		React.createElement(
			"div",
			{ style: S.configMain },
			React.createElement("span", { style: S.configLabel }, label),
			hint === null ? null : React.createElement("span", { style: S.configHint }, hint)
		),
		React.createElement("div", { style: S.configControl }, control)
	);

	/** 版本号优先用宿主报的（快照里带 `version`），其次用更新检查回来的当前版本。 */
	const version = snapshot !== null && typeof snapshot.version === "string"
		? snapshot.version
		: (update.value !== null && typeof update.value.current === "string" ? update.value.current : null);
	const outdated = update.state === "done" && update.value !== null && update.value.outdated === true;
	/** 状态行：检查中 / 失败 / 已是最新。有新版本时改用下面的升级块。 */
	const updateLine = update.state === "checking"
		? React.createElement("span", { style: S.configHint }, t("updateChecking"))
		: update.state === "failed"
			? React.createElement("span", { style: S.error }, text(t, "updateFailed", { reason: update.error === null ? "?" : update.error }))
			: update.value !== null && typeof update.value.error === "string"
				? React.createElement("span", { style: S.configHint }, text(t, "updateFailed", { reason: update.value.error }))
				: update.state === "done" && !outdated
					? React.createElement("span", { style: S.configHint }, t("updateLatest"))
					: null;

	const configPage = React.createElement(
		"div",
		{ style: S.column },
		React.createElement(
			"div",
			{ style: S.card },
			configRow("config:tab", t("configTab"), t("configTabHint"), React.createElement(SegmentedControl, {
				id: "session-curator-default-tab",
				value: settings.tab,
				options: [
					{ value: "archived", label: t(TAB_LABEL.archived) },
					{ value: "pinned", label: t(TAB_LABEL.pinned) },
					{ value: "trash", label: t(TAB_LABEL.trash) }
				],
				label: t("configTab"),
				onChange: (next: DataTab) => void updateSettings({ tab: next })
			}), true),
			configRow("config:grouping", t("configGrouping"), t("configGroupingHint"), React.createElement(Switch, {
				checked: settings.grouping,
				label: t("configGrouping"),
				onChange: (next: boolean) => {
					updateSettings({ grouping: next });
					groupingStore.set(next);
				}
			})),
			configRow("config:group-default", t("configGroupDefault"), t("configGroupDefaultHint"), React.createElement(SegmentedControl, {
				id: "session-curator-group-default",
				value: settings.groupDefault,
				options: [
					{ value: "expanded", label: t("groupExpanded") },
					{ value: "collapsed", label: t("groupCollapsed") }
				],
				label: t("configGroupDefault"),
				onChange: (next: GroupDefault) => void updateSettings({ groupDefault: next })
			})),
			configRow("config:sidebar-archived", t("configSidebarArchived"), t("configSidebarArchivedHint"), React.createElement(Switch, {
				checked: sidebarArchived !== "default",
				label: t("configSidebarArchived"),
				onChange: (next: boolean) => {
					writeSidebarArchived(next);
					setSidebarArchived(next ? "show" : "default");
				}
			})),
			// 官方 store 只在创建时读一次 localStorage，所以改完必须刷新页面。
			sidebarArchived === sidebarAtMount ? null : React.createElement(
				"div",
				{ key: "config:sidebar-refresh", style: S.configFoot },
				React.createElement("span", { style: S.configHint }, t("configSidebarRefreshHint")),
				React.createElement(Button, {
					size: "sm",
					variant: "outline",
					onClick: () => {
						try {
							globalThis.location.reload();
						} catch {
							// 没有 location（自检环境）时只保留提示
						}
					}
				}, t("refreshPage"))
			),
			configRow("config:meta", t("configMeta"), t("configMetaHint"), React.createElement(Switch, {
				checked: settings.showMeta,
				label: t("configMeta"),
				onChange: (next: boolean) => void updateSettings({ showMeta: next })
			})),
			configRow("config:order", t("configOrder"), t("configOrderHint"), React.createElement(SegmentedControl, {
				id: "session-curator-order",
				value: settings.order,
				options: [
					{ value: "host", label: t("orderHost") },
					{ value: "title", label: t("orderTitle") },
					{ value: "bytes", label: t("orderBytes") }
				],
				label: t("configOrder"),
				onChange: (next: "host" | "title" | "bytes") => void updateSettings({ order: next })
			})),
			configRow("config:auto", t("configAutoUpdate"), t("configAutoUpdateHint"), React.createElement(Switch, {
				checked: settings.autoUpdate,
				label: t("configAutoUpdate"),
				onChange: (next: boolean) => void updateSettings({ autoUpdate: next })
			})),
			React.createElement(
				"div",
				{ key: "config:reset", style: { ...S.configFoot, justifyContent: "flex-end" } },
				React.createElement(Button, {
					size: "sm",
					variant: "outline",
					onClick: () => {
						updateSettings({ ...DEFAULT_SETTINGS });
						groupingStore.set(DEFAULT_SETTINGS.grouping);
					}
				}, t("configReset"))
			)
		),

		React.createElement(
			"div",
			{ style: S.card },
			React.createElement(
				"div",
				{ style: { ...S.configRow, borderTop: "none" } },
				React.createElement(
					"div",
					{ style: S.configMain },
					React.createElement("span", { style: S.configLabel }, t("aboutTitle")),
					React.createElement("span", { style: S.configHint }, "dsh-session-curator")
				),
				React.createElement(
					"div",
					{ style: S.configControl },
					// 版本号：浅色小字。
					React.createElement("span", { style: S.version }, `${t("versionLabel")} ${version === null ? "—" : `v${version}`}`),
					React.createElement(Button, {
						size: "sm",
						variant: "outline",
						disabled: update.state === "checking",
						onClick: () => void checkUpdate(true)
					}, t("updateCheckNow"))
				)
			),
			updateLine === null ? null : React.createElement("div", { key: "config:update", style: S.configFoot }, updateLine),
			outdated && update.value !== null
				? React.createElement(
					"div",
					{ key: "config:upgrade", style: S.updateBox },
					React.createElement("span", { style: S.updateTitle }, text(t, "updateAvailable", { latest: update.value.latest ?? "?", current: version === null ? "?" : version })),
					React.createElement(
						"span",
						{ style: S.updateSteps },
						React.createElement("span", null, t("updateStepsTitle")),
						React.createElement("span", null, t("updateStepOne")),
						React.createElement("code", { style: S.code }, "dsh plugin --profile desktop add dsh-session-curator@latest"),
						React.createElement("span", null, t("updateStepTwo"))
					),
					React.createElement("a", {
						style: S.link,
						href: "https://www.npmjs.com/package/dsh-session-curator",
						target: "_blank",
						rel: "noreferrer"
					}, t("updateOpen"))
				)
				: null
		)
	);

	return React.createElement(
		"div",
		{ style: S.column },
		React.createElement(
			"div",
			{ style: S.header },
			React.createElement(
				"div",
				{ style: S.tabBar },
				tabs.map((entry) => React.createElement(Button, {
					key: entry.id,
					size: "sm",
					variant: tab === entry.id ? "primary" : "ghost",
					onClick: () => setTab(entry.id)
				}, `${entry.label}${entry.count > 0 ? ` (${entry.count})` : ""}`))
			),
			// 分组与刷新推到右边；配置页上没有它们。
			isConfig ? null : React.createElement(
				"div",
				{ style: S.headerActions },
				React.createElement(Button, {
					size: "sm",
					variant: "outline",
					title: t("groupHint"),
					onClick: () => {
						const next = !grouping;
						groupingStore.set(next);
						updateSettings({ grouping: next });
					}
				}, grouping ? t("groupingOn") : t("groupingOff")),
				React.createElement(Button, { size: "sm", variant: "outline", disabled: loading || busy, onClick: () => void refresh() }, t("refresh"))
			)
		),

		error ? React.createElement("div", { style: S.error }, error) : null,

		isConfig ? null : React.createElement(
			"div",
			{ style: S.card },
			loading && !snapshot
				? React.createElement("div", { style: S.empty }, t("loading"))
				: rows.length === 0
					? React.createElement("div", { style: S.empty }, tab === "archived" ? t("emptyArchived") : tab === "pinned" ? t("emptyPinned") : t("emptyTrash"))
					: React.createElement("div", { style: S.list }, nodes)
		),

		isConfig ? null : React.createElement(
			"div",
			{ style: S.rowLine },
			React.createElement(Button, {
				size: "sm",
				variant: "ghost",
				disabled: busy || rows.length === 0,
				onClick: () => setSelected(selected.length === rows.length ? [] : rows.map((row) => row.sessionId))
			}, selected.length === rows.length && rows.length > 0 ? t("selectNone") : t("selectAll")),
			batch.map((action) => React.createElement(Button, {
				key: action.label,
				size: "sm",
				variant: action.variant || "ghost",
				disabled: busy,
				onClick: action.run
			}, action.label)),
			tab === "trash" && trashed.length > 0
				? React.createElement(Button, {
					size: "sm",
					variant: "outline",
					disabled: busy,
					onClick: () => requestPurge(trashed.map((row) => row.sessionId), "")
				}, t("emptyTrashAll"))
				: null,
			busy ? React.createElement("span", { style: S.footer }, t("working")) : null
		),

		isConfig ? configPage : null,

		isConfig ? null : React.createElement(
			"div",
			{ style: S.footer },
			React.createElement("span", null, text(t, "total", { n: rows.length, size: formatBytes(totalBytes) })),
			grouping && groups.length > 0 ? React.createElement("span", null, text(t, "workspaces", { n: groups.length })) : null,
			selected.length > 0 ? React.createElement("span", null, text(t, "selected", { n: selected.length })) : null,
			snapshot ? React.createElement("span", { style: S.mono, title: snapshot.trashDir }, snapshot.trashDir) : null
		)
	);
}

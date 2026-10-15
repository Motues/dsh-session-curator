/**
 * 设置面板：已归档 / 已置顶两个数据页签 + 磁盘占用 + 配置页。
 *
 * 这个文件只做"装配与状态"：分组 / 排序 / 折叠的**规则**在 `groups.ts`（纯函数、可单测），
 * 与宿主通信在 `api.ts`。控件形状（一行会话 + 一个 ⋯）由 `session-row.ts` 统一。
 */
import * as React from "react";
import {
	Button,
	IconCopyOutlineRegular,
	IconFolderOpenRegular,
	IconPinOutlineRegular,
	IconSearchOutlineRegular,
	IconTrashOutlineRegular,
	IconUnarchiveOutlineRegular,
	Input,
	SegmentedControl,
	Switch
} from "@deepseek-ai/dsh-client-ui-primitives";
import { call, firstFailure } from "../api.js";
import { requestDelete, mutationStore } from "../dialog.js";
import { copyText, openSessionPath } from "../export.js";
import { formatBytes } from "../format.js";
import {
	collapseKey,
	filterRows,
	groupRows,
	isFilterActive,
	isGroupCollapsed,
	sortRows,
	toggledCollapse,
	workspaceSummaries,
	type CollapseOverrides,
	type FilterOptions,
	type GroupDefault,
	type OrderKey,
	type SessionGroup,
	type TimeFilter
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
import { cachedSnapshot, rememberSnapshot } from "../snapshot.js";
import { S } from "../styles.js";
import { showNotice } from "../toast.js";
import { updateStore, checkUpdate } from "../update.js";
import { Dropdown } from "./dropdown.js";
import { GroupHeader, workspaceActionsOf } from "./group-header.js";
import { SessionRow, type RowMenu } from "./session-row.js";
import { UsagePanel } from "./usage-panel.js";
import type { Endpoint, MutationResult, PanelRow, Snapshot, Usage } from "../../shared/protocol.js";

/**
 * 面板上的页签：两个数据页签 + 磁盘占用 + 配置页。
 *
 * 「磁盘占用」是**独立页签**（不塞进配置页）：它是一份"看数据"的视图，跟设置项混在一页
 * 会让配置页变成两件事的杂烩；独立成页之后它还能有自己的刷新按钮。
 */
type PanelTab = DataTab | "usage" | "config";
/** 会改动数据的端点（`run()` 只用来打这些）。 */
type MutationEndpoint = Exclude<Endpoint, "snapshot" | "describe" | "check-update" | "usage" | "open">;

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
	/**
	 * 快照的初值取自**模块级缓存**（见 `snapshot.ts`）：设置外壳每次进来都是重新挂载，
	 * 用 `null` 打头的话第一帧只能画"读取中…"，等宿主回话才长出列表 —— 用户看到的就是
	 * "进去先没有会话，闪一下才出现"。缓存里有上一份就先画它，`refresh()` 随后照常覆盖。
	 *
	 * 传函数是**惰性初值**（React 会调用它），与 `useStore()` 里 `store.get` 的写法一致。
	 */
	const [snapshot, setSnapshot] = React.useState<Snapshot | null>(cachedSnapshot);
	const [error, setError] = React.useState<string | null>(null);
	const [loading, setLoading] = React.useState<boolean>(true);
	const [busy, setBusy] = React.useState<boolean>(false);
	const [selected, setSelected] = React.useState<string[]>([]);
	// 手动翻过的分组（`<tab>:<groupKey>` → 是否折叠）；没翻过的跟随配置里的默认状态。
	const [collapsedOverrides, setCollapsedOverrides] = React.useState<CollapseOverrides>({});
	// 同一时刻只允许一个行的「⋯」菜单开着：存 sessionId。
	const [menuFor, setMenuFor] = React.useState<string | null>(null);
	// 分组标题上的「整个工作区」菜单：同一时刻只开一个（存分组 key）。
	const [workspaceMenuFor, setWorkspaceMenuFor] = React.useState<string | null>(null);
	// 磁盘占用视图（只读端点）：只在「磁盘占用」页签打开时拉。
	const [usage, setUsage] = React.useState<Usage | null>(null);
	const [usageError, setUsageError] = React.useState<string | null>(null);
	const [usageBusy, setUsageBusy] = React.useState<boolean>(false);
	/** 「磁盘占用」页签上那个刷新按钮的计数器：自增一次就重拉一次 `usage`。 */
	const [usageReload, setUsageReload] = React.useState<number>(0);
	/**
	 * 两个下拉的展开状态（受控）：`Dropdown` 自己不带 hook，见 `components/dropdown.ts` 的文件头。
	 * 同一时刻只开一个 —— 两个挨着的下拉同时展开会互相压住。
	 */
	const [openDropdown, setOpenDropdown] = React.useState<string | null>(null);
	const grouping = useStore(groupingStore);
	const revision = useStore(mutationStore);
	const update = useStore(updateStore);
	// 官方侧边栏的"显示已归档"：初值从它自己的 localStorage 读；改完要刷新页面才生效，
	// 所以另外记住"挂载时是什么"，两者不一致时才提示刷新。
	const [sidebarArchived, setSidebarArchived] = React.useState(readSidebarArchived);
	const [sidebarAtMount] = React.useState(readSidebarArchived);

	/**
	 * 收到一份新快照（`snapshot` 端点或任何变更端点的回包）就同时写进模块级缓存，
	 * 让"下次进来"的第一帧有数据可画。
	 */
	const applyResult = (value: Snapshot | null): void => {
		if (value && value.archived) {
			rememberSnapshot(value);
			setSnapshot(value);
		}
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
		setWorkspaceMenuFor(null);
	}, [tab]);

	// 磁盘占用：只在「磁盘占用」页签打开时拉一次（它会扫整个 sessions 根，不该随手就发）。
	// 每一次变更（revision 自增）之后也重拉 —— 归档 / 删除都会改变体积与榜单；
	// `usageReload` 是页签上那个刷新按钮的计数器（同一页签里手动重拉一次）。
	React.useEffect(() => {
		if (tab !== "usage") return;
		let cancelled = false;
		setUsageBusy(true);
		setUsageError(null);
		void call<Usage>("usage", {})
			.then((value) => {
				if (!cancelled) setUsage(value);
			})
			.catch((failure: unknown) => {
				if (!cancelled) {
					setUsage(null);
					setUsageError(reportError(failure));
				}
			})
			.finally(() => {
				if (!cancelled) setUsageBusy(false);
			});
		return () => {
			cancelled = true;
		};
	}, [tab, revision, usageReload]);

	/** 「磁盘占用」页签的刷新：只让那个 effect 重跑一次（它自己管 busy / 错误）。 */
	const refreshUsage = (): void => setUsageReload((current) => current + 1);

	/**
	 * 榜单上的动作 = 打端点 + **重拉占用视图**。
	 *
	 * `run()` 从不在失败时 reject（错误进 `error` 那一行），所以这里直接接 `.then`
	 * 就够 —— 成功失败都重拉一次，看到的都是宿主那边的新事实。
	 */
	const runUsageAction = (endpoint: "archive" | "unarchive", sessionId: string): void => {
		void run(endpoint, [sessionId]).then(() => refreshUsage());
	};

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
		setSelected((current) => (current.includes(sessionId) ? current.filter((id) => id !== sessionId) : current.concat([sessionId])));
	};

	/** 整组一起选 / 取消选：组内全选就整组取消，否则补齐。 */
	const toggleGroup = (group: SessionGroup): void => {
		const ids = group.rows.map((row) => row.sessionId);
		const all = ids.every((id) => selected.includes(id));
		setSelected((current) => (all ? current.filter((id) => !ids.includes(id)) : [...new Set(current.concat(ids))]));
	};

	/** 折叠 / 展开一个分组（规则见 `groups.ts` 的 `toggledCollapse`）。 */
	const toggleCollapse = (key: string): void => {
		setCollapsedOverrides((current) => toggledCollapse(key, current, settings.groupDefault));
	};

	const archived: PanelRow[] = snapshot ? snapshot.archived : [];
	const pinned: PanelRow[] = snapshot ? snapshot.pinned : [];
	const rows = sortRows(tab === "archived" ? archived : pinned, settings.order);
	/**
	 * 搜索与过滤**只影响显示**：勾选、批量操作与页签计数仍然按整个页签的行算
	 *（`selectedRows` 用的是上面那份未过滤的 `rows`）。排序先做、过滤后做，
	 * 所以过滤不会打乱用户选的排序。
	 */
	const filter: FilterOptions = React.useMemo(
		() => ({ search: settings.search, timeFilter: settings.timeFilter }),
		[settings.search, settings.timeFilter]
	);
	const filtered = React.useMemo(() => filterRows(rows, filter), [rows, filter]);
	const filtering = isFilterActive(filter);
	const selectedRows = rows.filter((row) => selected.includes(row.sessionId));

	// 分组只是显示层：选择、批量操作、计数仍然按整个页签的行来算。
	const groups = grouping ? groupRows(filtered, t) : [];
	const blockOf = (group: SessionGroup): PanelBlock => {
		const key = collapseKey(tab, group.key);
		return { key, group, rows: isGroupCollapsed(key, collapsedOverrides, settings.groupDefault) ? [] : group.rows };
	};
	const blocks: PanelBlock[] = grouping ? groups.map(blockOf) : [{ key: `${tab}:flat`, group: null, rows: filtered }];

	const tabs: { id: PanelTab; label: string; count: number }[] = [
		{ id: "archived", label: t(TAB_LABEL.archived), count: archived.length },
		{ id: "pinned", label: t(TAB_LABEL.pinned), count: pinned.length },
		{ id: "usage", label: t("titleUsage"), count: 0 },
		{ id: "config", label: t("titleConfig"), count: 0 }
	];

	/**
	 * 排序下拉的档位（原来是一排 `SegmentedControl` 滑块，多档挤不下所以改成下拉）。
	 * 顺序：原顺序 → 标题 → 体积 → 创建时间。
	 */
	const orderOptions = [
		{ value: "host" as OrderKey, label: t("orderHost") },
		{ value: "title" as OrderKey, label: t("orderTitle") },
		{ value: "bytes" as OrderKey, label: t("orderBytes") },
		{ value: "createdAt" as OrderKey, label: t("orderCreatedAt") }
	];

	/**
	 * 跨页签的工作区目标集合（分组标题上的「整个工作区」菜单用它）。
	 *
	 * 用**未过滤**的两份行算：过滤只影响显示，不该缩小"整个工作区"的范围
	 *（与批量操作按整个页签算的语义一致）。`workspaceSummaries` 是纯函数，自检直接单测。
	 */
	const summaries = React.useMemo(() => workspaceSummaries(archived, pinned), [archived, pinned]);

	/**
	 * 「复制路径 / 在资源管理器中显示」：两条路都要宿主先算出**绝对路径**
	 *（客户端不知道 `<DSH_HOME>` 在哪，也拿不到拼路径的机会 —— 见 `src/host/open.ts`）。
	 *
	 * 失败不弹错误条：这是个"顺手看一眼"的动作，用一句 toast 说清"路径是什么"比红字更合适。
	 */
	const copyRowPath = async (sessionId: string): Promise<void> => {
		try {
			const value = await openSessionPath(sessionId);
			const copied = await copyText(value.path);
			showNotice(copied ? text(t, "pathCopied", { path: value.path }) : text(t, "pathCopyFailed", { path: value.path }));
		} catch (failure) {
			showNotice(reportError(failure));
		}
	};

	const revealRow = async (sessionId: string): Promise<void> => {
		try {
			const value = await openSessionPath(sessionId, true);
			if (!value.revealed) {
				// 平台不支持 / 没有文件管理器：把路径复制下来，让用户自己打开，别让人卡在
				// 一句"失败了"上。
				await copyText(value.path);
				showNotice(text(t, "revealFailed", { reason: value.reason ?? "?", path: value.path }));
			}
		} catch (failure) {
			showNotice(reportError(failure));
		}
	};

	/**
	 * 一行的「⋯」菜单内容。每个页签的动作本来就不同，但**控件形状统一**：
	 * 都是一行会话 + 一个 ⋯。
	 *
	 * 删除项走 `requestDelete` —— 物理删除永远先弹确认框、且要勾"我明白这无法撤销"，
	 * 这个函数自己绝不打端点。
	 *
	 * 正在跑的会话：危险项置 `disabled`（宿主的删除端点那道检查照旧，它才是真正的把关）。
	 */
	const rowMenu = (row: PanelRow): RowMenu => {
		const running = row.active === true;
		const deleteSession = {
			id: "delete",
			label: t("deleteSession"),
			icon: React.createElement(IconTrashOutlineRegular, { size: 14 }),
			danger: true,
			disabled: running
		};
		// 定位 / 复制对两个页签都成立。
		const locate = [
			{ id: "copy-path", label: t("copyPath"), icon: React.createElement(IconCopyOutlineRegular, { size: 14 }) },
			{ id: "reveal", label: t("revealInFolder"), icon: React.createElement(IconFolderOpenRegular, { size: 14 }) }
		];
		/** 两个页签共用的"非动作项"（定位 / 复制），单独收一处免得两份菜单各写一遍。 */
		const handleLocate = (id: string): boolean => {
			if (id === "copy-path") {
				void copyRowPath(row.sessionId);
				return true;
			}
			if (id === "reveal") {
				void revealRow(row.sessionId);
				return true;
			}
			return false;
		};
		if (tab === "archived") {
			return {
				items: [
					{ id: "unarchive", label: t("unarchive"), icon: React.createElement(IconUnarchiveOutlineRegular, { size: 14 }) },
					{ id: "pin", label: t("pin"), icon: React.createElement(IconPinOutlineRegular, { size: 14 }) },
					deleteSession,
					...locate
				],
				run: (id) => {
					setMenuFor(null);
					if (handleLocate(id)) return;
					if (id === "delete") requestDelete([row.sessionId], row.title);
					else void run(id as MutationEndpoint, [row.sessionId]);
				}
			};
		}
		return {
			items: [
				{ id: "unpin", label: t("unpin"), icon: React.createElement(IconPinOutlineRegular, { size: 14 }) },
				deleteSession,
				...locate
			],
			run: (id) => {
				setMenuFor(null);
				if (handleLocate(id)) return;
				if (id === "delete") requestDelete([row.sessionId], row.title);
				else void run(id as MutationEndpoint, [row.sessionId]);
			}
		};
	};

	/**
	 * 分组标题上的「整个工作区」动作。
	 *
	 * 归档走 `archive`（`stopActivity` 留空：与单行菜单同一条路，正在跑的会话由宿主按活动
	 * 判据逐项拒绝）；删除先弹确认框（物理删除永远先问一次，且要勾"我明白这无法撤销"）。
	 */
	const runWorkspaceAction = (group: SessionGroup, id: string): void => {
		setWorkspaceMenuFor(null);
		const summary = summaries.get(group.key);
		if (summary === undefined) return;
		if (id === "archive") void run("archive", summary.archivableIds);
		if (id === "delete") requestDelete(summary.deletableIds, group.title);
	};

	const batch: { label: string; variant?: string; disabled?: boolean; run: () => void }[] = [];
	if (tab === "archived" && selected.length > 0) {
		batch.push({ label: t("unarchive"), run: () => void run("unarchive", selected) });
		batch.push({
			label: t("deleteSession"),
			variant: "outline",
			run: () => requestDelete(selected, selectedRows[0] ? selectedRows[0].title : "")
		});
	}
	if (tab === "pinned" && selected.length > 0) {
		batch.push({ label: t("unpin"), run: () => void run("unpin", selected) });
		batch.push({
			label: t("deleteSession"),
			variant: "outline",
			run: () => requestDelete(selected, selectedRows[0] ? selectedRows[0].title : "")
		});
	}

	const totals = snapshot ? snapshot.totals : null;
	const totalBytes = tab === "archived" && totals ? totals.archivedBytes : 0;

	// 卡片里的显示节点：分组标题 + 行。第一个节点不要上边框（卡片自己有）。
	const nodes: React.ReactElement[] = [];
	let first = true;
	for (const block of blocks) {
		if (block.group !== null) {
			const group = block.group;
			const key = block.key;
			const summary = summaries.get(group.key);
			nodes.push(
				React.createElement(GroupHeader, {
					key: `group:${key}`,
					group,
					t,
					first,
					busy,
					selected,
					collapsed: isGroupCollapsed(key, collapsedOverrides, settings.groupDefault),
					onToggleGroup: () => toggleGroup(group),
					onToggleCollapse: () => toggleCollapse(key),
					// 「整个工作区」：跨页签的目标集合由 `workspaceSummaries()` 算好。
					// 每个渲染出来的分组都至少有一行，所以 `summary` 一定有值；`workspaceActionsOf`
					// 再按"有没有在跑的会话"把危险项置 `disabled`。
					workspaceActions: summary === undefined ? [] : workspaceActionsOf(t, summary),
					workspaceMenuOpen: workspaceMenuFor === group.key,
					onToggleWorkspaceMenu: () => setWorkspaceMenuFor(workspaceMenuFor === group.key ? null : group.key),
					onCloseWorkspaceMenu: () => setWorkspaceMenuFor(null),
					onRunWorkspaceAction: (id: string) => runWorkspaceAction(group, id)
				})
			);
			first = false;
		}
		for (const row of block.rows) {
			nodes.push(
				React.createElement(SessionRow, {
					key: row.sessionId,
					row,
					t,
					first,
					busy,
					showCwd: block.group === null,
					showMeta: settings.showMeta,
					checked: selected.includes(row.sessionId),
					onToggle: () => toggle(row.sessionId),
					menu: rowMenu(row),
					menuOpen: menuFor === row.sessionId,
					onToggleMenu: () => setMenuFor(menuFor === row.sessionId ? null : row.sessionId),
					onCloseMenu: () => setMenuFor(null)
				})
			);
			first = false;
		}
	}

	const isConfig = tab === "config";
	const isUsage = tab === "usage";
	/** 三个**数据**页签（有列表 / 勾选 / 过滤 / 分组的那些）。 */
	const isDataTab = !isConfig && !isUsage;

	/** 配置页的一行：左边"标签 + 说明"，右边控件。 */
	const configRow = (
		key: string,
		label: string,
		hint: string | null,
		control: React.ReactElement,
		firstRow?: boolean
	): React.ReactElement =>
		React.createElement(
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

	/**
	 * 数据页签上的过滤工具条：搜索框 + 时间档。
	 *
	 * 放在页签下面、卡片上面 —— 它筛的是"卡片里显示什么"，跟页签同一层最自然。
	 */
	const filterBar = React.createElement(
		"div",
		{ style: S.filterBar },
		React.createElement(Input, {
			value: settings.search,
			placeholder: t("searchPlaceholder"),
			"aria-label": t("searchLabel"),
			icon: React.createElement(IconSearchOutlineRegular, {}),
			style: S.searchInput,
			onChange: (event: { target: { value: string } }) => void updateSettings({ search: event.target.value })
		}),
		filtering
			? React.createElement(
					Button,
					{
						size: "sm",
						variant: "ghost",
						onClick: () => void updateSettings({ search: "", timeFilter: "all" })
					},
					t("searchClear")
				)
			: null,
		React.createElement("div", { style: S.filterSpacer }),
		React.createElement(SegmentedControl, {
			id: "session-curator-time-filter",
			value: settings.timeFilter,
			options: [
				{ value: "all", label: t("timeAll") },
				{ value: "recent", label: t("timeRecent") }
			],
			label: t("timeFilterLabel"),
			onChange: (next: TimeFilter) => void updateSettings({ timeFilter: next })
		})
	);

	/** 版本号优先用宿主报的（快照里带 `version`），其次用更新检查回来的当前版本。 */
	const version =
		snapshot !== null && typeof snapshot.version === "string"
			? snapshot.version
			: update.value !== null && typeof update.value.current === "string"
				? update.value.current
				: null;
	const outdated = update.state === "done" && update.value !== null && update.value.outdated === true;
	/** 状态行：检查中 / 失败 / 已是最新。有新版本时改用下面的升级块。 */
	const updateLine =
		update.state === "checking"
			? React.createElement("span", { style: S.configHint }, t("updateChecking"))
			: update.state === "failed"
				? React.createElement(
						"span",
						{ style: S.error },
						text(t, "updateFailed", { reason: update.error === null ? "?" : update.error })
					)
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
			configRow(
				"config:tab",
				t("configTab"),
				t("configTabHint"),
				React.createElement(SegmentedControl, {
					id: "session-curator-default-tab",
					value: settings.tab,
					options: [
						{ value: "archived", label: t(TAB_LABEL.archived) },
						{ value: "pinned", label: t(TAB_LABEL.pinned) }
					],
					label: t("configTab"),
					onChange: (next: DataTab) => void updateSettings({ tab: next })
				}),
				true
			),
			configRow(
				"config:grouping",
				t("configGrouping"),
				t("configGroupingHint"),
				React.createElement(Switch, {
					checked: settings.grouping,
					label: t("configGrouping"),
					onChange: (next: boolean) => {
						updateSettings({ grouping: next });
						groupingStore.set(next);
					}
				})
			),
			configRow(
				"config:group-default",
				t("configGroupDefault"),
				t("configGroupDefaultHint"),
				React.createElement(SegmentedControl, {
					id: "session-curator-group-default",
					value: settings.groupDefault,
					options: [
						{ value: "expanded", label: t("groupExpanded") },
						{ value: "collapsed", label: t("groupCollapsed") }
					],
					label: t("configGroupDefault"),
					onChange: (next: GroupDefault) => void updateSettings({ groupDefault: next })
				})
			),
			configRow(
				"config:sidebar-archived",
				t("configSidebarArchived"),
				t("configSidebarArchivedHint"),
				React.createElement(Switch, {
					checked: sidebarArchived !== "default",
					label: t("configSidebarArchived"),
					onChange: (next: boolean) => {
						writeSidebarArchived(next);
						setSidebarArchived(next ? "show" : "default");
					}
				})
			),
			// 官方 store 只在创建时读一次 localStorage，所以改完必须刷新页面。
			sidebarArchived === sidebarAtMount
				? null
				: React.createElement(
						"div",
						{ key: "config:sidebar-refresh", style: S.configFoot },
						React.createElement("span", { style: S.configHint }, t("configSidebarRefreshHint")),
						React.createElement(
							Button,
							{
								size: "sm",
								variant: "outline",
								onClick: () => {
									try {
										globalThis.location.reload();
									} catch {
										// 没有 location（自检环境）时只保留提示
									}
								}
							},
							t("refreshPage")
						)
					),
			configRow(
				"config:meta",
				t("configMeta"),
				t("configMetaHint"),
				React.createElement(Switch, {
					checked: settings.showMeta,
					label: t("configMeta"),
					onChange: (next: boolean) => void updateSettings({ showMeta: next })
				})
			),
			// 排序：5 档，所以是下拉（`Dropdown` 见 components/dropdown.ts）。
			configRow(
				"config:order",
				t("configOrder"),
				t("configOrderHint"),
				React.createElement(Dropdown, {
					id: "session-curator-order",
					value: settings.order,
					options: orderOptions,
					label: t("configOrder"),
					open: openDropdown === "order",
					onToggle: (next: boolean) => setOpenDropdown(next ? "order" : null),
					onChange: (next: OrderKey) => void updateSettings({ order: next })
				})
			),
			configRow(
				"config:auto",
				t("configAutoUpdate"),
				t("configAutoUpdateHint"),
				React.createElement(Switch, {
					checked: settings.autoUpdate,
					label: t("configAutoUpdate"),
					onChange: (next: boolean) => void updateSettings({ autoUpdate: next })
				})
			),
			React.createElement(
				"div",
				{ key: "config:reset", style: { ...S.configFoot, justifyContent: "flex-end" } },
				React.createElement(
					Button,
					{
						size: "sm",
						variant: "outline",
						onClick: () => {
							updateSettings({ ...DEFAULT_SETTINGS });
							groupingStore.set(DEFAULT_SETTINGS.grouping);
						}
					},
					t("configReset")
				)
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
					React.createElement(
						Button,
						{
							size: "sm",
							variant: "outline",
							disabled: update.state === "checking",
							onClick: () => void checkUpdate(true)
						},
						t("updateCheckNow")
					)
				)
			),
			updateLine === null ? null : React.createElement("div", { key: "config:update", style: S.configFoot }, updateLine),
			outdated && update.value !== null
				? React.createElement(
						"div",
						{ key: "config:upgrade", style: S.updateBox },
						React.createElement(
							"span",
							{ style: S.updateTitle },
							text(t, "updateAvailable", { latest: update.value.latest ?? "?", current: version === null ? "?" : version })
						),
						React.createElement(
							"span",
							{ style: S.updateSteps },
							React.createElement("span", null, t("updateStepsTitle")),
							React.createElement("span", null, t("updateStepOne")),
							React.createElement("code", { style: S.code }, "dsh plugin --profile desktop add dsh-session-curator@latest"),
							React.createElement("span", null, t("updateStepTwo"))
						),
						React.createElement(
							"a",
							{
								style: S.link,
								href: "https://www.npmjs.com/package/dsh-session-curator",
								target: "_blank",
								rel: "noreferrer"
							},
							t("updateOpen")
						)
					)
				: null
		)
	);

	/**
	 * 「磁盘占用」页签：自己一页，只放那一块视图 + 一个刷新按钮。
	 *
	 * 刷新按钮只重拉 `usage`（不重拉快照）：这个页签上看到的全是 `usage` 的数据。
	 */
	const usagePage = React.createElement(
		"div",
		{ style: S.column },
		React.createElement(
			"div",
			{ style: S.rowLine },
			React.createElement("div", { style: S.filterSpacer }),
			React.createElement(
				Button,
				{
					size: "sm",
					variant: "outline",
					disabled: usageBusy,
					onClick: () => void refreshUsage()
				},
				t("refresh")
			)
		),
		React.createElement(UsagePanel, {
			t,
			usage,
			loading: usageBusy,
			error: usageError,
			busy,
			// 榜单上的动作走与列表同一个端点（`run()` 会顺手刷新快照），但**完事之后还要
			// 重拉一次 `usage`**：`run()` 只换快照，`usage` 不在快照里 —— 不重拉的话
			// 刚点了「取消归档」的那一行仍然顶着「已归档」胶囊，看起来像没生效。
			onArchive: (sessionId: string) => runUsageAction("archive", sessionId),
			onUnarchive: (sessionId: string) => runUsageAction("unarchive", sessionId)
		})
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
				tabs.map((entry) =>
					React.createElement(
						Button,
						{
							key: entry.id,
							size: "sm",
							variant: tab === entry.id ? "primary" : "ghost",
							onClick: () => setTab(entry.id)
						},
						`${entry.label}${entry.count > 0 ? ` (${entry.count})` : ""}`
					)
				)
			),
			// 分组与刷新推到右边；只有三个**数据**页签上才有它们（配置页与磁盘占用页都没有
			// 可筛可选的列表，磁盘占用页自带一个只重拉 usage 的刷新按钮）。
			isDataTab
				? React.createElement(
						"div",
						{ style: S.headerActions },
						React.createElement(
							Button,
							{
								size: "sm",
								variant: "outline",
								title: t("groupHint"),
								onClick: () => {
									const next = !grouping;
									groupingStore.set(next);
									updateSettings({ grouping: next });
								}
							},
							grouping ? t("groupingOn") : t("groupingOff")
						),
						React.createElement(
							Button,
							{ size: "sm", variant: "outline", disabled: loading || busy, onClick: () => void refresh() },
							t("refresh")
						)
					)
				: null
		),

		error ? React.createElement("div", { style: S.error }, error) : null,

		// 过滤工具条：只有数据页签上有（配置页没有列表可筛，磁盘占用页也不是列表）。
		isDataTab ? filterBar : null,

		isDataTab
			? React.createElement(
					"div",
					{ style: S.card },
					loading && !snapshot
						? React.createElement("div", { style: S.empty }, t("loading"))
						: filtered.length === 0
							? React.createElement(
									"div",
									{ style: S.empty },
									filtering ? t("emptyFiltered") : tab === "archived" ? t("emptyArchived") : t("emptyPinned")
								)
							: React.createElement("div", { style: S.list }, nodes)
				)
			: null,

		isDataTab
			? React.createElement(
					"div",
					{ style: S.rowLine },
					React.createElement(
						Button,
						{
							size: "sm",
							variant: "ghost",
							disabled: busy || rows.length === 0,
							onClick: () => setSelected(selected.length === rows.length ? [] : rows.map((row) => row.sessionId))
						},
						selected.length === rows.length && rows.length > 0 ? t("selectNone") : t("selectAll")
					),
					batch.map((action) =>
						React.createElement(
							Button,
							{
								key: action.label,
								size: "sm",
								variant: action.variant || "ghost",
								disabled: busy || action.disabled === true,
								onClick: action.run
							},
							action.label
						)
					),
					busy ? React.createElement("span", { style: S.footer }, t("working")) : null
				)
			: null,

		isUsage ? usagePage : null,

		isConfig ? configPage : null,

		isDataTab
			? React.createElement(
					"div",
					{ style: S.footer },
					React.createElement("span", null, text(t, "total", { n: rows.length, size: formatBytes(totalBytes) })),
					// 过滤只改显示：合计那一行报的仍是整个页签的条数，这里再补一句"筛出来几条"。
					filtering ? React.createElement("span", null, text(t, "filtered", { n: filtered.length, total: rows.length })) : null,
					grouping && groups.length > 0 ? React.createElement("span", null, text(t, "workspaces", { n: groups.length })) : null,
					selected.length > 0 ? React.createElement("span", null, text(t, "selected", { n: selected.length })) : null,
					snapshot ? React.createElement("span", { style: S.mono, title: snapshot.sessionsDir }, snapshot.sessionsDir) : null
				)
			: null
	);
}

/**
 * 客户端半区自检 —— 不需要浏览器，也不需要 DSH。
 *
 * 两段：
 *   A. 纯逻辑：给一个假的 `window.__ModuleLoader__` 截住束工厂，用最小 `react` 桩把工厂跑
 *      起来拿到导出，直接单测"按工作区文件夹分组"的 `groupRows` / `groupKeyOf`，
 *      再直接调两个纯 props 组件（`GroupHeader` / `SessionRow`，它们不用 hooks）。
 *   B. 渲染：同一个工厂配一个**迷你 React**（useState / useEffect / useCallback + 依赖比较），
 *      用假 `ctx` 调 `apply(ctx)`，拿到真正注册到 `settings.section` 的面板组件，喂一份假快照，
 *      断言分组标题、行归属、折叠、整组勾选、关分组、切页签 —— 不渲染 DOM，只走普通对象树。
 *
 * 用法：`node scripts/client.mjs`
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const BUNDLE = join(import.meta.dirname, "../lib/client.js");

let spec;
globalThis.window = {
	__ModuleLoader__: {
		load: (value) => {
			spec = value;
		}
	}
};
/** 内存版 localStorage：设置持久化走的就是它（浏览器里是 window.localStorage）。 */
const fakeStorage = new Map();
globalThis.localStorage = {
	getItem: (key) => (fakeStorage.has(key) ? fakeStorage.get(key) : null),
	setItem: (key, value) => {
		fakeStorage.set(key, String(value));
	},
	removeItem: (key) => {
		fakeStorage.delete(key);
	}
};

// ── 迷你 React：够跑一次挂载 + 若干次重渲染 ──────────────────────────────
const runtime = { index: 0, values: [], callbacks: [], records: [], pending: [], dirty: false };

const React = {
	// 记成普通对象树，断言直接走 type / props / children。
	// `type` 也留在**每个**元素上（真 React 的 element.type）：早先只有根节点带 `type`，
	// 所以子元素只能靠 `children[0].type` 摸；现在 `props.icon.type` 这种写法也能用。
	createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
	useState: (initial) => {
		const at = runtime.index++;
		if (!(at in runtime.values)) runtime.values[at] = typeof initial === "function" ? initial() : initial;
		const set = (next) => {
			runtime.values[at] = typeof next === "function" ? next(runtime.values[at]) : next;
			runtime.dirty = true;
		};
		return [runtime.values[at], set];
	},
	useEffect: (callback, deps) => {
		const at = runtime.index++;
		const previous = runtime.records[at];
		const changed =
			deps === undefined ||
			previous === undefined ||
			deps.length !== previous.deps.length ||
			deps.some((value, position) => !Object.is(value, previous.deps[position]));
		runtime.records[at] = { deps, cleanup: previous?.cleanup };
		runtime.pending.push({ at, callback, run: changed });
	},
	useCallback: (callback) => {
		const at = runtime.index++;
		runtime.callbacks[at] ??= callback;
		return runtime.callbacks[at];
	},
	/**
	 * `useMemo` 只按**依赖数组**判断是否重算，与真 React 的语义一致 —— 面板用它把
	 * "过滤后的行"缓存起来（`useState` 那套按槽位存值不够：这里要连依赖一起记）。
	 * 槽位仍然占用 `runtime.index`，否则后面的 hook 下标会与真 React 的调用顺序错位。
	 */
	useMemo: (factory, deps) => {
		const at = runtime.index++;
		const previous = runtime.records[at];
		const changed =
			previous === undefined ||
			deps === undefined ||
			previous.deps === undefined ||
			deps.length !== previous.deps.length ||
			deps.some((value, position) => !Object.is(value, previous.deps[position]));
		if (changed) runtime.records[at] = { deps, cleanup: previous?.cleanup, value: factory() };
		return runtime.records[at].value;
	}
};

/** 跑一次渲染 + 本轮该跑的 effect，直到不再有 setState 为止（上限兜底防死循环）。 */
async function render(component, props) {
	let tree;
	for (let pass = 0; pass < 8; pass += 1) {
		runtime.index = 0;
		runtime.pending = [];
		runtime.dirty = false;
		tree = component(props);
		for (const entry of runtime.pending) {
			if (!entry.run) continue;
			const record = runtime.records[entry.at];
			if (typeof record.cleanup === "function") record.cleanup();
			const cleanup = entry.callback();
			record.cleanup = typeof cleanup === "function" ? cleanup : undefined;
		}
		await new Promise((resolve) => setTimeout(resolve, 0));
		if (!runtime.dirty) break;
	}
	return tree;
}

/** 迷你渲染器不递归组件：需要看组件内部时显式调一次（这两个组件都不用 hooks）。 */
function draw(node) {
	return typeof node.type === "function" ? node.type(node.props) : node;
}

/**
 * 清空 hook 槽位：迷你 React 按**下标**把状态存在模块级数组里，所以渲染另一个组件之前
 * 必须清一次，否则两个组件的 useState 会互相顶掉（面板那条链路自始至终只渲染一个组件，
 * 才能一路带着状态走下去）。
 *
 * 清之前先跑一遍"卸载清理"：`useStore()` 的 effect 返回的是**退订函数**，而它是按槽位
 * 下标回调 `setValue` 的 —— 不退订的话，上一个组件留在 store 里的订阅会在下一次
 * `store.set()` 时写进新组件的同名槽位（曾经因此让弹窗宿主任凭一个 toast 通知当成了
 * 待确认请求）。
 */
function resetHooks() {
	for (const record of runtime.records) {
		if (record !== undefined && typeof record.cleanup === "function") record.cleanup();
	}
	runtime.values = [];
	runtime.records = [];
	runtime.callbacks = [];
	runtime.pending = [];
	runtime.index = 0;
	runtime.dirty = false;
}

/** 深度收集节点，便于按 `type` 找组件。 */
function collect(node, out = []) {
	if (node === null || node === undefined || typeof node !== "object") return out;
	if (Array.isArray(node)) {
		for (const item of node) collect(item, out);
		return out;
	}
	if (node.type !== undefined) out.push(node);
	for (const child of node.children ?? []) collect(child, out);
	return out;
}

await import(pathToFileURL(BUNDLE).href);

/** 只桩工厂在**加载期**真正碰到的东西。名字与 DSH 的真实导出逐一核对过。 */
const PRIMITIVE_NAMES = [
	"Button",
	"Input",
	"Menu",
	"MenuItemButton",
	"Modal",
	"SegmentedControl",
	"Switch",
	"Toast",
	"Tooltip",
	"IconArchiveOutlineRegular",
	"IconCheckOutlineRegular",
	"IconChevronDownOutlineRegular",
	"IconChevronRightOutlineRegular",
	"IconChevronsUpDownOutlineRegular",
	"IconCopyOutlineRegular",
	"IconEllipsisOutlineRegular",
	"IconFolderCloseRegular",
	"IconFolderOpenRegular",
	"IconPinOutlineRegular",
	"IconRefreshOutlineRegular",
	"IconSearchOutlineRegular",
	"IconTrashOutlineRegular",
	"IconUnarchiveOutlineRegular",
	"IconWarningOutlineRegular"
];
function requireStub(name) {
	if (name === "react") return React;
	if (name === "@deepseek-ai/dsh-client-ui-primitives") {
		// 每个名字映射成它自己：元素 type 就是组件名，断言直接看名字。
		return Object.fromEntries(PRIMITIVE_NAMES.map((primitive) => [primitive, primitive]));
	}
	throw new Error(`unexpected require(${JSON.stringify(name)})`);
}

const checks = [];
function check(label, condition, detail) {
	checks.push({ label, ok: Boolean(condition) });
	console.log(`${condition ? "  ok  " : " FAIL "} ${label}${detail === undefined ? "" : `  — ${detail}`}`);
}

check("bundle exposes its id", spec?.id === "dsh-session-curator", spec?.id);

const client = spec.factory(requireStub);
const { groupRows, groupKeyOf, SessionRow, GroupHeader } = client;
check("groupRows / groupKeyOf are exported as pure functions", typeof groupRows === "function" && typeof groupKeyOf === "function");
check(
	"the new filter/sort helpers are exported too",
	["sortRows", "filterRows", "matchesSearch", "isFilterActive", "workspaceSummaries"].every(
		(name) => typeof client[name] !== "undefined"
	),
	["sortRows", "filterRows", "matchesSearch", "isFilterActive", "workspaceSummaries"]
		.map((name) => `${name}=${typeof client[name]}`)
		.join(", ")
);

// 折叠决策（`groups.ts`）：默认状态 + 手动覆盖两张表合成一个答案。
check(
	"isGroupCollapsed lets untouched folders follow the configured default",
	client.isGroupCollapsed("archived:k", {}, "collapsed") === true && client.isGroupCollapsed("archived:k", {}, "expanded") === false
);
check(
	"isGroupCollapsed prefers the manual override",
	client.isGroupCollapsed("archived:k", { "archived:k": false }, "collapsed") === false &&
		client.isGroupCollapsed("archived:k", { "archived:k": true }, "expanded") === true
);
check(
	"toggledCollapse records an override, and drops it again once it matches the default",
	JSON.stringify(client.toggledCollapse("k", {}, "expanded")) === '{"k":true}' &&
		JSON.stringify(client.toggledCollapse("k", { k: true }, "expanded")) === "{}" &&
		JSON.stringify(client.toggledCollapse("k", {}, "collapsed")) === '{"k":false}' &&
		JSON.stringify(client.toggledCollapse("k", { k: false }, "collapsed")) === "{}",
	`${JSON.stringify(client.toggledCollapse("k", {}, "expanded"))} / ${JSON.stringify(client.toggledCollapse("k", { k: true }, "expanded"))} / ${JSON.stringify(client.toggledCollapse("k", {}, "collapsed"))}`
);
check(
	"collapseKey keeps the state per tab",
	client.collapseKey("pinned", "unknown") === "pinned:unknown",
	client.collapseKey("pinned", "unknown")
);

const t = (key) =>
	({
		noProject: "(unknown)",
		sessions: "{n} sessions",
		selectAllShort: "Select all",
		clearShort: "Clear",
		rowActions: "More actions"
	})[key] ?? key;

/** 造一行：只保留分组会看的字段。 */
const row = (sessionId, cwd, workspaceTitle, bytes, workspaceId) => ({ sessionId, cwd, workspaceTitle, bytes, workspaceId });

// ── A. 分组纯逻辑 ────────────────────────────────────────────────────────
// 1) 同一个文件夹的不同写法必须落到同一组：大小写、末尾分隔符、正反斜杠。
const sameFolder = groupRows(
	[
		row("a", "C:\\Data\\Desktop\\Github\\Momo", "Momo", 100),
		row("b", "c:/data/desktop/github/momo\\", "Momo", 250),
		row("c", "C:\\Data\\Desktop\\Github\\Momo\\", null, 0)
	],
	t
);
check(
	"cwd casing / separators / trailing slash collapse into one group",
	sameFolder.length === 1 && sameFolder[0].rows.length === 3,
	`${sameFolder.length} group(s)`
);
check("group bytes accumulate (non-numbers ignored)", sameFolder[0].bytes === 350, String(sameFolder[0].bytes));

// 2) 组名：先 workspaceTitle，再文件夹名，最后 (unknown)。
const titles = groupRows([row("a", "C:\\work\\Alpha", "Alpha 标题", 1), row("b", "C:\\work\\beta", null, 1), row("c", null, null, 1)], t);
check(
	"title prefers workspaceTitle, then the folder basename",
	titles.some((group) => group.title === "Alpha 标题") && titles.some((group) => group.title === "beta"),
	titles.map((group) => group.title).join(", ")
);
check(
	'rows with neither cwd nor workspaceId land in the "unknown" group, sorted last',
	titles[titles.length - 1].title === "(unknown)" && titles[titles.length - 1].key === "unknown"
);

// 3) 组间按标题排序（与宿主顺序无关），组内保持宿主顺序。
const ordered = groupRows(
	[row("z1", "C:\\w\\Zeta", "Zeta", 1), row("a1", "C:\\w\\alpha", "alpha", 1), row("z2", "C:\\w\\Zeta", "Zeta", 1)],
	t
);
check(
	"groups are sorted by title",
	ordered.map((group) => group.title).join(" < ") === "alpha < Zeta",
	ordered.map((group) => group.title).join(", ")
);
check(
	"rows keep the host order inside a group",
	ordered[1].rows.map((entry) => entry.sessionId).join(",") === "z1,z2",
	ordered[1].rows.map((entry) => entry.sessionId).join(",")
);

// 4) 没有 cwd 时退到 workspaceId：不同工作区不能被并成一组。
const byId = groupRows([row("a", null, "W1", 1, "ws-1"), row("b", null, "W1", 1, "ws-2")], t);
check(
	"missing cwd falls back to workspaceId",
	byId.length === 2 && byId.every((group) => group.key.startsWith("id:")),
	byId.map((group) => group.key).join(", ")
);

// 5) 空输入 / 空 cwd 字符串都不炸。
check("empty input yields no groups", groupRows([], t).length === 0);
check(
	"blank cwd is treated as missing",
	groupKeyOf({ sessionId: "a", cwd: "   " }) === "unknown",
	groupKeyOf({ sessionId: "a", cwd: "   " })
);

// ── A2. 搜索与过滤纯逻辑（只影响显示，见 groups.ts） ─────────────────────
const filterRow = (sessionId, extra) => ({ sessionId, title: sessionId, cwd: null, workspaceTitle: null, bytes: 0, files: 0, ...extra });
check(
	"search matches the title case-insensitively",
	client.matchesSearch(filterRow("a", { title: "Fix Header" }), "header") &&
		client.matchesSearch(filterRow("a", { title: "Fix Header" }), "HEADER") &&
		!client.matchesSearch(filterRow("a", { title: "Fix Header" }), "footer"),
	""
);
check(
	"search matches the original folder and the workspace title too",
	client.matchesSearch(filterRow("a", { cwd: "C:\\Data\\BlogPage" }), "blogpage") &&
		client.matchesSearch(filterRow("a", { workspaceTitle: "Momo" }), "momo"),
	""
);
check(
	"an empty search keeps every row",
	client.filterRows([filterRow("a"), filterRow("b")], { search: "   ", timeFilter: "all" }).length === 2
);

const now = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const ages = [
	filterRow("fresh", { createdAt: now - 1 * DAY }),
	filterRow("old", { createdAt: now - 30 * DAY }),
	filterRow("unknown", { createdAt: null })
];
const recent = client.filterRows(ages, { search: "", timeFilter: "recent", now });
check(
	"the recent filter keeps rows inside the 7-day window and drops the timeless one",
	recent.map((row) => row.sessionId).join(",") === "fresh",
	recent.map((row) => row.sessionId).join(",")
);
check(
	"timeFilter = all never drops rows without a timestamp",
	client.filterRows(ages, { search: "", timeFilter: "all", now }).length === 3
);
check(
	"isFilterActive tells the panel when to show the filtered counter",
	client.isFilterActive({ search: "x", timeFilter: "all" }) &&
		client.isFilterActive({ search: "", timeFilter: "recent" }) &&
		!client.isFilterActive({ search: " ", timeFilter: "all" })
);

// 新排序：时间都是"新的在前"，没有时间的沉底（0 或 null 不能被当成"刚建的"）。
const sortedByCreated = client.sortRows(
	[
		filterRow("none", { createdAt: null }),
		filterRow("newer", { createdAt: 200 }),
		filterRow("older", { createdAt: 100 }),
		filterRow("zero", { createdAt: 0 })
	],
	"createdAt"
);
check(
	"order = createdAt puts the newest first and the timeless last",
	sortedByCreated.map((row) => row.sessionId).join(",") === "newer,older,none,zero",
	sortedByCreated.map((row) => row.sessionId).join(",")
);

// 6) 两个新组件是纯 props 函数，可以直接调。
const alpha = groupRows([row("a", "C:\\w\\Alpha", "Alpha", 10), row("b", "C:\\w\\Alpha", "Alpha", 20)], t)[0];

let collapses = 0;
let groupToggles = 0;
const header = GroupHeader({
	group: alpha,
	t,
	first: true,
	busy: false,
	selected: ["a", "b"],
	collapsed: false,
	onToggleCollapse: () => {
		collapses += 1;
	},
	onToggleGroup: () => {
		groupToggles += 1;
	}
});
const headerChildren = header.children;
const toggleButton = headerChildren[0];
const selectButton = headerChildren[1];
check(
	"group header hides the card top border and paints a faint band",
	header.props.style.borderTop === "none" && header.props.style.background === "var(--dsw-alias-interactive-bg-active)"
);
check(
	"no checkbox on the left of the folder row",
	headerChildren.length >= 2 && toggleButton.type === "button" && toggleButton.children.every((child) => child?.type !== "input"),
	`len=${headerChildren.length} types=${headerChildren.map((child) => String(child?.type)).join(",")}`
);

// 标题按钮里的顺序：折叠箭头 → 文件夹图标 → 名字 → 数量 → 体积 → 路径。
const toggleChildren = toggleButton.children;
check(
	"the chevron sits before the folder icon, which sits before the name",
	toggleChildren[0].type === "span" &&
		toggleChildren[0].children[0].type === "IconChevronDownOutlineRegular" &&
		toggleChildren[1].type === "span" &&
		toggleChildren[1].children[0].type === "IconFolderOpenRegular" &&
		toggleChildren[2].children[0] === "Alpha"
);
check(
	"the folder icon is dimmer than the title and inherits currentColor",
	toggleChildren[1].props.style.color === "var(--dsw-alias-label-secondary)" && toggleChildren[1].children[0].props.size === 14
);
const headerLabels = toggleChildren.filter((child) => typeof child?.children?.[0] === "string").map((child) => child.children[0]);
check(
	"group header shows title, count and size",
	["Alpha", "2 sessions", "30 B"].every((label) => headerLabels.includes(label)),
	JSON.stringify(headerLabels)
);
check(
	"a fully selected group offers the short clear action on the right",
	selectButton.type === "Button" && selectButton.children[0] === "Clear" && selectButton.props.title.includes("Alpha")
);
// 长路径回归：右侧动作按钮不参与 flex 收缩、也不许折行；收缩全部由左侧折叠按钮消化
//（标题 / 路径各有 minWidth: 0 + 省略号）。DSH 的 Button 没有 white-space: nowrap，
// 一旦被挤窄，中文标签就会在按钮里折成两行。
check(
	"the right-hand action button neither shrinks nor wraps its label",
	selectButton.props.style?.flex === "0 0 auto" && selectButton.props.style?.whiteSpace === "nowrap",
	JSON.stringify(selectButton.props.style)
);
check(
	"the folder toggle is the flex item that absorbs the shrink (so title/path ellipsize instead)",
	toggleButton.props.style?.flex === "1 1 auto" && toggleButton.props.style?.minWidth === 0,
	JSON.stringify({ flex: toggleButton.props.style?.flex, minWidth: toggleButton.props.style?.minWidth })
);
toggleButton.props.onClick();
selectButton.props.onClick();
check(
	"header click / right-hand button call the handlers",
	collapses === 1 && groupToggles === 1,
	`collapse=${collapses} select=${groupToggles}`
);

const freshHeader = GroupHeader({
	group: alpha,
	t,
	first: false,
	busy: true,
	selected: [],
	collapsed: false,
	onToggleCollapse: () => {},
	onToggleGroup: () => {}
});
check(
	"an unselected group offers Select all and disables it while busy",
	freshHeader.children[1].children[0] === "Select all" && freshHeader.children[1].props.disabled === true
);

const collapsedHeader = GroupHeader({
	group: alpha,
	t,
	first: false,
	busy: false,
	selected: [],
	collapsed: true,
	onToggleCollapse: () => {},
	onToggleGroup: () => {}
});
const collapsedToggle = draw(collapsedHeader).children[0];
check(
	"collapsing swaps chevron-down for chevron-right and the open folder for a closed one",
	collapsedToggle.children[0].children[0].type === "IconChevronRightOutlineRegular" &&
		collapsedToggle.children[1].children[0].type === "IconFolderCloseRegular"
);

// 行：动作收进一个「⋯」菜单。
const menu = { items: [{ id: "restore", label: "Restore", icon: null }], run: () => {} };
const rowMenuOf = (element) => draw(element).children[2].children[0];
const withCwd = SessionRow({
	row: alpha.rows[0],
	t,
	first: true,
	busy: false,
	showCwd: true,
	showDeletedAt: false,
	checked: false,
	onToggle: () => {},
	menu,
	menuOpen: false,
	onToggleMenu: () => {},
	onCloseMenu: () => {}
});
const withoutCwd = SessionRow({
	row: alpha.rows[0],
	t,
	first: false,
	busy: false,
	showCwd: false,
	showDeletedAt: false,
	checked: true,
	onToggle: () => {},
	menu,
	menuOpen: true,
	onToggleMenu: () => {},
	onCloseMenu: () => {}
});
const metaOf = (element) => element.children[1].children[1].children.join("");
check(
	"row shows the folder only in flat mode",
	metaOf(withCwd).includes("C:\\w\\Alpha") && !metaOf(withoutCwd).includes("C:\\w\\Alpha"),
	`${JSON.stringify(metaOf(withCwd))} vs ${JSON.stringify(metaOf(withoutCwd))}`
);
check(
	"a row's right side is exactly one ⋯ menu, not a row of buttons",
	draw(withoutCwd).children[2].children.length === 1 && rowMenuOf(withoutCwd).type === "Menu"
);
const rowMenuElement = rowMenuOf(withoutCwd);
check(
	"the menu is anchored to an icon-only ghost Button carrying the ellipsis icon",
	rowMenuElement.props.anchor.type === "Button" &&
		rowMenuElement.props.anchor.props.variant === "ghost" &&
		rowMenuElement.props.anchor.props.icon.type === "IconEllipsisOutlineRegular" &&
		rowMenuElement.props.anchor.props.children === undefined,
	`icon=${rowMenuElement.props.anchor.props.icon?.type}`
);
check(
	"the menu follows the panel's open state and portals itself",
	rowMenuElement.props.open === true && rowMenuOf(withCwd).props.open === false && rowMenuElement.props.portal === true
);
check(
	"the ⋯ trigger is dimmed like the sidebar's row actions",
	rowMenuElement.props.anchor.props.style.color === "var(--dsw-alias-label-secondary)" &&
		String(rowMenuElement.props.anchor.props["aria-label"]).includes("More actions")
);
check(
	"the ⋯ trigger keeps its own width when the title is long",
	rowMenuElement.props.anchor.props.style.flex === "0 0 auto",
	JSON.stringify(rowMenuElement.props.anchor.props.style)
);

// ── B. 整块面板：假 ctx 调 apply()，拿到真正注册的面板组件后渲染 ─────────
const SNAPSHOT = {
	dshHome: "C:\\Users\\Motues\\.dsh",
	version: "0.1.0",
	sessionsDir: "C:\\Users\\Motues\\.dsh\\sessions",
	archived: [
		{
			sessionId: "s-1",
			title: "修 Header",
			cwd: "C:\\Data\\Momo",
			workspaceId: "w1",
			workspaceTitle: "Momo",
			bytes: 100,
			files: 1,
			createdAt: 1,
			active: false
		},
		{
			sessionId: "s-2",
			title: "改毛玻璃",
			cwd: "C:\\Data\\Momo",
			workspaceId: "w1",
			workspaceTitle: "Momo",
			bytes: 200,
			files: 1,
			createdAt: 2,
			active: false
		},
		{
			sessionId: "s-3",
			title: "写博客",
			cwd: "C:\\Data\\BlogPage",
			workspaceId: "w2",
			workspaceTitle: "BlogPage",
			bytes: 300,
			files: 1,
			createdAt: 3,
			active: false
		}
	],
	// `s-4` 是**置顶且正在跑**的那一条：它验证两件事 —— 行内「运行中」胶囊，
	// 以及"整个工作区"的动作因为工作区里有活动会话而被禁用（跨页签判断）。
	pinned: [
		{
			sessionId: "s-4",
			title: "钉住的",
			cwd: "C:\\Data\\Momo",
			workspaceId: "w1",
			workspaceTitle: "Momo",
			bytes: 10,
			files: 1,
			createdAt: 4,
			active: true
		}
	],
	totals: { archived: 3, archivedBytes: 600, pinned: 1 },
	activeSessionIds: ["s-4"]
};

/**
/**
 * `usage` 的假回答：形状与宿主真实产出一致（见 src/shared/protocol.d.ts）。
 *
 * 行上刻意凑齐几种组合，好把右侧那个按钮的形态都摆出来：
 *   `s-4` 置顶 + 运行中 → 不给按钮（归档会先停掉它的工作）；
 *   `s-3` / `s-1` 已归档 → 「取消归档」（再点一次「归档」是幂等的空操作）；
 *   `s-5` / `s-9` 普通会话 → 「归档」。
 */
const USAGE = {
	totalSessions: 5,
	totalBytes: 4160,
	groups: [
		{ key: "cwd:c:/data/momo", title: "Momo", count: 4, bytes: 4064 },
		{ key: "cwd:c:/data/blogpage", title: "BlogPage", count: 1, bytes: 96 }
	],
	largest: [
		{
			sessionId: "s-4",
			title: "钉住的",
			cwd: "C:\\Data\\Momo",
			workspaceTitle: "Momo",
			bytes: 4000,
			files: 4,
			createdAt: 4,
			archived: false,
			pinned: true,
			active: true
		},
		{
			sessionId: "s-3",
			title: "写博客",
			cwd: "C:\\Data\\BlogPage",
			workspaceTitle: "BlogPage",
			bytes: 96,
			files: 2,
			createdAt: 3,
			archived: true,
			pinned: false,
			active: false
		}
	],
	oldest: [
		{
			sessionId: "s-1",
			title: "修 Header",
			cwd: "C:\\Data\\Momo",
			workspaceTitle: "Momo",
			bytes: 100,
			files: 1,
			createdAt: 1,
			archived: true,
			pinned: false,
			active: false
		},
		{
			sessionId: "s-9",
			title: "旧会话",
			cwd: "C:\\Data\\BlogPage",
			workspaceTitle: "BlogPage",
			bytes: 40,
			files: 1,
			createdAt: null,
			archived: false,
			pinned: false,
			active: false
		},
		{
			sessionId: "s-5",
			title: "普通会话",
			cwd: "C:\\Data\\Momo",
			workspaceTitle: "Momo",
			bytes: 64,
			files: 1,
			createdAt: 5,
			archived: false,
			pinned: false,
			active: false
		}
	]
};

/** `open` 的假回答：宿主回的绝对路径（客户端只负责复制 / 让宿主叫文件管理器）。 */
const OPEN_RESULT = { sessionId: "s-1", path: "C:\\Users\\Motues\\.dsh\\sessions\\--C-Data-Momo--\\s-1", revealed: false };
/** 记下 `open` 收到过的 target（断言"定位"那条真的要求 reveal）。 */
const openCalls = [];
/**
 * 剪贴板：记下 `navigator.clipboard.writeText` 写过什么。
 *
 * Node 21+ 自带一个**只读**的 `globalThis.navigator`（getter-only），所以不能用赋值 ——
 * 必须 `defineProperty` 覆盖（`configurable: true` 保证它可被再次定义）。
 */
const copied = [];
Object.defineProperty(globalThis, "navigator", {
	configurable: true,
	value: {
		clipboard: {
			writeText: async (value) => {
				copied.push(value);
			}
		}
	}
});

/** `describe` 的假回答：形状与宿主真实产出一致（见 src/shared/protocol.d.ts）。 */
const DETAILS = {
	"s-1": {
		sessionId: "s-1",
		title: "修 Header",
		cwd: "C:\\Data\\Momo",
		workspaceId: "w1",
		workspaceTitle: "Momo",
		slug: "--C-Data-Momo--",
		createdAt: 1,
		bytes: 100,
		files: 1,
		onDisk: true,
		archived: true,
		pinned: false,
		active: false
	},
	"s-9": {
		sessionId: "s-9",
		title: "旧会话",
		cwd: "C:\\Data\\BlogPage",
		workspaceId: "w2",
		workspaceTitle: "BlogPage",
		slug: "--C-Data-BlogPage--",
		createdAt: null,
		bytes: 40,
		files: 1,
		onDisk: true,
		archived: false,
		pinned: false,
		active: false
	}
};

const slots = [];
let dictionaries = null;
const hostCalls = [];
/** 更新检查的假回答；置 null 表示这次让宿主失败（测错误分支）。 */
let updateResponse = { current: "0.1.0", latest: "0.1.1", outdated: true, checkedAt: 0 };
/** 置 true 时 `delete` 回错误信封（测"删除失败"那条分支）。 */
let failDelete = false;
/** `usage` 的假回答；置 null 表示这次让宿主失败（测错误分支）。 */
let usageResponse = USAGE;
/** 置 true 时 `open`（reveal）回"没打开"，用来验证降级成"复制路径 + 提示"。 */
let failReveal = false;
const fakeCtx = {
	get: (name) =>
		name === "connection"
			? {
					rpc: {
						call: async (channel, endpoint, payload) => {
							hostCalls.push({ channel, endpoint, payload });
							if (endpoint.endsWith("check-update")) {
								if (updateResponse === null)
									return { ok: false, error: { code: "session-curator/error", message: "registry 不通" } };
								return { ok: true, value: updateResponse };
							}
							if (endpoint.endsWith("usage")) {
								// 失败时**抛**而不是回错误信封：`call()` 只在信封 `ok:false` 或抛错时拒绝，
								// 而面板的 catch 分支才是"把原因摆到界面上"的那条路。
								if (usageResponse === null) throw new Error("session-curator/error: 扫不动");
								return { ok: true, value: usageResponse };
							}
							if (endpoint.endsWith("open")) {
								openCalls.push(payload);
								const reveal = payload && payload.target === "reveal";
								return {
									ok: true,
									value:
										reveal && failReveal
											? { ...OPEN_RESULT, revealed: false, reason: "没有文件管理器" }
											: { ...OPEN_RESULT, revealed: reveal }
								};
							}
							if (endpoint.endsWith("describe")) {
								const id = payload && Array.isArray(payload.ids) ? payload.ids[0] : undefined;
								const detail = DETAILS[id];
								if (detail === undefined)
									return { ok: false, error: { code: "session-curator/error", message: "找不到这个会话" } };
								return { ok: true, value: detail };
							}
							if (endpoint.endsWith("delete") && failDelete) {
								return { ok: false, error: { code: "session-curator/error", message: "删除失败（自检）" } };
							}
							return { ok: true, value: SNAPSHOT };
						}
					}
				}
			: undefined,
	locale: {
		register: (namespace, dicts) => {
			dictionaries = dicts;
		},
		bind: () => (key) => dictionaries.zh[key] ?? key
	},
	slots: {
		inject: (slot, callback) => callback(),
		register: (options, component) => {
			slots.push({ options, component });
		},
		// 槽位账本：设置外壳的 navIcon(id) 只认几个固定 id，我们借 archived-sessions。
		entries: () => []
	},
	effect: (callback) => callback(),
	logger: { warn: (message) => console.log("   [warn]", message) }
};

client.apply(fakeCtx);
const section = slots.find((entry) => entry.options.name === "settings.section");
const slotOf = (name, id) => slots.find((entry) => entry.options.name === name && entry.options.id === id);
check(
	"apply() registers exactly the six contributions",
	slots.length === 6 &&
		section !== undefined &&
		slots.map((entry) => entry.options.id).join(",") ===
			"session-curator.delete,session-curator.dialog,archived-sessions,session-curator.hover,session-curator.delete-row,session-curator.toast",
	slots.map((entry) => `${entry.options.name}:${entry.options.id}`).join(", ")
);
check(
	"the two new sidebar seats are filled (hover card + inline row action)",
	slotOf("sidebar.session.row.hover", "session-curator.hover") !== undefined &&
		slotOf("sidebar.workspaces.session.row.action", "session-curator.delete-row") !== undefined &&
		slotOf("shell.overlay", "session-curator.toast") !== undefined
);
check(
	"the row action sorts after the official archive (100) / pin (200) entries",
	slotOf("sidebar.workspaces.session.row.action", "session-curator.delete-row").options.order > 200 &&
		slotOf("sidebar.session.row.hover", "session-curator.hover").options.order > 10,
	`row=${slotOf("sidebar.workspaces.session.row.action", "session-curator.delete-row").options.order} hover=${slotOf("sidebar.session.row.hover", "session-curator.hover").options.order}`
);
/** 面板拿到的 `t`：直接用面板注册时交上去的那份中文词典（带 {n} 插值）。 */
const tPanel = (key, params) => {
	let value = dictionaries.zh[key] ?? key;
	for (const name of Object.keys(params ?? {})) value = value.split(`{${name}}`).join(String(params[name]));
	return value;
};

/** 官方侧边栏的视图存储：预置成"显示已归档"，用来验证配置页那个开关读的是同一份设置。 */
globalThis.localStorage.setItem("dsh.workspace.view.v5", JSON.stringify({ groupBy: "flat", orderBy: "updated", archivedFilter: "show" }));

/**
 * 冷启动：缓存里一份快照都没有时，第一帧**只能**是"读取中…"。
 *
 * 要显式清一次而不是"反正这是本进程第一次渲染"：这条与下面的"热启动"成对，
 * 谁把 `loading && !snapshot` 那条分支弄没了，这里当场红。
 * `resetHooks()` 是因为这次直调没有跑 effect —— 不驻留 hook 槽位，
 * 后面那次真正的挂载才不会被当成"依赖没变的重复渲染"而跳过 effect。
 */
client.forgetSnapshot();
const coldFirstFrame = section.component({ t: tPanel });
check(
	"a cold first frame (nothing cached yet) shows the loading state",
	JSON.stringify(coldFirstFrame).includes("读取中") && collect(coldFirstFrame, []).every((node) => node.type !== client.SessionRow),
	JSON.stringify(collect(coldFirstFrame, []).filter((node) => node.type === client.SessionRow).length)
);
resetHooks();
let tree = await render(section.component, { t: tPanel });
check(
	"the first snapshot is remembered so the next mount has something to paint",
	client.cachedSnapshot() !== null &&
		client.cachedSnapshot().archived.length === 3 &&
		collect(tree, []).some((node) => node.type === client.SessionRow),
	JSON.stringify(client.cachedSnapshot() === null ? null : client.cachedSnapshot().archived.length)
);
const nodesOf = (current, type) => collect(current, []).filter((node) => node.type === type);
const headers = () => nodesOf(tree, client.GroupHeader);
const rowsSeen = () => nodesOf(tree, client.SessionRow);
/** 组标题的两个交互件：`[折叠按钮, 右侧全选按钮]`。 */
const partsOf = (element) => draw(element).children;
const footerText = () => JSON.stringify(tree);

check(
	"archived tab renders one group header per workspace, sorted by title",
	headers().length === 2 && headers()[0].props.group.title === "BlogPage" && headers()[1].props.group.title === "Momo",
	headers()
		.map((node) => node.props.group.title)
		.join(", ")
);
check("rows stay inside their group (1 + 2)", headers()[0].props.group.rows.length === 1 && headers()[1].props.group.rows.length === 2);
check("the card's first node has no top border", headers()[0].props.first === true && headers()[1].props.first === false);
check("rows are counted, not just headers", rowsSeen().length === 3, `${rowsSeen().length} row(s)`);
check("footer shows the session total", footerText().includes("3 个会话 · 600 B"));
check("footer carries the workspace count", footerText().includes("2 个工作区"));
check(
	"every group header renders the chevron, the folder icon and the right-hand select button",
	headers().every((node) => {
		const parts = partsOf(node);
		const toggle = parts[0].children;
		return (
			toggle[0].children[0].type === "IconChevronDownOutlineRegular" &&
			toggle[1].children[0].type === "IconFolderOpenRegular" &&
			parts[1].type === "Button" &&
			toggle.every((child) => child?.type !== "input")
		);
	}),
	""
);
check(
	"every folder row paints the faint band",
	headers().every((node) => draw(node).props.style.background === "var(--dsw-alias-interactive-bg-active)"),
	""
);
// 长路径回归（面板里也验一遍）：右侧按钮定宽不折行，路径那段自己带省略号。
check(
	"in the rendered panel every select button stays rigid and every path can ellipsize",
	headers().every((node) => {
		const parts = partsOf(node);
		// 按**文本**找路径那段：标题 span 的 tooltip 也是 cwd，别按 title 找（会先命中标题）。
		const path = parts[0].children.find((child) => typeof child?.children?.[0] === "string" && child.children[0].includes("\\"));
		return (
			parts[1].props.style.flex === "0 0 auto" &&
			parts[1].props.style.whiteSpace === "nowrap" &&
			path !== undefined &&
			path.props.style.minWidth === 0 &&
			path.props.style.textOverflow === "ellipsis"
		);
	}),
	JSON.stringify(headers().map((node) => partsOf(node)[1].props.style))
);

// ── 重新进入设置页 = 重新挂载：第一帧就该有数据（不闪"读取中…"） ──────────
// 设置外壳每次进设置页都会把我们这个 section **重新挂载**，面板里的 state 全是新的。
// 快照要是从 `null` 起步，第一帧只能画"读取中…"、等宿主回话才长出列表 —— 就是
// "进去先没有会话、闪一下才出现"。所以它有一份模块级缓存（`src/client/snapshot.ts`）。
resetHooks();
// 只渲染**一帧**（不跑 effect、不等宿主）：这样看到的才是"进去的那一瞬间"。
const remountedFirstFrame = section.component({ t: tPanel });
const firstFrameRows = collect(remountedFirstFrame, []).filter((node) => node.type === client.SessionRow);
check(
	"re-entering the panel paints the cached snapshot on the very first frame (no 读取中 flash)",
	firstFrameRows.length === 3 && !JSON.stringify(remountedFirstFrame).includes("读取中"),
	`${firstFrameRows.length} row(s) on the first frame`
);
// 再干净地挂载一次（这次真的跑 effect），把面板交回给后面的断言；顺带证明缓存
// 只是"先画上一眼"，后台那次 `snapshot` 照样会打。
resetHooks();
const snapshotCallsBeforeRemount = hostCalls.filter((entry) => entry.endpoint.endsWith("snapshot")).length;
tree = await render(section.component, { t: tPanel });
check(
	"the remount still refreshes from the host in the background",
	rowsSeen().length === 3 && hostCalls.filter((entry) => entry.endpoint.endsWith("snapshot")).length === snapshotCallsBeforeRemount + 1,
	`${hostCalls.filter((entry) => entry.endpoint.endsWith("snapshot")).length - snapshotCallsBeforeRemount} snapshot call(s)`
);

// 折叠 Momo 组：点它的标题按钮 → 该组的行必须消失，但组标题还在。
partsOf(headers()[1])[0].props.onClick();
tree = await render(section.component, { t: tPanel });
check(
	"collapsing a group keeps its header but hides its rows",
	headers().length === 2 && rowsSeen().length === 1,
	`${headers().length} header(s), ${rowsSeen().length} row(s)`
);
check(
	"the collapsed header shows a chevron-right and a closed folder",
	headers()[1].props.collapsed === true &&
		partsOf(headers()[1])[0].children[0].children[0].type === "IconChevronRightOutlineRegular" &&
		partsOf(headers()[1])[0].children[1].children[0].type === "IconFolderCloseRegular"
);

// 展开回来。
partsOf(headers()[1])[0].props.onClick();
tree = await render(section.component, { t: tPanel });
check("expanding restores the rows", rowsSeen().length === 3, `${rowsSeen().length} row(s)`);

// 整组勾选：点 Momo 组右侧的小按钮 → 该组两行都进选择，页脚出现"已选 2 项"，按钮翻成"取消"。
check("the right-hand button starts as 全选", partsOf(headers()[1])[1].children[0] === "全选", partsOf(headers()[1])[1].children[0]);
partsOf(headers()[1])[1].props.onClick();
tree = await render(section.component, { t: tPanel });
check("the group select button selects the whole workspace", footerText().includes("已选 2 项"));
check(
	"a fully selected group flips the button to 取消",
	partsOf(headers()[1])[1].children[0] === "取消",
	partsOf(headers()[1])[1].children[0]
);
partsOf(headers()[1])[1].props.onClick();
tree = await render(section.component, { t: tPanel });
check("clicking 取消 clears the whole workspace again", !footerText().includes("已选"));

// ── 「整个工作区」：跨页签的目标集合（分组标题右侧的第二个按钮） ──────────
// 分组标题现在有两个交互件 + 一个「⋯」：`[折叠按钮, 全选按钮, 工作区 Menu]`。
const workspaceMenuOf = (element) => collect(draw(element), []).filter((node) => node.type === "Menu")[0];
check(
	"a grouped header carries the whole-workspace ⋯ next to the select button",
	partsOf(headers()[1]).length === 3 &&
		workspaceMenuOf(headers()[1]) !== undefined &&
		workspaceMenuOf(headers()[1])
			.props.items.map((item) => item.id)
			.join(",") === "archive,delete",
	partsOf(headers()[1])
		.map((child) => String(child?.type))
		.join(",")
);
// Momo 组：归档页签里 s-1 / s-2 在，置顶页签里 s-4 在（正在跑）—— 两个目标集合都必须
// 覆盖整个工作区，而且"有会话在跑"必须把两个危险项都禁掉。
const momoMenu = () => workspaceMenuOf(headers()[1]).props.items;
check(
	"the whole-workspace action targets the workspace across tabs",
	workspaceMenuOf(headers()[1]).props.anchor.props["aria-label"].includes("整个工作区"),
	workspaceMenuOf(headers()[1]).props.anchor.props["aria-label"]
);
check(
	"a workspace holding a running session disables both destructive actions",
	momoMenu()[0].disabled === true && momoMenu()[1].disabled === true && momoMenu()[1].danger === true,
	JSON.stringify(momoMenu().map((item) => `${item.id}:${item.disabled}`))
);
// BlogPage 组：只有归档页签里的 s-3，没有正在跑的会话 → 两项都可点。
check(
	"a workspace without a running session can be archived as a whole",
	workspaceMenuOf(headers()[0]).props.items[0].disabled === false && workspaceMenuOf(headers()[0]).props.items[1].disabled === false,
	JSON.stringify(workspaceMenuOf(headers()[0]).props.items.map((item) => `${item.id}:${item.disabled}`))
);
// 点「整个工作区归档」→ 直接打宿主 `archive`，一次带上这个工作区在**两个页签**里的 id。
const workspaceCallsBefore = hostCalls.length;
workspaceMenuOf(headers()[0]).props.onSelect("archive");
tree = await render(section.component, { t: tPanel });
check(
	"archiving a whole workspace sends every non-archived session of it in one call",
	hostCalls.length === workspaceCallsBefore + 1 &&
		hostCalls[hostCalls.length - 1].endpoint === "session-curator/archive" &&
		hostCalls[hostCalls.length - 1].payload.ids.join(",") === "s-3",
	JSON.stringify(hostCalls[hostCalls.length - 1])
);
// 关掉分组 → 没有分组标题，也就没有工作区菜单。
// 这里不能借 `buttonByLabel()`：它是后面才声明的 `const`（在 TDZ 里），而工具条上的
// 「分组」按钮就是顶部条动作组里的第一个按钮 —— 直接按位置点。
const groupingToggle = () => collect(tree, []).find((node) => node.type === "Button" && (node.children?.[0] ?? "").startsWith("分组"));
groupingToggle().props.onClick();
tree = await render(section.component, { t: tPanel });
check("the whole-workspace menu only exists while grouping is on", headers().length === 0, `${headers().length} header(s)`);
groupingToggle().props.onClick();
tree = await render(section.component, { t: tPanel });
check("grouping is back on for the following checks", headers().length === 2, `${headers().length} header(s)`);

// ── 行的「⋯」菜单：形状统一、动作真的打到宿主 ──────────────────────────
const menusOf = (element) => collect(draw(element), []).filter((node) => node.type === "Menu");
const menuOfRow = (sessionId) => {
	const element = rowsSeen().find((node) => node.props.row.sessionId === sessionId);
	return element === undefined ? undefined : menusOf(element)[0];
};

check(
	"each session row has exactly one ⋯ menu",
	rowsSeen().length === 3 && rowsSeen().every((node) => menusOf(node).length === 1 && draw(node).children[2].children.length === 1),
	rowsSeen()
		.map((node) => menusOf(node).length)
		.join(",")
);
const archivedMenu = menuOfRow("s-1");
check(
	"archived rows offer unarchive / pin / delete plus locate, in that order",
	archivedMenu.props.items.map((item) => item.id).join(",") === "unarchive,pin,delete,copy-path,reveal",
	archivedMenu.props.items.map((item) => item.label).join(" · ")
);
check(
	"the destructive item is flagged danger and every item carries an icon",
	archivedMenu.props.items[2].danger === true &&
		archivedMenu.props.items[0].icon.type === "IconUnarchiveOutlineRegular" &&
		archivedMenu.props.items[2].icon.type === "IconTrashOutlineRegular",
	archivedMenu.props.items.map((item) => item.icon.type).join(",")
);
check(
	"the locate items are never disabled by the running flag (they are read-only)",
	archivedMenu.props.items[3].disabled === undefined &&
		archivedMenu.props.items[4].disabled === undefined &&
		archivedMenu.props.items[3].icon.type === "IconCopyOutlineRegular" &&
		archivedMenu.props.items[4].icon.type === "IconFolderOpenRegular",
	JSON.stringify(archivedMenu.props.items.slice(3))
);
check(
	"menus start closed",
	menusOf(rowsSeen()[0]).every((node) => node.props.open === false)
);

// 点 ⋯ → 只开这一行。
archivedMenu.props.anchor.props.onClick({ stopPropagation: () => {} });
tree = await render(section.component, { t: tPanel });
check("clicking ⋯ opens only that row's menu", menuOfRow("s-1").props.open === true && menuOfRow("s-2").props.open === false);

// 选"取消归档" → 关菜单 + 打到宿主 unarchive。
const callsBefore = hostCalls.length;
menuOfRow("s-1").props.onSelect("unarchive");
tree = await render(section.component, { t: tPanel });
check(
	"selecting unarchive closes the menu and calls the host once",
	menuOfRow("s-1").props.open === false &&
		hostCalls.length === callsBefore + 1 &&
		hostCalls[hostCalls.length - 1].endpoint === "session-curator/unarchive" &&
		hostCalls[hostCalls.length - 1].payload.ids.join(",") === "s-1",
	JSON.stringify(hostCalls[hostCalls.length - 1])
);

// 选"删除会话" → 不打宿主，改成弹确认框（物理删除永远先问）。
// 这个待确认请求**故意留着**：下面那条"共享弹窗显示待确认请求"的断言用的就是它。
menuOfRow("s-2").props.onSelect("delete");
tree = await render(section.component, { t: tPanel });
check(
	"selecting delete asks for confirmation instead of calling the host",
	hostCalls.length === callsBefore + 1 && menuOfRow("s-2").props.open === false
);

// ── 运行中徽标：宿主报的 `active` 决定胶囊与危险项的禁用 ─────────────────
// `s-4` 在置顶页签里，而且是 `active: true`。切过去看它的行。
// 页签按钮的文案带计数（"已置顶 (1)"），所以按前缀找，别用全等。
const tabButton = (prefix) => collect(tree, []).find((node) => node.type === "Button" && (node.children?.[0] ?? "").startsWith(prefix));
tabButton("已置顶").props.onClick();
tree = await render(section.component, { t: tPanel });
/**
 * 一行标题那一排的文本（标题 + 可能的胶囊）。
 *
 * 迷你渲染器不递归组件，所以标题行要 `draw` 一次；而且**标题本身是 `div`、胶囊是 `span`**
 * （`itemTitle` 是块级元素，加了胶囊才需要那一层 flex 行），所以这里按"直接子节点的文本"
 * 取，别按标签名过滤。
 */
const titleTexts = (sessionId) => {
	const element = rowsSeen().find((node) => node.props.row.sessionId === sessionId);
	const titleRow = draw(element).children[1].children[0];
	return (draw(titleRow).children ?? []).map((child) => child?.children?.[0]);
};
check(
	"a running session gets a 运行中 pill right after its title",
	rowsSeen().length === 1 && titleTexts("s-4").join(",") === "钉住的,运行中",
	JSON.stringify(titleTexts("s-4"))
);
/**
 * 标题那一排的**元素**（`[标题, 胶囊?]`）。与 `titleTexts` 同一套取法，但回节点本身 ——
 * 胶囊的颜色 / tooltip 都挂在它的 props 上。
 */
const titleNodes = (sessionId) => {
	const element = rowsSeen().find((node) => node.props.row.sessionId === sessionId);
	const titleRow = draw(element).children[1].children[0];
	return draw(titleRow).children ?? [];
};
const runningPill = () => titleNodes("s-4")[1];
check(
	"the pill is the blue one and carries the explanation as a tooltip",
	runningPill() !== undefined &&
		runningPill().props.style.color === "var(--dsw-alias-state-business-primary)" &&
		runningPill().props.style.flex === "0 0 auto" &&
		String(runningPill().props.title).includes("先停止它"),
	JSON.stringify({ color: runningPill()?.props.style.color, title: runningPill()?.props.title })
);
check(
	"a running session cannot be deleted from its ⋯ menu",
	menuOfRow("s-4")
		.props.items.map((item) => item.id)
		.join(",") === "unpin,delete,copy-path,reveal" && menuOfRow("s-4").props.items[1].disabled === true,
	JSON.stringify(menuOfRow("s-4").props.items.map((item) => `${item.id}:${item.disabled}`))
);
// 拦第二道：就算有人直接调 `run()`（自检就是这么做的），也不该打宿主。
const runningDeleteCalls = hostCalls.filter((entry) => entry.endpoint.endsWith("delete")).length;
menuOfRow("s-4").props.onSelect("delete");
tree = await render(section.component, { t: tPanel });
check(
	"the disabled item never reaches the host or the dialog",
	hostCalls.filter((entry) => entry.endpoint.endsWith("delete")).length === runningDeleteCalls,
	`${hostCalls.filter((entry) => entry.endpoint.endsWith("delete")).length - runningDeleteCalls} delete call(s)`
);
// 上面那次 `onSelect("delete")` 会把一个待确认请求留在共享弹窗里（这正是它的设计：
// 危险动作先问）。它要**留到后面**那条"共享弹窗显示待确认请求"的断言用 —— 这里不清理。
// 回已归档页签，后面的检查依赖它。
tabButton("已归档").props.onClick();
tree = await render(section.component, { t: tPanel });

// ── 复制路径 / 在资源管理器中显示（两条都要宿主先算出绝对路径） ───────────
const copyPathItem = () => menuOfRow("s-1").props.items.find((item) => item.id === "copy-path");
const copiedBefore = copied.length;
copyPathItem().label === "复制路径" ? menuOfRow("s-1").props.onSelect("copy-path") : undefined;
await new Promise((resolve) => setTimeout(resolve, 0));
tree = await render(section.component, { t: tPanel });
check(
	"copy path asks the host for the directory and writes it to the clipboard",
	openCalls.length > 0 &&
		openCalls[openCalls.length - 1].target === "path" &&
		copied.length === copiedBefore + 1 &&
		copied[copied.length - 1] === OPEN_RESULT.path,
	JSON.stringify({ target: openCalls[openCalls.length - 1]?.target, copied: copied[copied.length - 1] })
);
check(
	"the result is announced through the shared notice, not the panel error line",
	client.toastStore.get() !== null && String(client.toastStore.get().message).includes(OPEN_RESULT.path),
	JSON.stringify(client.toastStore.get())
);
client.toastStore.set(null);
menuOfRow("s-1").props.onSelect("reveal");
await new Promise((resolve) => setTimeout(resolve, 0));
check(
	"reveal asks the host with target = reveal and stays silent when it worked",
	openCalls[openCalls.length - 1].target === "reveal" && client.toastStore.get() === null,
	JSON.stringify(openCalls[openCalls.length - 1])
);
// 平台不支持时（宿主回 revealed: false）：复制路径 + 一句解释，而不是干巴巴的失败。
failReveal = true;
const copiedBeforeFallback = copied.length;
menuOfRow("s-1").props.onSelect("reveal");
await new Promise((resolve) => setTimeout(resolve, 0));
check(
	"a failed reveal falls back to copying the path and explains why",
	copied.length === copiedBeforeFallback + 1 &&
		copied[copied.length - 1] === OPEN_RESULT.path &&
		String(client.toastStore.get()?.message).includes("没有文件管理器"),
	String(client.toastStore.get()?.message)
);
failReveal = false;
client.toastStore.set(null);

// 关掉分组 → 平铺：没有组标题，行里重新显示文件夹。
/** 每次都要重新找按钮：元素是快照，闭包里的状态也会过期。 */
const buttonByLabel = (prefix) => collect(tree, []).find((node) => node.type === "Button" && (node.children?.[0] ?? "").startsWith(prefix));
check(
	"toolbar exposes the grouping toggle",
	buttonByLabel("分组") !== undefined,
	JSON.stringify(
		collect(tree, [])
			.filter((node) => node.type === "Button")
			.map((node) => node.children?.[0])
	)
);
buttonByLabel("分组").props.onClick();
tree = await render(section.component, { t: tPanel });
const flatMeta = rowsSeen().map((node) => metaOf(draw(node)));
check(
	"turning grouping off renders a flat list with the folder back on each row",
	headers().length === 0 && rowsSeen().length === 3 && flatMeta.every((meta) => meta.includes("C:\\Data\\")),
	`${headers().length} header(s), ${rowsSeen().length} row(s), meta=${JSON.stringify(flatMeta)}`
);
check("the toggle now reports the flat mode", buttonByLabel("分组：平铺") !== undefined);
buttonByLabel("分组：平铺").props.onClick();
tree = await render(section.component, { t: tPanel });
check("turning grouping back on restores the headers", headers().length === 2, `${headers().length} header(s)`);

// ── 配置页：动作在右上、基础设置、版本号与升级提示 ───────────────────────
// 面板根节点的第 1 个子节点就是顶部条：左边页签组，右边动作组。
const headerOf = () => tree.children[0];
const tabBarOf = () => headerOf().children[0];
const actionsOf = () => headerOf().children[1];
/** 页签那一组是 `tabs.map(...)` 的结果，迷你渲染器把它当**一个**子节点存着，所以要递归收集。 */
const tabButtons = () => collect(tabBarOf(), []).filter((node) => node.type === "Button");
const tabLabels = () =>
	tabButtons()
		.map((node) => node.children[0])
		.join(" | ");
const actionButtons = () => (actionsOf() === null ? [] : actionsOf().children.filter(Boolean));
const switchNodes = () => nodesOf(tree, "Switch");
/** 按 label（面板传的就是本地化过的名字）找控件，比按下标稳。 */
const switchByLabel = (label) => switchNodes().find((node) => node.props.label === label);
const segmentedNodes = () => nodesOf(tree, "SegmentedControl");
/** 按 label 找分段控件（面板传的就是本地化过的名字），比按下标稳。 */
const segmentedByLabel = (label) => segmentedNodes().find((node) => node.props.label === label);
const spanWith = (prefix) =>
	collect(tree, []).find((node) => node.type === "span" && typeof node.children?.[0] === "string" && node.children[0].startsWith(prefix));

check(
	"the two data tabs stay on the top-left, with 磁盘占用 and 配置 appended",
	tabButtons().length === 4 && tabLabels() === "已归档 (3) | 已置顶 (1) | 磁盘占用 | 配置",
	tabLabels()
);
check(
	"分组 and 刷新 moved to the top-right actions group",
	actionsOf() !== null &&
		actionsOf().props.style.marginInlineStart === "auto" &&
		actionButtons().length === 2 &&
		actionButtons()[0].children[0].startsWith("分组") &&
		actionButtons()[1].children[0] === "刷新",
	`marginInlineStart=${actionsOf()?.props.style.marginInlineStart} buttons=${actionButtons()
		.map((node) => node.children[0])
		.join(", ")}`
);
check(
	"both right-hand buttons carry a visible border (outline variant)",
	actionButtons().every((node) => node.props.variant === "outline"),
	actionButtons()
		.map((node) => node.props.variant)
		.join(", ")
);
check(
	"the tab buttons stay in the left group (not among the actions)",
	tabButtons().every((node) => node.props.variant !== "outline"),
	tabButtons()
		.map((node) => node.props.variant)
		.join(", ")
);

// 打开配置页。
buttonByLabel("配置").props.onClick();
tree = await render(section.component, { t: tPanel });
check(
	"the config tab drops the list-only actions from the right",
	headerOf().children[1] === null && tabLabels().endsWith("配置"),
	tabLabels()
);
// 排序改成了**下拉**（`Dropdown` 是 Menu + MenuItemButton），所以分段控件只剩 2 个。
check(
	"the config page renders 4 switches and 2 segmented controls",
	switchNodes().length === 4 && segmentedNodes().length === 2,
	`${switchNodes().length} switch(es), ${segmentedNodes().length} segmented`
);
check(
	"the default-tab control offers exactly the two data tabs (never 配置 / 磁盘占用)",
	segmentedNodes()[0]
		.props.options.map((option) => option.value)
		.join(",") === "archived,pinned",
	segmentedNodes()[0]
		.props.options.map((option) => option.label)
		.join(", ")
);
check(
	"the folder default-state control offers 展开 / 折叠 and carries the saved value",
	segmentedByLabel("分组默认状态") !== undefined &&
		segmentedByLabel("分组默认状态")
			.props.options.map((option) => option.value)
			.join(",") === "expanded,collapsed" &&
		segmentedByLabel("分组默认状态").props.value === "expanded",
	String(segmentedByLabel("分组默认状态")?.props.value)
);

// ── 排序下拉（`Menu` 的数据行 + `selectedId`） ─────────────────────────
/**
 * 下拉：`Dropdown` 自己也是**组件**（迷你渲染器不递归），所以要先找到它再 `draw` 一次，
 * 拿到的才是里面那个 `Menu`。
 *
 * 行现在是 `Menu` 的 **`items`**（`{id, label, disabled}`）而不是 `children` 里的
 * `MenuItemButton` —— 选中标记改成由 `Menu` 在**行尾**画对勾（`selectedId`），
 * 见 `components/dropdown.ts` 的文件头。
 */
const dropdownNodes = () => collect(tree, []).filter((node) => node.type === client.Dropdown);
const dropdownByLabel = (label) => dropdownNodes().find((node) => node.props.label === label);
/** 某个下拉渲染出来的 `Menu` 元素。 */
const dropdownMenu = (label) => {
	const node = dropdownByLabel(label);
	return node === undefined ? undefined : draw(node);
};
const dropdownRows = (label) => dropdownMenu(label)?.props?.items ?? [];
/** 选一档：`Menu` 的 `onSelect` 收到的是**数据行的 id**。 */
const selectDropdownRow = (label, index) => dropdownMenu(label).props.onSelect(dropdownRows(label)[index].id);
/** 锚点按钮（文案 / 无障碍名字都在它身上）。 */
const dropdownAnchor = (label) => dropdownMenu(label)?.props?.anchor;
/** 锚点按钮上的文字（它是 `Button` 的第一个子节点，不是 `props.children`）。 */
const dropdownLabel = (label) => dropdownAnchor(label)?.children?.[0];
check(
	"the order control is a dropdown listing all four orders and showing the current one",
	dropdownByLabel("排序") !== undefined &&
		dropdownRows("排序")
			.map((row) => row.label)
			.join(" | ") === "原顺序 | 标题 | 体积 | 创建时间" &&
		dropdownLabel("排序") === "原顺序" &&
		dropdownMenu("排序").props.open === false,
	JSON.stringify(dropdownRows("排序").map((row) => row.label))
);
// 这一条就是"对勾在字左边"那个问题的回归：选中态只能来自 `Menu` 自己的**尾部**对勾
//（数据行的 `selectedId`），行上不许再挂 `icon`（`MenuItemButton` 的 icon 在文字**前面**）。
check(
	"the current row is marked by Menu's own trailing check (selectedId), never a leading icon",
	dropdownMenu("排序").props.selectedId === "session-curator-order-host" && dropdownRows("排序").every((row) => row.icon === undefined),
	JSON.stringify({ order: dropdownMenu("排序").props.selectedId, icons: dropdownRows("排序").map((row) => row.icon?.type ?? "none") })
);
// 点开 → 只开这一个下拉；选一档 → 写设置 + 关列表 + 锚点换文案。
dropdownAnchor("排序").props.onClick();
tree = await render(section.component, { t: tPanel });
check("clicking the anchor opens the dropdown", dropdownMenu("排序").props.open === true);
selectDropdownRow("排序", 2);
tree = await render(section.component, { t: tPanel });
check(
	"picking a row writes the setting, closes the list and updates the anchor label",
	JSON.parse(globalThis.localStorage.getItem("dsh-session-curator.settings")).order === "bytes" &&
		dropdownMenu("排序").props.open === false &&
		dropdownLabel("排序") === "体积",
	`order=${JSON.parse(globalThis.localStorage.getItem("dsh-session-curator.settings")).order} label=${dropdownLabel("排序")}`
);
// 还原成原顺序：后面的排序断言依赖它。
dropdownAnchor("排序").props.onClick();
tree = await render(section.component, { t: tPanel });
selectDropdownRow("排序", 0);
tree = await render(section.component, { t: tPanel });
check(
	"the order is back to 原顺序 for the following checks",
	JSON.parse(globalThis.localStorage.getItem("dsh-session-curator.settings")).order === "host",
	String(JSON.parse(globalThis.localStorage.getItem("dsh-session-curator.settings")).order)
);

// ── 磁盘占用：**独立页签**（不再挂在配置页里） ───────────────────────────
// 迷你渲染器**不递归组件**，所以这一块要像 GroupHeader / SessionRow 那样显式 `draw` 一次：
// 面板只负责把 `<UsagePanel …>` 挂进那一页，它自己的渲染由这里单独跑。
const usageNode = () => collect(tree, []).find((node) => node.type === client.UsagePanel);
/** 每次都要重新取：元素是快照，状态一变就是新的那棵树。 */
const usageTree = () => draw(usageNode());
/** 榜单上的动作按钮：归档 / 取消归档（正在跑的不给按钮）。 */
const usageButtons = (label) => collect(usageTree(), []).filter((node) => node.type === "Button" && node.children?.[0] === label);
const usageArchiveButtons = () => usageButtons("归档");
const usageUnarchiveButtons = () => usageButtons("取消归档");
/** 榜单里某一行的动作按钮（`null` = 这一行没有按钮）。行是按 `key = sessionId` 找的。 */
const usageRowAction = (sessionId) => {
	const row = collect(usageTree(), []).find((node) => node.props?.key === sessionId);
	const first = row?.children?.[1]?.children?.[0];
	return first === null || first === undefined ? null : first;
};
const usageSpans = () =>
	collect(usageTree(), [])
		.filter((node) => node.type === "span" && typeof node.children?.[0] === "string")
		.map((node) => node.children[0]);

check("the config page no longer mounts the disk-usage block", usageNode() === undefined);
buttonByLabel("磁盘占用").props.onClick();
tree = await render(section.component, { t: tPanel });
check(
	"the 磁盘占用 tab is its own page: the usage block plus a refresh button, no list chrome",
	usageNode() !== undefined &&
		tabLabels().includes("磁盘占用") &&
		headerOf().children[1] === null &&
		!JSON.stringify(tree).includes("全选") &&
		!JSON.stringify(tree).includes("搜索标题或目录") &&
		buttonByLabel("刷新") !== undefined,
	JSON.stringify({
		usage: usageNode() !== undefined,
		header: headerOf().children[1] === null,
		all: JSON.stringify(tree).includes("全选"),
		search: JSON.stringify(tree).includes("搜索标题或目录"),
		refresh: buttonByLabel("刷新")?.children?.[0] ?? null
	})
);
check(
	"opening that tab pulls the usage view from its own read-only endpoint",
	hostCalls.some((entry) => entry.endpoint.endsWith("usage")) && usageNode().props.usage !== null && usageNode().props.loading === false,
	JSON.stringify({
		calls: hostCalls.filter((entry) => entry.endpoint.endsWith("usage")).length,
		total: usageNode()?.props.usage?.totalSessions
	})
);
check("the usage header reports the totals the host sent", usageSpans().includes("共 5 个会话 · 4.1 KB"), JSON.stringify(usageSpans()));
check(
	"the usage view lists the workspace bars, largest and oldest sessions",
	usageSpans().includes("按工作区") &&
		usageSpans().includes("最占地方的会话") &&
		usageSpans().includes("最久没打开的会话") &&
		usageSpans().includes("Momo") &&
		usageSpans().includes("BlogPage") &&
		// 榜单每一行都带体积 / 文件数 / 工作区 / 时间（`formatBytes(4000)` 是 3.9 KB）。
		JSON.stringify(usageTree()).includes("3.9 KB · 4 个文件 · Momo"),
	JSON.stringify(usageSpans())
);
check(
	"the running badge on a usage row is the blue one",
	collect(usageTree(), []).find((node) => node.children?.[0] === "运行中")?.props.style.color ===
		"var(--dsw-alias-state-business-primary)",
	JSON.stringify(
		collect(usageTree(), [])
			.filter((node) => node.children?.[0] === "运行中")
			.map((node) => [node.children[0], node.props.style?.color])
	)
);
// 右侧按钮必须跟着行的状态走：已归档还摆着「归档」是幂等的空操作（点了没反应），
// 运行中的不给「归档」。
check(
	"the usage row action follows the row state (归档 / 取消归档 / none)",
	usageSpans().includes("运行中") &&
		usageSpans().includes("已置顶") &&
		usageRowAction("s-5")?.children?.[0] === "归档" &&
		usageRowAction("s-3")?.children?.[0] === "取消归档" &&
		usageRowAction("s-1")?.children?.[0] === "取消归档" &&
		usageRowAction("s-4") === null &&
		usageRowAction("s-9")?.children?.[0] === "归档",
	JSON.stringify(["s-5", "s-3", "s-1", "s-4", "s-9"].map((id) => usageRowAction(id)?.children?.[0] ?? "none"))
);
check(
	"an archived usage row is badged 已归档 and gets 取消归档 instead of the idempotent 归档",
	usageSpans().includes("已归档") && usageUnarchiveButtons().length === 2 && usageArchiveButtons().length === 2,
	`${usageArchiveButtons().length} archive / ${usageUnarchiveButtons().length} unarchive button(s)`
);
// 点「归档」→ 与列表同一个 `archive` 端点，**完事之后再重拉一次 `usage`**
//（`run()` 只换快照，占用视图不在快照里 —— 不重拉的话刚点过的那行状态还是旧的）。
const usageCallsBefore = hostCalls.length;
usageArchiveButtons()[0].props.onClick();
tree = await render(section.component, { t: tPanel });
check(
	"the usage view archives a session through the shared archive endpoint, then re-pulls the view",
	hostCalls.length === usageCallsBefore + 2 &&
		hostCalls[usageCallsBefore].endpoint === "session-curator/archive" &&
		hostCalls[usageCallsBefore].payload.ids.join(",") === "s-9" &&
		hostCalls[usageCallsBefore + 1].endpoint.endsWith("usage"),
	JSON.stringify(hostCalls.slice(usageCallsBefore).map((entry) => entry.endpoint))
);
// 点「取消归档」→ `unarchive`（已归档的行再打 `archive` 什么也不会发生）。
const unarchiveCallsBefore = hostCalls.length;
usageRowAction("s-3").props.onClick();
tree = await render(section.component, { t: tPanel });
check(
	"an archived usage row unarchives through the shared unarchive endpoint",
	hostCalls.length === unarchiveCallsBefore + 2 &&
		hostCalls[unarchiveCallsBefore].endpoint === "session-curator/unarchive" &&
		hostCalls[unarchiveCallsBefore].payload.ids.join(",") === "s-3" &&
		hostCalls[unarchiveCallsBefore + 1].endpoint.endsWith("usage"),
	JSON.stringify(hostCalls.slice(unarchiveCallsBefore).map((entry) => entry.endpoint))
);
// 宿主报错时只显示原因，不谎报数字。
// 这里必须 `resetHooks()` 重新挂载：那个拉取挂在 `[tab, revision, usageReload]` 上，
// 三个依赖都没变时迷你 React 不会重跑 effect —— 不重挂就还是上一次那份成功结果。
// 重挂之后页签回到默认的"已归档"，所以还要再点一次「磁盘占用」。
const usageBeforeFailure = usageResponse;
usageResponse = null;
resetHooks();
tree = await render(section.component, { t: tPanel });
buttonByLabel("磁盘占用").props.onClick();
tree = await render(section.component, { t: tPanel });
check(
	"a failing usage scan shows the reason instead of a fake total",
	usageNode() !== undefined &&
		usageNode().props.usage === null &&
		String(usageNode().props.error).includes("扫不动") &&
		!usageSpans().includes("共 5 个会话"),
	JSON.stringify({ error: usageNode()?.props.error })
);
usageResponse = usageBeforeFailure;
resetHooks();
tree = await render(section.component, { t: tPanel });
buttonByLabel("配置").props.onClick();
tree = await render(section.component, { t: tPanel });
check(
	"the about block shows the version in small light text",
	spanWith("版本") !== undefined &&
		spanWith("版本").children[0] === "版本 v0.1.0" &&
		spanWith("版本").props.style.fontSize === "11px" &&
		spanWith("版本").props.style.color === "var(--dsw-alias-label-tertiary)",
	spanWith("版本")?.children?.[0]
);
check(
	"an outdated version renders the notice plus the exact upgrade command",
	JSON.stringify(tree).includes("有新版本 0.1.1（当前 0.1.0）") &&
		JSON.stringify(tree).includes("升级步骤") &&
		JSON.stringify(tree).includes("dsh plugin --profile desktop add dsh-session-curator@latest"),
	String(spanWith("有新版本")?.children?.[0])
);
check(
	"opening the config tab really asked the host for updates",
	hostCalls.some((entry) => entry.endpoint.endsWith("check-update")),
	hostCalls.map((entry) => entry.endpoint).join(", ")
);

// ── 侧边栏"显示已归档"：读写的必须是官方那份设置（dsh.workspace.view.v5） ──
const SIDEBAR_SWITCH = "侧边栏显示已归档会话";
check(
	"the sidebar-archived switch mirrors the official setting (seeded to show archived)",
	switchByLabel(SIDEBAR_SWITCH) !== undefined && switchByLabel(SIDEBAR_SWITCH).props.checked === true,
	String(switchByLabel(SIDEBAR_SWITCH)?.props.checked)
);
check("no refresh hint before the sidebar value is touched", !JSON.stringify(tree).includes("已写入官方设置"));

switchByLabel(SIDEBAR_SWITCH).props.onChange(false);
tree = await render(section.component, { t: tPanel });
const sidebarView = JSON.parse(globalThis.localStorage.getItem("dsh.workspace.view.v5"));
check(
	"turning it off writes only archivedFilter into the official key",
	sidebarView.archivedFilter === "default" && sidebarView.groupBy === "flat" && sidebarView.orderBy === "updated",
	JSON.stringify(sidebarView)
);
check(
	"the plugin's own settings key is not polluted by it",
	JSON.parse(globalThis.localStorage.getItem("dsh-session-curator.settings")).archivedFilter === undefined,
	globalThis.localStorage.getItem("dsh-session-curator.settings")
);
check(
	"a refresh hint appears, because the official store only reads that key when it is created",
	JSON.stringify(tree).includes("已写入官方设置") &&
		collect(tree, []).some((node) => node.type === "Button" && node.children?.[0] === "刷新页面"),
	JSON.stringify(
		collect(tree, [])
			.filter((node) => node.type === "Button")
			.map((node) => node.children?.[0])
	)
);

// 设置真的生效：关掉"行内显示体积与文件数"，回已归档页签看行。
switchByLabel("行内显示体积与文件数").props.onChange(false);
tree = await render(section.component, { t: tPanel });
check(
	"a switch writes the setting through to localStorage",
	JSON.parse(globalThis.localStorage.getItem("dsh-session-curator.settings")).showMeta === false,
	globalThis.localStorage.getItem("dsh-session-curator.settings")
);
buttonByLabel("已归档").props.onClick();
tree = await render(section.component, { t: tPanel });
const slimMeta = rowsSeen().map((node) => metaOf(draw(node)));
check(
	"showMeta = false drops size and file count from every row",
	slimMeta.length === 3 && slimMeta.every((meta) => !meta.includes(" B") && !meta.includes("个文件")),
	JSON.stringify(slimMeta)
);

// 排序：按体积降序（组内），组间照旧按文件夹名。
// 排序控件现在是**下拉**（见上面那一段的专门断言），所以这里按下拉的用法点一次。
buttonByLabel("配置").props.onClick();
tree = await render(section.component, { t: tPanel });
selectDropdownRow("排序", 2);
tree = await render(section.component, { t: tPanel });
buttonByLabel("已归档").props.onClick();
tree = await render(section.component, { t: tPanel });
check(
	"order = bytes sorts rows inside each group",
	rowsSeen()
		.map((node) => node.props.row.sessionId)
		.join(",") === "s-3,s-2,s-1",
	rowsSeen()
		.map((node) => node.props.row.sessionId)
		.join(",")
);

// ── 搜索与过滤（只影响显示；批量操作与计数仍按整个页签算） ───────────────
// 先按体积降序、分组也还开着，所以下面的断言同时覆盖"过滤不改变排序 / 分组"。
const searchInput = () => nodesOf(tree, "Input")[0];
const timeControl = () => nodesOf(tree, "SegmentedControl").find((node) => node.props.label === "时间");
check(
	"every data tab carries the filter bar (search box + time control)",
	searchInput() !== undefined &&
		searchInput().props["aria-label"] === "搜索会话" &&
		searchInput().props.placeholder === "搜索标题或目录…" &&
		timeControl() !== undefined &&
		timeControl()
			.props.options.map((option) => option.value)
			.join(",") === "all,recent",
	JSON.stringify({
		input: searchInput()?.props["aria-label"],
		time: timeControl()
			?.props.options.map((option) => option.value)
			.join(",")
	})
);
check(
	"no clear button before anything is filtered",
	!collect(tree, []).some((node) => node.type === "Button" && node.children?.[0] === "清除搜索")
);

// 输入 "Momo"：命中 cwd 的那两行留下（s-2 / s-1，按体积降序），写进设置、页脚出现过滤计数。
searchInput().props.onChange({ target: { value: "Momo" } });
tree = await render(section.component, { t: tPanel });
check(
	"typing a folder name filters the rows and persists the search",
	rowsSeen()
		.map((node) => node.props.row.sessionId)
		.join(",") === "s-2,s-1" && JSON.parse(globalThis.localStorage.getItem("dsh-session-curator.settings")).search === "Momo",
	`rows=${rowsSeen()
		.map((node) => node.props.row.sessionId)
		.join(",")}`
);
check("the footer reports how many of the tab's sessions match", footerText().includes("已过滤出 2 个会话（共 3 个）"), "");
check("the tab counters keep counting the whole tab, not the filtered view", tabLabels().includes("已归档 (3)"), tabLabels());
check(
	"a clear button shows up once a filter is active",
	collect(tree, []).some((node) => node.type === "Button" && node.children?.[0] === "清除搜索")
);

// 搜索 + 分组：只剩一个分组（BlogPage 被过滤掉了），组内顺序照旧。
check(
	"filtering happens before grouping, so empty folders disappear",
	headers().length === 1 && headers()[0].props.group.title === "Momo",
	headers()
		.map((node) => node.props.group.title)
		.join(", ")
);

// 时间档：把固定时间戳换成"最近 7 天"，三条归档行的 createdAt 都是 1 / 2 / 3（远古），必须全被滤掉。
timeControl().props.onChange("recent");
tree = await render(section.component, { t: tPanel });
check(
	"the recent filter drops rows whose createdAt is far in the past",
	rowsSeen().length === 0 &&
		JSON.stringify(tree).includes("没有符合搜索条件的会话") &&
		JSON.parse(globalThis.localStorage.getItem("dsh-session-curator.settings")).timeFilter === "recent",
	`rows=${rowsSeen().length}`
);
check(
	"the filtered view still reports the tab totals",
	footerText().includes("3 个会话 · 600 B") && footerText().includes("已过滤出 0 个会话（共 3 个）"),
	""
);

// 「清除搜索」：一次把搜索词与时间档都还原。
buttonByLabel("清除搜索").props.onClick();
tree = await render(section.component, { t: tPanel });
check(
	"the clear button resets both the search and the time filter",
	rowsSeen().length === 3 &&
		headers().length === 2 &&
		!JSON.stringify(tree).includes("已过滤出") &&
		JSON.parse(globalThis.localStorage.getItem("dsh-session-curator.settings")).timeFilter === "all",
	`rows=${rowsSeen().length} headers=${headers().length}`
);

// ── 分组默认折叠 / 展开（配置项 groupDefault） ───────────────────────────
// 语义：没手动点过的文件夹跟随配置里的默认状态（改配置立即生效）；手动点过的保留手动
// 状态；手动翻**回**默认值之后重新跟随配置（覆盖被丢掉，见 groups.ts 的 toggledCollapse）。
buttonByLabel("配置").props.onClick();
tree = await render(section.component, { t: tPanel });
segmentedByLabel("分组默认状态").props.onChange("collapsed");
tree = await render(section.component, { t: tPanel });
check(
	"turning the folder default to 折叠 is persisted",
	JSON.parse(globalThis.localStorage.getItem("dsh-session-curator.settings")).groupDefault === "collapsed",
	globalThis.localStorage.getItem("dsh-session-curator.settings")
);
buttonByLabel("已归档").props.onClick();
tree = await render(section.component, { t: tPanel });
check(
	"every folder follows the default and starts collapsed",
	headers().length === 2 && headers().every((node) => node.props.collapsed === true) && rowsSeen().length === 0,
	`collapsed=${headers()
		.map((node) => node.props.collapsed)
		.join(",")} rows=${rowsSeen().length}`
);
// 手动展开 BlogPage（headers()[0]）：只有它变，另一组照旧跟随默认。
partsOf(headers()[0])[0].props.onClick();
tree = await render(section.component, { t: tPanel });
check(
	"expanding one folder by hand leaves the others collapsed",
	headers()[0].props.collapsed === false &&
		headers()[1].props.collapsed === true &&
		rowsSeen()
			.map((node) => node.props.row.sessionId)
			.join(",") === "s-3",
	`collapsed=${headers()
		.map((node) => node.props.collapsed)
		.join(",")} rows=${rowsSeen()
		.map((node) => node.props.row.sessionId)
		.join(",")}`
);
// 改回默认"展开"：没手动点过的 Momo 立刻跟着展开，手动展开的 BlogPage 不变。
buttonByLabel("配置").props.onClick();
tree = await render(section.component, { t: tPanel });
check(
	"the control carries the saved 折叠 value",
	segmentedByLabel("分组默认状态").props.value === "collapsed",
	String(segmentedByLabel("分组默认状态").props.value)
);
segmentedByLabel("分组默认状态").props.onChange("expanded");
tree = await render(section.component, { t: tPanel });
buttonByLabel("已归档").props.onClick();
tree = await render(section.component, { t: tPanel });
check(
	"changing the default only moves the folders nobody touched by hand",
	headers().length === 2 && headers().every((node) => node.props.collapsed === false) && rowsSeen().length === 3,
	`collapsed=${headers()
		.map((node) => node.props.collapsed)
		.join(",")} rows=${rowsSeen().length}`
);
// 手动折叠再展开（翻回默认值）→ 这条分组重新跟随配置。
partsOf(headers()[1])[0].props.onClick();
tree = await render(section.component, { t: tPanel });
check("collapsing one folder by hand hides exactly its rows", rowsSeen().length === 1, `${rowsSeen().length} row(s)`);
partsOf(headers()[1])[0].props.onClick();
tree = await render(section.component, { t: tPanel });
buttonByLabel("配置").props.onClick();
tree = await render(section.component, { t: tPanel });
segmentedByLabel("分组默认状态").props.onChange("collapsed");
tree = await render(section.component, { t: tPanel });
buttonByLabel("已归档").props.onClick();
tree = await render(section.component, { t: tPanel });
check(
	"a folder toggled back to the default follows the setting again",
	headers()[1].props.collapsed === true,
	`collapsed=${headers()
		.map((node) => node.props.collapsed)
		.join(",")}`
);
check(
	"a folder still expanded by hand keeps its manual state across a default change",
	headers()[0].props.collapsed === false &&
		rowsSeen()
			.map((node) => node.props.row.sessionId)
			.join(",") === "s-3",
	`collapsed=${headers()
		.map((node) => node.props.collapsed)
		.join(",")} rows=${rowsSeen()
		.map((node) => node.props.row.sessionId)
		.join(",")}`
);
// 还原成默认展开：后面几条断言依赖行都在。
buttonByLabel("配置").props.onClick();
tree = await render(section.component, { t: tPanel });
segmentedByLabel("分组默认状态").props.onChange("expanded");
tree = await render(section.component, { t: tPanel });
buttonByLabel("已归档").props.onClick();
tree = await render(section.component, { t: tPanel });
check("the list is back to expanded for the following checks", rowsSeen().length === 3, `${rowsSeen().length} row(s)`);

// 检查失败：显示原因，不谎报"已是最新"。
buttonByLabel("配置").props.onClick();
tree = await render(section.component, { t: tPanel });
updateResponse = null;
const recheck = collect(tree, []).find((node) => node.type === "Button" && node.children?.[0] === "检查更新");
recheck.props.onClick();
tree = await render(section.component, { t: tPanel });
check(
	"a failed check shows the reason instead of claiming to be current",
	JSON.stringify(tree).includes("检查更新失败") &&
		!JSON.stringify(tree).includes("已是最新版本") &&
		collect(tree, []).some((node) => node.props.style?.color === "var(--dsw-alias-state-error-primary)"),
	String(spanWith("检查更新失败")?.children?.[0])
);
updateResponse = { current: "0.1.0", latest: "0.1.1", outdated: true, checkedAt: 0 };

// ── 侧边栏会话行：hover 卡片 + 行内「删除会话」 ───────────────────────────
// 下面每个块都换组件渲染，所以每块开头先 `resetHooks()`（迷你 React 的 hook 槽位是
// 按**下标**共用的，不换的话两个组件的 useState 会互相顶掉）。
const dialogEntry = slotOf("shell.overlay", "session-curator.dialog");
const toastEntry = slotOf("shell.overlay", "session-curator.toast");
const hoverEntry = slotOf("sidebar.session.row.hover", "session-curator.hover");
const actionEntry = slotOf("sidebar.workspaces.session.row.action", "session-curator.delete-row");
/** 发往 `describe` 的请求数：用来断言缓存 / 并发去重真的省掉了请求。 */
const describeCalls = () => hostCalls.filter((entry) => entry.endpoint.endsWith("describe")).length;
/** 收集树里所有 span 的文字（hover 卡片与 toast 的断言都按文本找）。 */
const spanTexts = (node) =>
	collect(node, [])
		.filter((entry) => entry.type === "span" && typeof entry.children?.[0] === "string")
		.map((entry) => entry.children[0]);

// 面板那条"⋯ 菜单 → 删除会话"留下的待确认请求：置顶页签那次操作留下的是 `s-4` 的请求
//（物理删除永远先问一次），而这里断言的是 `s-2` —— 所以先把面板**干净地**渲染回已归档页签
//（前面几个块换过组件，hook 槽位要清一次），再用它自己的菜单制造一次同样的请求。
client.dialogStore.set(null);
resetHooks();
tree = await render(section.component, { t: tPanel });
menuOfRow("s-2").props.onSelect("delete");
resetHooks();
let dialogTree = await render(dialogEntry.component, { t: tPanel });
check(
	"the shared dialog shows the pending request the panel's ⋯ menu raised",
	dialogTree?.type === "Modal" && String(dialogTree.props.description).includes("改毛玻璃"),
	String(dialogTree?.props.description)
);
check(
	"the dialog spells out that deleting is permanent and points at archiving",
	String(dialogTree.props.description).includes("无法恢复") && String(dialogTree.props.description).includes("归档"),
	String(dialogTree?.props.description)
);
dialogTree.props.footer.children[0].props.onClick();
dialogTree = await render(dialogEntry.component, { t: tPanel });
check(
	"cancelling it clears the request without ever calling the delete endpoint",
	dialogTree === null && !hostCalls.some((entry) => entry.endpoint.endsWith("delete"))
);

// 1) hover 卡片：只补官方卡片没有的磁盘事实（体积 / 文件数 / 原目录 / 状态）。
resetHooks();
let hoverTree = await render(hoverEntry.component, { sessionId: "s-9", t: tPanel });
check(
	"the hover card adds size, file count and the original folder",
	hoverTree?.type === "div" && spanTexts(hoverTree).includes("40 B · 1 个文件") && spanTexts(hoverTree).includes("C:\\Data\\BlogPage"),
	JSON.stringify(spanTexts(hoverTree))
);
check(
	"an ordinary session carries no status badge at all",
	!spanTexts(hoverTree).includes("已归档") && !spanTexts(hoverTree).includes("已置顶"),
	JSON.stringify(spanTexts(hoverTree))
);
resetHooks();
hoverTree = await render(hoverEntry.component, { sessionId: "s-1", t: tPanel });
check(
	"an archived session is badged 已归档 and keeps the muted pill colour",
	spanTexts(hoverTree).includes("已归档") &&
		collect(hoverTree, []).find((node) => node.children?.[0] === "已归档").props.style.color === "var(--dsw-alias-label-secondary)" &&
		spanTexts(hoverTree).includes("100 B · 1 个文件"),
	JSON.stringify(spanTexts(hoverTree))
);
resetHooks();
hoverTree = await render(hoverEntry.component, { sessionId: "session-nope", t: tPanel });
check(
	"an unreadable session adds no line at all (the card is not an error surface)",
	hoverTree === null,
	JSON.stringify(hoverTree)?.slice(0, 80)
);

// 2) describe 缓存：hover 每次划过都会读一次，所以必须命中缓存 / 只发一个请求。
client.forgetDetails();
const beforeCache = describeCalls();
const firstRead = await client.describeSession("s-9");
const secondRead = await client.describeSession("s-9");
check(
	"describe reads are cached: two reads, one host call",
	describeCalls() === beforeCache + 1 && firstRead.bytes === 40 && secondRead.bytes === 40,
	`${describeCalls() - beforeCache} call(s)`
);
client.forgetDetails();
const beforeDedupe = describeCalls();
const [leftRead, rightRead] = await Promise.all([client.describeSession("s-9"), client.describeSession("s-9")]);
check(
	"concurrent reads of the same id share one request",
	describeCalls() === beforeDedupe + 1 && leftRead === rightRead,
	`${describeCalls() - beforeDedupe} call(s)`
);
// 插件自己的写操作（`mutationStore` 自增）立刻让缓存失效。
client.forgetDetails();
await client.describeSession("s-9");
const beforeInvalidate = describeCalls();
client.mutationStore.set(client.mutationStore.get() + 1);
check(
	"the plugin's own write drops the cached detail",
	describeCalls() === beforeInvalidate,
	`${describeCalls() - beforeInvalidate} extra describe call(s) before the next read`
);
await client.describeSession("s-9");
check("so the next hover asks the host again", describeCalls() === beforeInvalidate + 1, `${describeCalls() - beforeInvalidate} call(s)`);

// 3) 纯信息提示（复制路径 / 定位）：一条提示，没有动作按钮。
resetHooks();
client.showNotice("已复制路径：/tmp/x");
let toastTree = await render(toastEntry.component, { t: tPanel });
check(
	"a notice renders as a plain Toast with no actions",
	toastTree?.type === "Toast" &&
		toastTree.props.text === "已复制路径：/tmp/x" &&
		toastTree.props.holdMs === 5000 &&
		toastTree.props.actions === undefined,
	String(toastTree?.props.text)
);
const firstToastKey = toastTree.children[0];
client.showNotice("换一条提示");
toastTree = await render(toastEntry.component, { t: tPanel });
check(
	"a new notice gets a new key, so the Toast restarts its hold",
	toastTree.children[0] !== firstToastKey && toastTree.props.text === "换一条提示",
	`${String(firstToastKey)} → ${String(toastTree.children[0])}`
);
client.toastStore.set(null);
toastTree = await render(toastEntry.component, { t: tPanel });
check("a dismissed notice unmounts the Toast", toastTree === null, String(toastTree));

// 4) 行内 hover 按钮：形状与官方那个槽位一致（朴素 16×16 图标按钮），点击仍然先确认。
resetHooks();
let actionTree = await render(actionEntry.component, { sessionId: "s-1", displayTitle: "修 Header", t: tPanel });
/** 每次都要重新取：它是快照，hover 之后是新的那棵树。 */
const deleteButton = () => actionTree.props.children;
check(
	"the inline action is a Tooltip-wrapped plain icon button, like the official ones",
	actionTree.type === "Tooltip" &&
		actionTree.props.label === "删除会话" &&
		actionTree.props.side === "bottom" &&
		actionTree.props.align === "end" &&
		deleteButton().type === "button" &&
		deleteButton().props.type === "button" &&
		deleteButton().children[0].type === "IconTrashOutlineRegular" &&
		deleteButton().children[0].props.size === 14,
	`label=${String(actionTree.props.label)} anchor=${String(deleteButton().type)}`
);
check(
	"it matches the official 16x16 transparent geometry inside the 20px row-actions strip",
	deleteButton().props.style.width === "16px" &&
		deleteButton().props.style.height === "16px" &&
		deleteButton().props.style.borderRadius === "var(--dsw-radius-xs)" &&
		deleteButton().props.style.flex === "none" &&
		deleteButton().props.style.padding === 0 &&
		deleteButton().props.style.border === "none" &&
		deleteButton().props.style.cursor === "pointer" &&
		String(deleteButton().props["aria-label"]).includes("修 Header"),
	JSON.stringify(deleteButton().props.style)
);
check(
	"it paints the danger red and never a hover background",
	deleteButton().props.style.color === "var(--dsw-alias-state-error-primary)" && deleteButton().props.style.background === "transparent",
	JSON.stringify({ color: deleteButton().props.style.color, background: deleteButton().props.style.background })
);
// hover：只把同一个红色压深一档（`color-mix`），底、边框、尺寸一律不动。
deleteButton().props.onPointerEnter();
actionTree = await render(actionEntry.component, { sessionId: "s-1", displayTitle: "修 Header", t: tPanel });
const hoveredStyle = deleteButton().props.style;
check(
	"hovering deepens the same red without adding any background",
	hoveredStyle.color === "color-mix(in srgb, var(--dsw-alias-state-error-primary) 78%, #000)" &&
		hoveredStyle.background === "transparent" &&
		hoveredStyle.border === "none" &&
		hoveredStyle.width === "16px" &&
		hoveredStyle.height === "16px",
	JSON.stringify(hoveredStyle)
);
deleteButton().props.onPointerLeave();
actionTree = await render(actionEntry.component, { sessionId: "s-1", displayTitle: "修 Header", t: tPanel });
check(
	"leaving the button restores the base red",
	deleteButton().props.style.color === "var(--dsw-alias-state-error-primary)",
	String(deleteButton().props.style.color)
);
const deleteCallsBefore = hostCalls.filter((entry) => entry.endpoint.endsWith("delete")).length;
deleteButton().props.onClick();
resetHooks();
let confirmTree = await render(dialogEntry.component, { t: tPanel });
check(
	"clicking it asks for confirmation instead of deleting straight away",
	confirmTree?.type === "Modal" &&
		String(confirmTree.props.description).includes("修 Header") &&
		String(confirmTree.props.description).includes("归档") &&
		hostCalls.filter((entry) => entry.endpoint.endsWith("delete")).length === deleteCallsBefore,
	String(confirmTree?.props.description)
);
/** 弹窗正文里那个"我明白"勾选框（`Modal` 的 children 是普通元素树，递归找 input）。 */
const ackBox = () => collect(confirmTree, []).find((node) => node.type === "input" && node.props.type === "checkbox");
check(
	"the delete confirmation stays disabled until the irreversible-action box is ticked",
	confirmTree.props.footer.children[1].props.disabled === true &&
		String(confirmTree.props.footer.children[1].children[0]) === "永久删除" &&
		ackBox() !== undefined &&
		JSON.stringify(confirmTree).includes("我明白这无法撤销"),
	String(confirmTree.props.footer.children[1].children[0])
);
ackBox().props.onChange({ target: { checked: true } });
confirmTree = await render(dialogEntry.component, { t: tPanel });
confirmTree.props.footer.children[1].props.onClick();
await new Promise((resolve) => setTimeout(resolve, 0));
check(
	"confirming permanently deletes that one session through the delete endpoint",
	hostCalls[hostCalls.length - 1].endpoint === "session-curator/delete" &&
		hostCalls[hostCalls.length - 1].payload.ids.join(",") === "s-1",
	JSON.stringify(hostCalls[hostCalls.length - 1])
);
confirmTree = await render(dialogEntry.component, { t: tPanel });
check(
	"the dialog closes once the delete succeeded",
	confirmTree === null,
	confirmTree === null ? undefined : String(confirmTree?.props?.description)
);
// 删除是物理删除：失败时把原因留在这条弹窗里，而不是关掉它。
failDelete = true;
client.dialogStore.set({ kind: "delete", ids: ["s-3"], title: "写博客" });
resetHooks();
confirmTree = await render(dialogEntry.component, { t: tPanel });
ackBox().props.onChange({ target: { checked: true } });
confirmTree = await render(dialogEntry.component, { t: tPanel });
confirmTree.props.footer.children[1].props.onClick();
await new Promise((resolve) => setTimeout(resolve, 0));
confirmTree = await render(dialogEntry.component, { t: tPanel });
check(
	"a failed delete keeps the dialog open and shows the host reason",
	confirmTree !== null && JSON.stringify(confirmTree).includes("删除失败（自检）"),
	JSON.stringify(confirmTree?.props?.description)
);
client.dialogStore.set(null);
failDelete = false;

// ── 设置页 id：导航栏图标是「按 id 查表」的（外壳的 navIcon()） ──────────
check(
	'with an empty ledger the section borrows the "archived-sessions" id (archive glyph in the nav)',
	sectionIdWith(() => []) === "archived-sessions"
);

/** 只关心 id 的探针：换不同账本，看设置页最后用哪个 id。 */
function sectionIdWith(entries) {
	const registered = [];
	const ctx = {
		get: () => undefined,
		locale: { register: () => {}, bind: () => (key) => key },
		slots: {
			inject: (slot, callback) => callback(),
			register: (options) => registered.push(options)
		},
		effect: (callback) => callback(),
		logger: { warn: () => {} }
	};
	if (entries !== undefined) ctx.slots.entries = entries;
	client.apply(ctx);
	return registered.find((options) => options.name === "settings.section").id;
}

check("without a slot ledger it falls back to its own id", sectionIdWith(undefined) === "session-curator");
check(
	"and it never collides when DSH ships its own archived-sessions section",
	sectionIdWith(() => [{ options: { id: "archived-sessions" } }]) === "session-curator"
);

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);

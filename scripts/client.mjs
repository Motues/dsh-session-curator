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

// ── 迷你 React：够跑一次挂载 + 若干次重渲染 ──────────────────────────────
const runtime = { index: 0, values: [], callbacks: [], records: [], pending: [], dirty: false };

const React = {
	// 记成普通对象树，断言直接走 type / props / children。
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
		const changed = deps === undefined
			|| previous === undefined
			|| deps.length !== previous.deps.length
			|| deps.some((value, position) => !Object.is(value, previous.deps[position]));
		runtime.records[at] = { deps, cleanup: previous?.cleanup };
		runtime.pending.push({ at, callback, run: changed });
	},
	useCallback: (callback) => {
		const at = runtime.index++;
		runtime.callbacks[at] ??= callback;
		return runtime.callbacks[at];
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
	"Menu",
	"MenuItemButton",
	"Modal",
	"IconChevronDownOutlineRegular",
	"IconChevronRightOutlineRegular",
	"IconEllipsisOutlineRegular",
	"IconFolderCloseRegular",
	"IconFolderOpenRegular",
	"IconPinOutlineRegular",
	"IconRefreshOutlineRegular",
	"IconTrashOutlineRegular",
	"IconUnarchiveOutlineRegular"
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

const t = (key) => ({
	noProject: "(unknown)",
	sessions: "{n} sessions",
	selectAllShort: "Select all",
	clearShort: "Clear",
	rowActions: "More actions"
}[key] ?? key);

/** 造一行：只保留分组会看的字段。 */
const row = (sessionId, cwd, workspaceTitle, bytes, workspaceId) => ({ sessionId, cwd, workspaceTitle, bytes, workspaceId });

// ── A. 分组纯逻辑 ────────────────────────────────────────────────────────
// 1) 同一个文件夹的不同写法必须落到同一组：大小写、末尾分隔符、正反斜杠。
const sameFolder = groupRows([
	row("a", "C:\\Data\\Desktop\\Github\\Momo", "Momo", 100),
	row("b", "c:/data/desktop/github/momo\\", "Momo", 250),
	row("c", "C:\\Data\\Desktop\\Github\\Momo\\", null, 0)
], t);
check("cwd casing / separators / trailing slash collapse into one group", sameFolder.length === 1 && sameFolder[0].rows.length === 3, `${sameFolder.length} group(s)`);
check("group bytes accumulate (non-numbers ignored)", sameFolder[0].bytes === 350, String(sameFolder[0].bytes));

// 2) 组名：先 workspaceTitle，再文件夹名，最后 (unknown)。
const titles = groupRows([
	row("a", "C:\\work\\Alpha", "Alpha 标题", 1),
	row("b", "C:\\work\\beta", null, 1),
	row("c", null, null, 1)
], t);
check("title prefers workspaceTitle, then the folder basename", titles.some((group) => group.title === "Alpha 标题") && titles.some((group) => group.title === "beta"), titles.map((group) => group.title).join(", "));
check('rows with neither cwd nor workspaceId land in the "unknown" group, sorted last', titles[titles.length - 1].title === "(unknown)" && titles[titles.length - 1].key === "unknown");

// 3) 组间按标题排序（与宿主顺序无关），组内保持宿主顺序。
const ordered = groupRows([
	row("z1", "C:\\w\\Zeta", "Zeta", 1),
	row("a1", "C:\\w\\alpha", "alpha", 1),
	row("z2", "C:\\w\\Zeta", "Zeta", 1)
], t);
check("groups are sorted by title", ordered.map((group) => group.title).join(" < ") === "alpha < Zeta", ordered.map((group) => group.title).join(", "));
check("rows keep the host order inside a group", ordered[1].rows.map((entry) => entry.sessionId).join(",") === "z1,z2", ordered[1].rows.map((entry) => entry.sessionId).join(","));

// 4) 没有 cwd 时退到 workspaceId：不同工作区不能被并成一组。
const byId = groupRows([row("a", null, "W1", 1, "ws-1"), row("b", null, "W1", 1, "ws-2")], t);
check("missing cwd falls back to workspaceId", byId.length === 2 && byId.every((group) => group.key.startsWith("id:")), byId.map((group) => group.key).join(", "));

// 5) 空输入 / 空 cwd 字符串都不炸。
check("empty input yields no groups", groupRows([], t).length === 0);
check("blank cwd is treated as missing", groupKeyOf({ sessionId: "a", cwd: "   " }) === "unknown", groupKeyOf({ sessionId: "a", cwd: "   " }));

// 6) 两个新组件是纯 props 函数，可以直接调。
const alpha = groupRows([
	row("a", "C:\\w\\Alpha", "Alpha", 10),
	row("b", "C:\\w\\Alpha", "Alpha", 20)
], t)[0];

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
check("group header hides the card top border and paints a faint band", header.props.style.borderTop === "none" && header.props.style.background === "var(--dsw-alias-interactive-bg-active)");
check("no checkbox on the left of the folder row", headerChildren.length === 2 && toggleButton.type === "button" && toggleButton.children.every((child) => child?.type !== "input"));

// 标题按钮里的顺序：折叠箭头 → 文件夹图标 → 名字 → 数量 → 体积 → 路径。
const toggleChildren = toggleButton.children;
check("the chevron sits before the folder icon, which sits before the name", toggleChildren[0].type === "span" && toggleChildren[0].children[0].type === "IconChevronDownOutlineRegular" && toggleChildren[1].type === "span" && toggleChildren[1].children[0].type === "IconFolderOpenRegular" && toggleChildren[2].children[0] === "Alpha");
check("the folder icon is dimmer than the title and inherits currentColor", toggleChildren[1].props.style.color === "var(--dsw-alias-label-secondary)" && toggleChildren[1].children[0].props.size === 14);
const headerLabels = toggleChildren.filter((child) => typeof child?.children?.[0] === "string").map((child) => child.children[0]);
check("group header shows title, count and size", ["Alpha", "2 sessions", "30 B"].every((label) => headerLabels.includes(label)), JSON.stringify(headerLabels));
check("a fully selected group offers the short clear action on the right", selectButton.type === "Button" && selectButton.children[0] === "Clear" && selectButton.props.title.includes("Alpha"));
toggleButton.props.onClick();
selectButton.props.onClick();
check("header click / right-hand button call the handlers", collapses === 1 && groupToggles === 1, `collapse=${collapses} select=${groupToggles}`);

const freshHeader = GroupHeader({ group: alpha, t, first: false, busy: true, selected: [], collapsed: false, onToggleCollapse: () => {}, onToggleGroup: () => {} });
check("an unselected group offers Select all and disables it while busy", freshHeader.children[1].children[0] === "Select all" && freshHeader.children[1].props.disabled === true);

const collapsedHeader = GroupHeader({ group: alpha, t, first: false, busy: false, selected: [], collapsed: true, onToggleCollapse: () => {}, onToggleGroup: () => {} });
const collapsedToggle = draw(collapsedHeader).children[0];
check("collapsing swaps chevron-down for chevron-right and the open folder for a closed one", collapsedToggle.children[0].children[0].type === "IconChevronRightOutlineRegular" && collapsedToggle.children[1].children[0].type === "IconFolderCloseRegular");

// 行：动作收进一个「⋯」菜单。
const menu = { items: [{ id: "restore", label: "Restore", icon: null }], run: () => {} };
const rowMenuOf = (element) => draw(element).children[2].children[0];
const withCwd = SessionRow({ row: alpha.rows[0], t, first: true, busy: false, showCwd: true, showDeletedAt: false, checked: false, onToggle: () => {}, menu, menuOpen: false, onToggleMenu: () => {}, onCloseMenu: () => {} });
const withoutCwd = SessionRow({ row: alpha.rows[0], t, first: false, busy: false, showCwd: false, showDeletedAt: false, checked: true, onToggle: () => {}, menu, menuOpen: true, onToggleMenu: () => {}, onCloseMenu: () => {} });
const metaOf = (element) => element.children[1].children[1].children.join("");
check("row shows the folder only in flat mode", metaOf(withCwd).includes("C:\\w\\Alpha") && !metaOf(withoutCwd).includes("C:\\w\\Alpha"), `${JSON.stringify(metaOf(withCwd))} vs ${JSON.stringify(metaOf(withoutCwd))}`);
check("a row's right side is exactly one ⋯ menu, not a row of buttons", draw(withoutCwd).children[2].children.length === 1 && rowMenuOf(withoutCwd).type === "Menu");
const rowMenuElement = rowMenuOf(withoutCwd);
check("the menu is anchored to an icon-only ghost Button carrying the ellipsis icon", rowMenuElement.props.anchor.type === "Button" && rowMenuElement.props.anchor.props.variant === "ghost" && rowMenuElement.props.anchor.props.icon.type === "IconEllipsisOutlineRegular" && rowMenuElement.props.anchor.props.children === undefined, `icon=${rowMenuElement.props.anchor.props.icon?.type}`);
check("the menu follows the panel's open state and portals itself", rowMenuElement.props.open === true && rowMenuOf(withCwd).props.open === false && rowMenuElement.props.portal === true);
check("the ⋯ trigger is dimmed like the sidebar's row actions", rowMenuElement.props.anchor.props.style.color === "var(--dsw-alias-label-secondary)" && String(rowMenuElement.props.anchor.props["aria-label"]).includes("More actions"));

// ── B. 整块面板：假 ctx 调 apply()，拿到真正注册的面板组件后渲染 ─────────
const SNAPSHOT = {
	dshHome: "C:\\Users\\Motues\\.dsh",
	trashDir: "C:\\Users\\Motues\\.dsh\\storages\\session-manager\\trash",
	sessionsDir: "C:\\Users\\Motues\\.dsh\\sessions",
	archived: [
		{ sessionId: "s-1", title: "修 Header", cwd: "C:\\Data\\Momo", workspaceId: "w1", workspaceTitle: "Momo", bytes: 100, files: 1, createdAt: 1 },
		{ sessionId: "s-2", title: "改毛玻璃", cwd: "C:\\Data\\Momo", workspaceId: "w1", workspaceTitle: "Momo", bytes: 200, files: 1, createdAt: 2 },
		{ sessionId: "s-3", title: "写博客", cwd: "C:\\Data\\BlogPage", workspaceId: "w2", workspaceTitle: "BlogPage", bytes: 300, files: 1, createdAt: 3 }
	],
	pinned: [{ sessionId: "s-4", title: "钉住的", cwd: "C:\\Data\\Momo", workspaceId: "w1", workspaceTitle: "Momo", bytes: 10, files: 1, createdAt: 4 }],
	trashed: [{ sessionId: "s-9", title: "旧会话", cwd: "C:\\Data\\BlogPage", workspaceId: "w2", workspaceTitle: "BlogPage", bytes: 40, files: 1, deletedAt: 9 }],
	totals: { archived: 3, archivedBytes: 600, pinned: 1, trashed: 1, trashBytes: 40 }
};

const slots = [];
let dictionaries = null;
const hostCalls = [];
const fakeCtx = {
	get: (name) => (name === "connection"
		? {
			rpc: {
				call: async (channel, endpoint, payload) => {
					hostCalls.push({ channel, endpoint, payload });
					return { ok: true, value: SNAPSHOT };
				}
			}
		}
		: undefined),
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
check("apply() registers exactly the three contributions", slots.length === 3 && section !== undefined, slots.map((entry) => entry.options.id).join(", "));
/** 面板拿到的 `t`：直接用面板注册时交上去的那份中文词典（带 {n} 插值）。 */
const tPanel = (key, params) => {
	let value = dictionaries.zh[key] ?? key;
	for (const name of Object.keys(params ?? {})) value = value.split(`{${name}}`).join(String(params[name]));
	return value;
};

let tree = await render(section.component, { t: tPanel });
const nodesOf = (current, type) => collect(current, []).filter((node) => node.type === type);
const headers = () => nodesOf(tree, client.GroupHeader);
const rowsSeen = () => nodesOf(tree, client.SessionRow);
/** 组标题的两个交互件：`[折叠按钮, 右侧全选按钮]`。 */
const partsOf = (element) => draw(element).children;
const footerText = () => JSON.stringify(tree);

check("archived tab renders one group header per workspace, sorted by title", headers().length === 2 && headers()[0].props.group.title === "BlogPage" && headers()[1].props.group.title === "Momo", headers().map((node) => node.props.group.title).join(", "));
check("rows stay inside their group (1 + 2)", headers()[0].props.group.rows.length === 1 && headers()[1].props.group.rows.length === 2);
check("the card's first node has no top border", headers()[0].props.first === true && headers()[1].props.first === false);
check("rows are counted, not just headers", rowsSeen().length === 3, `${rowsSeen().length} row(s)`);
check("footer shows the session total", footerText().includes("3 个会话 · 600 B"));
check("footer carries the workspace count", footerText().includes("2 个工作区"));
check("every group header renders the chevron, the folder icon and the right-hand select button", headers().every((node) => {
	const parts = partsOf(node);
	const toggle = parts[0].children;
	return toggle[0].children[0].type === "IconChevronDownOutlineRegular" && toggle[1].children[0].type === "IconFolderOpenRegular" && parts[1].type === "Button" && toggle.every((child) => child?.type !== "input");
}), "");
check("every folder row paints the faint band", headers().every((node) => draw(node).props.style.background === "var(--dsw-alias-interactive-bg-active)"), "");

// 折叠 Momo 组：点它的标题按钮 → 该组的行必须消失，但组标题还在。
partsOf(headers()[1])[0].props.onClick();
tree = await render(section.component, { t: tPanel });
check("collapsing a group keeps its header but hides its rows", headers().length === 2 && rowsSeen().length === 1, `${headers().length} header(s), ${rowsSeen().length} row(s)`);
check("the collapsed header shows a chevron-right and a closed folder", headers()[1].props.collapsed === true && partsOf(headers()[1])[0].children[0].children[0].type === "IconChevronRightOutlineRegular" && partsOf(headers()[1])[0].children[1].children[0].type === "IconFolderCloseRegular");

// 展开回来。
partsOf(headers()[1])[0].props.onClick();
tree = await render(section.component, { t: tPanel });
check("expanding restores the rows", rowsSeen().length === 3, `${rowsSeen().length} row(s)`);

// 整组勾选：点 Momo 组右侧的小按钮 → 该组两行都进选择，页脚出现"已选 2 项"，按钮翻成"取消"。
check("the right-hand button starts as 全选", partsOf(headers()[1])[1].children[0] === "全选", partsOf(headers()[1])[1].children[0]);
partsOf(headers()[1])[1].props.onClick();
tree = await render(section.component, { t: tPanel });
check("the group select button selects the whole workspace", footerText().includes("已选 2 项"));
check("a fully selected group flips the button to 取消", partsOf(headers()[1])[1].children[0] === "取消", partsOf(headers()[1])[1].children[0]);
partsOf(headers()[1])[1].props.onClick();
tree = await render(section.component, { t: tPanel });
check("clicking 取消 clears the whole workspace again", !footerText().includes("已选"));

// ── 行的「⋯」菜单：形状统一、动作真的打到宿主 ──────────────────────────
const menusOf = (element) => collect(draw(element), []).filter((node) => node.type === "Menu");
const menuOfRow = (sessionId) => {
	const element = rowsSeen().find((node) => node.props.row.sessionId === sessionId);
	return element === undefined ? undefined : menusOf(element)[0];
};

check("each session row has exactly one ⋯ menu", rowsSeen().length === 3 && rowsSeen().every((node) => menusOf(node).length === 1 && draw(node).children[2].children.length === 1), rowsSeen().map((node) => menusOf(node).length).join(","));
const archivedMenu = menuOfRow("s-1");
check("archived rows offer unarchive / pin / move-to-trash (no dead 永久删除)", archivedMenu.props.items.map((item) => item.id).join(",") === "unarchive,pin,trash", archivedMenu.props.items.map((item) => item.label).join(" · "));
check("the destructive item is flagged danger and every item carries an icon", archivedMenu.props.items[2].danger === true && archivedMenu.props.items[0].icon.type === "IconUnarchiveOutlineRegular" && archivedMenu.props.items[2].icon.type === "IconTrashOutlineRegular", archivedMenu.props.items.map((item) => item.icon.type).join(","));
check("menus start closed", menusOf(rowsSeen()[0]).every((node) => node.props.open === false));

// 点 ⋯ → 只开这一行。
archivedMenu.props.anchor.props.onClick({ stopPropagation: () => {} });
tree = await render(section.component, { t: tPanel });
check("clicking ⋯ opens only that row's menu", menuOfRow("s-1").props.open === true && menuOfRow("s-2").props.open === false);

// 选"取消归档" → 关菜单 + 打到宿主 unarchive。
const callsBefore = hostCalls.length;
menuOfRow("s-1").props.onSelect("unarchive");
tree = await render(section.component, { t: tPanel });
check("selecting unarchive closes the menu and calls the host once", menuOfRow("s-1").props.open === false && hostCalls.length === callsBefore + 1 && hostCalls[hostCalls.length - 1].endpoint === "session-curator/unarchive" && hostCalls[hostCalls.length - 1].payload.ids.join(",") === "s-1", JSON.stringify(hostCalls[hostCalls.length - 1]));

// 选"移入回收站" → 不打宿主，改成弹确认框（软删除永远先问）。
menuOfRow("s-2").props.onSelect("trash");
tree = await render(section.component, { t: tPanel });
check("selecting move-to-trash asks for confirmation instead of calling the host", hostCalls.length === callsBefore + 1 && menuOfRow("s-2").props.open === false);

// 关掉分组 → 平铺：没有组标题，行里重新显示文件夹。
/** 每次都要重新找按钮：元素是快照，闭包里的状态也会过期。 */
const buttonByLabel = (prefix) => collect(tree, []).find((node) => node.type === "Button" && (node.children?.[0] ?? "").startsWith(prefix));
check("toolbar exposes the grouping toggle", buttonByLabel("分组") !== undefined, JSON.stringify(collect(tree, []).filter((node) => node.type === "Button").map((node) => node.children?.[0])));
buttonByLabel("分组").props.onClick();
tree = await render(section.component, { t: tPanel });
const flatMeta = rowsSeen().map((node) => metaOf(draw(node)));
check("turning grouping off renders a flat list with the folder back on each row", headers().length === 0 && rowsSeen().length === 3 && flatMeta.every((meta) => meta.includes("C:\\Data\\")), `${headers().length} header(s), ${rowsSeen().length} row(s), meta=${JSON.stringify(flatMeta)}`);
check("the toggle now reports the flat mode", buttonByLabel("分组：平铺") !== undefined);
buttonByLabel("分组：平铺").props.onClick();
tree = await render(section.component, { t: tPanel });
check("turning grouping back on restores the headers", headers().length === 2, `${headers().length} header(s)`);

// 切到回收站页签：同样按工作区分组（回收站行用 __trash.json 里的 cwd）。
check("trash tab button exists", buttonByLabel("回收站") !== undefined, JSON.stringify(collect(tree, []).filter((node) => node.type === "Button").map((node) => node.children?.[0])));
buttonByLabel("回收站").props.onClick();
tree = await render(section.component, { t: tPanel });
check("trash tab groups by the recorded workspace folder too", headers().length === 1 && headers()[0].props.group.title === "BlogPage" && rowsSeen().length === 1, `${headers().length} header(s), ${rowsSeen().length} row(s)`);
check("trash rows offer restore + permanent delete", menuOfRow("s-9").props.items.map((item) => item.id).join(",") === "restore,purge", menuOfRow("s-9").props.items.map((item) => item.label).join(" · "));
check("trash rows keep the same single-⋯ shape", draw(rowsSeen()[0]).children[2].children.length === 1);

// ── 设置页 id：导航栏图标是「按 id 查表」的（外壳的 navIcon()） ──────────
check('with an empty ledger the section borrows the "archived-sessions" id (archive glyph in the nav)', sectionIdWith(() => []) === "archived-sessions");

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
check("and it never collides when DSH ships its own archived-sessions section", sectionIdWith(() => [{ options: { id: "archived-sessions" } }]) === "session-curator");

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);

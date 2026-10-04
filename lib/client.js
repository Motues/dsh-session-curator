/**
 * dsh-session-curator — client 半区（免构建手写束）。
 *
 * 三个贡献：
 *   1. `sidebar.workspaces.session.menu.item`（order 500，排在官方 archive 之后）：
 *      一行「删除会话」，点击后弹确认框，确认即软删除到回收站。
 *   2. `shell.overlay`：全局确认弹窗宿主（菜单项与设置面板共用）。
 *   3. `settings.section`（order 45）：会话管理面板 —— 已归档 / 已置顶 / 回收站。
 *
 * 与宿主通信走 Connection 的共享 `/api` 通道：官方调用器
 * （`ctx.get('connection').rpc.call`，若该服务在客户端存在）或逐字复刻的
 * `fetch` 兜底，目标都是 `/api/session-curator/<endpoint>`。信任栅栏与会话鉴权
 * 仍由宿主 Connection 的 `/api` 前缀路由把关，插件自身无需任何鉴权代码。
 */
window.__ModuleLoader__.load({
	id: "dsh-session-curator",
	factory: (require) => {
		const bundleModule = { exports: {} };
		Object.defineProperty(bundleModule.exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const {
			Button,
			Menu,
			MenuItemButton,
			Modal,
			SegmentedControl,
			Switch,
			IconChevronDownOutlineRegular,
			IconChevronRightOutlineRegular,
			IconEllipsisOutlineRegular,
			IconFolderCloseRegular,
			IconFolderOpenRegular,
			IconPinOutlineRegular,
			IconRefreshOutlineRegular,
			IconTrashOutlineRegular,
			IconUnarchiveOutlineRegular
		} = require("@deepseek-ai/dsh-client-ui-primitives");
		const h = React.createElement;

		const NS = "session-curator";
		/** 官方共享通道；本插件占 `/api/session-curator/<endpoint>`。 */
		const API_CHANNEL = "/api";
		const ROUTE_PREFIX = "session-curator";
		const MENU_ID = "session-curator.delete";
		const OVERLAY_ID = "session-curator.dialog";
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
		 */
		function sectionIdFor(ctx) {
			try {
				const taken = ctx.slots.entries("settings.section").some((entry) => entry?.options?.id === NAV_SECTION_ID);
				return taken ? SECTION_ID : NAV_SECTION_ID;
			} catch {
				// 拿不到账本（没有 entries）就退回自己的 id。
				return SECTION_ID;
			}
		}

		// ── 文案 ────────────────────────────────────────────────────────────
		const zh = {
			sectionLabel: "会话管理",
			menuDelete: "删除会话",
			titleArchived: "已归档",
			titlePinned: "已置顶",
			titleTrash: "回收站",
			refresh: "刷新",
			loading: "读取中…",
			retry: "重试",
			emptyArchived: "还没有归档的会话。在会话行的「⋯」菜单里归档后会出现在这里。",
			emptyPinned: "没有置顶的会话。",
			emptyTrash: "回收站是空的。",
			unarchive: "取消归档",
			pin: "置顶",
			unpin: "取消置顶",
			restore: "恢复",
			purge: "永久删除",
			moveToTrash: "移入回收站",
			rowActions: "更多操作",
			selectAll: "全选",
			selectNone: "取消选择",
			selected: "已选 {n} 项",
			emptyTrashAll: "清空回收站",
			total: "合计 {n} 个会话 · {size}",
			working: "处理中…",
			sessionRunning: "会话正在运行，先停止它再删除。",
			confirmTrashTitle: "删除会话",
			confirmTrashBody: "「{title}」会被移到回收站，之后可以在「设置 → 会话管理」里恢复。",
			confirmTrashAction: "移到回收站",
			confirmPurgeTitle: "永久删除",
			confirmPurgeBody: "「{title}」将从回收站永久删除，日志文件会被彻底移除，无法恢复。",
			confirmPurgeManyBody: "选中的 {n} 个会话将从回收站永久删除，无法恢复。",
			confirmPurgeAction: "永久删除",
			ackPurge: "我明白这无法撤销",
			cancel: "取消",
			close: "关闭",
			noProject: "（未知目录）",
			files: "{n} 个文件",
			groupingOn: "分组：工作区",
			groupingOff: "分组：平铺",
			groupHint: "按会话原来的工作区文件夹归类；点分组标题折叠，左边的勾选框选中整个工作区",
			sessions: "{n} 个会话",
			workspaces: "{n} 个工作区",
			selectGroup: "全选该工作区",
			clearGroup: "取消选中该工作区",
			selectAllShort: "全选",
			clearShort: "取消",
			collapse: "折叠",
			expand: "展开",
			titleConfig: "配置",
			configTitle: "基础设置",
			configTab: "默认页签",
			configTabHint: "打开这里时先显示哪个页签",
			configGrouping: "按工作区分组",
			configGroupingHint: "关掉就是平铺列表；顶部的「分组」按钮改的是同一个值",
			configSidebarArchived: "侧边栏显示已归档会话",
			configSidebarArchivedHint: "对应侧边栏「视图选项」里的「隐藏已归档 / 全部对话（显示已归档）」；存的是官方那份设置，改完要刷新页面才生效",
			configSidebarRefreshHint: "已写入官方设置，但侧边栏要刷新页面才会跟着变。",
			refreshPage: "刷新页面",
			configMeta: "行内显示体积与文件数",
			configMetaHint: "关掉后每行只留标题（平铺时仍会显示文件夹）",
			configOrder: "排序",
			configOrderHint: "原顺序就是宿主给的顺序（回收站里是最近删除在前）",
			orderHost: "原顺序",
			orderTitle: "标题",
			orderBytes: "体积",
			configAutoUpdate: "自动检查更新",
			configAutoUpdateHint: "打开这个页面时问一次 npm registry（10 分钟内有缓存）",
			configReset: "恢复默认",
			configResetDone: "已恢复默认设置",
			configSaved: "已保存",
			aboutTitle: "关于",
			versionLabel: "版本",
			updateChecking: "正在检查更新…",
			updateLatest: "已是最新版本",
			updateAvailable: "有新版本 {latest}（当前 {current}）",
			updateFailed: "检查更新失败：{reason}",
			updateRetry: "重新检查",
			updateCheckNow: "检查更新",
			updateStepsTitle: "升级步骤",
			updateStepOne: "在终端里升级包（按你自己的 profile 名替换 desktop）：",
			updateStepTwo: "重启 DSH 让宿主半区生效；只改了客户端半区的话刷新页面就够。",
			updateOpen: "打开 npm 页面"
		};
		const en = {
			sectionLabel: "Session manager",
			menuDelete: "Delete session",
			titleArchived: "Archived",
			titlePinned: "Pinned",
			titleTrash: "Trash",
			refresh: "Refresh",
			loading: "Loading…",
			retry: "Retry",
			emptyArchived: "No archived sessions yet. Archive one from its “⋯” menu and it shows up here.",
			emptyPinned: "No pinned sessions.",
			emptyTrash: "The trash is empty.",
			unarchive: "Unarchive",
			pin: "Pin",
			unpin: "Unpin",
			restore: "Restore",
			purge: "Delete permanently",
			moveToTrash: "Move to trash",
			rowActions: "More actions",
			selectAll: "Select all",
			selectNone: "Clear selection",
			selected: "{n} selected",
			emptyTrashAll: "Empty trash",
			total: "{n} sessions · {size}",
			working: "Working…",
			sessionRunning: "This session is running; stop it before deleting.",
			confirmTrashTitle: "Delete session",
			confirmTrashBody: "“{title}” moves to the trash. You can restore it later under Settings → Session manager.",
			confirmTrashAction: "Move to trash",
			confirmPurgeTitle: "Delete permanently",
			confirmPurgeBody: "“{title}” is removed from the trash for good; its log files are gone and cannot be recovered.",
			confirmPurgeManyBody: "{n} selected sessions are removed from the trash for good and cannot be recovered.",
			confirmPurgeAction: "Delete permanently",
			ackPurge: "I understand this cannot be undone",
			cancel: "Cancel",
			close: "Close",
			noProject: "(unknown directory)",
			files: "{n} files",
			groupingOn: "Grouped: workspace",
			groupingOff: "Grouped: off",
			groupHint: "Group sessions under their original workspace folder; click a header to collapse it, the checkbox selects the whole workspace",
			sessions: "{n} sessions",
			workspaces: "{n} workspaces",
			selectGroup: "Select this workspace",
			clearGroup: "Clear this workspace",
			selectAllShort: "Select all",
			clearShort: "Clear",
			collapse: "Collapse",
			expand: "Expand",
			titleConfig: "Settings",
			configTitle: "Basics",
			configTab: "Default tab",
			configTabHint: "Which tab the panel opens on",
			configGrouping: "Group by workspace",
			configGroupingHint: "Off renders a flat list; the top “Grouped” button edits the same value",
			configSidebarArchived: "Show archived sessions in the sidebar",
			configSidebarArchivedHint: "Mirrors “Hide archived / All conversations” in the sidebar's view options; it is the official setting, so a page refresh applies it",
			configSidebarRefreshHint: "Written to the official setting — the sidebar only follows it after a page refresh.",
			refreshPage: "Refresh page",
			configMeta: "Show size and file count per row",
			configMetaHint: "Off leaves only the title (the folder still shows in the flat list)",
			configOrder: "Order",
			configOrderHint: "Host order is what the host sent (the trash is most-recently-deleted first)",
			orderHost: "Host",
			orderTitle: "Title",
			orderBytes: "Size",
			configAutoUpdate: "Check for updates automatically",
			configAutoUpdateHint: "Asks the npm registry when this page opens (cached for 10 minutes)",
			configReset: "Reset to defaults",
			configResetDone: "Defaults restored",
			configSaved: "Saved",
			aboutTitle: "About",
			versionLabel: "Version",
			updateChecking: "Checking for updates…",
			updateLatest: "You are on the latest version",
			updateAvailable: "Version {latest} is available (you have {current})",
			updateFailed: "Update check failed: {reason}",
			updateRetry: "Check again",
			updateCheckNow: "Check for updates",
			updateStepsTitle: "How to upgrade",
			updateStepOne: "Upgrade the package in a terminal (replace desktop with your profile name):",
			updateStepTwo: "Restart DSH so the host half reloads; a client-half change only needs a page refresh.",
			updateOpen: "Open the npm page"
		};

		// ── 两个模块级小 store（弹窗宿主与设置面板共享） ─────────────────────
		function createStore(initial) {
			let value = initial;
			const listeners = new Set();
			return {
				get: () => value,
				set: (next) => {
					value = next;
					for (const listener of listeners) listener();
				},
				subscribe: (listener) => {
					listeners.add(listener);
					return () => listeners.delete(listener);
				}
			};
		}
		function useStore(store) {
			const [value, setValue] = React.useState(store.get);
			React.useEffect(() => store.subscribe(() => setValue(store.get())), [store]);
			return value;
		}

		/** 待确认的请求；null 表示没有弹窗。 */
		const dialogStore = createStore(null);
		/** 每次写操作成功后自增，让设置面板重新拉快照。 */
		const mutationStore = createStore(0);

		// ── 面板设置：localStorage 持久化，拿不到就只在内存里生效 ─────────────
		const SETTINGS_KEY = "dsh-session-curator.settings";
		/** `tab` 只允许三个数据页签：配置页不能当"默认页签"。 */
		const DEFAULT_SETTINGS = { tab: "archived", grouping: true, showMeta: true, order: "host", autoUpdate: true };

		function readSettings() {
			try {
				const raw = globalThis.localStorage ? globalThis.localStorage.getItem(SETTINGS_KEY) : null;
				if (typeof raw !== "string" || raw === "") return { ...DEFAULT_SETTINGS };
				const parsed = JSON.parse(raw);
				const next = { ...DEFAULT_SETTINGS };
				for (const key of Object.keys(DEFAULT_SETTINGS)) {
					// 类型不符（手改过的 localStorage / 老版本留下的键）一律退回默认值。
					if (typeof parsed[key] === typeof DEFAULT_SETTINGS[key]) next[key] = parsed[key];
				}
				if (next.tab === "config") next.tab = DEFAULT_SETTINGS.tab;
				return next;
			} catch {
				return { ...DEFAULT_SETTINGS };
			}
		}

		const settingsStore = createStore(readSettings());
		function updateSettings(patch) {
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
		const groupingStore = createStore(settingsStore.get().grouping);

		// ── 官方侧边栏的"显示已归档" ─────────────────────────────────────────
		/**
		 * 官方那份"视图"存储的 localStorage 键：`@deepseek-ai/dsh-client-ui-workspace` 里
		 * `defineStore({ …, persist: "dsh.workspace.view.v5" })`，整份 JSON 形如
		 * `{ groupBy, orderBy, groupExpansion, sessionOrderByAccount, archivedFilter }`。
		 * 侧边栏「视图选项」菜单里的 隐藏已归档 / 全部对话（显示已归档）/ 仅显示已归档
		 * 写的就是 `archivedFilter`（`default` / `show` / `only`）。
		 */
		const SIDEBAR_VIEW_KEY = "dsh.workspace.view.v5";

		function readSidebarArchived() {
			try {
				const raw = globalThis.localStorage ? globalThis.localStorage.getItem(SIDEBAR_VIEW_KEY) : null;
				if (typeof raw !== "string" || raw === "") return "default";
				const parsed = JSON.parse(raw);
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
		function writeSidebarArchived(show) {
			try {
				if (!globalThis.localStorage) return false;
				const raw = globalThis.localStorage.getItem(SIDEBAR_VIEW_KEY);
				let parsed = raw === null || raw === "" ? null : JSON.parse(raw);
				if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) parsed = {};
				parsed.archivedFilter = show ? "show" : "default";
				globalThis.localStorage.setItem(SIDEBAR_VIEW_KEY, JSON.stringify(parsed));
				return true;
			} catch {
				return false;
			}
		}

		/** 更新检查状态：`{ state: idle|checking|done|failed, value, error }`。 */
		const updateStore = createStore({ state: "idle", value: null, error: null });
		async function checkUpdate(force) {
			updateStore.set({ state: "checking", value: updateStore.get().value, error: null });
			try {
				const value = await call("check-update", force === true ? { force: true } : {});
				updateStore.set({ state: "done", value, error: null });
			} catch (error) {
				updateStore.set({ state: "failed", value: updateStore.get().value, error: reportError(error) });
			}
		}

		function requestTrash(ids, title) {
			dialogStore.set({ kind: "trash", ids, title });
		}
		function requestPurge(ids, title) {
			dialogStore.set({ kind: "purge", ids, title });
		}

		// ── 宿主调用 ────────────────────────────────────────────────────────
		let ctxRef = null;

		/** RFC 4122 v4；浏览器在非安全上下文也有 crypto.getRandomValues。 */
		function randomUuid() {
			const bytes = new Uint8Array(16);
			const crypto = globalThis.crypto;
			if (crypto && typeof crypto.getRandomValues === "function") crypto.getRandomValues(bytes);
			else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
			const view = new DataView(bytes.buffer);
			view.setUint8(6, (view.getUint8(6) & 15) | 64);
			view.setUint8(8, (view.getUint8(8) & 63) | 128);
			const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
			return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
		}

		/** 端点相对共享通道的目标：`/api/session-curator/<endpoint>`。 */
		function target(endpoint) {
			return `${ROUTE_PREFIX}/${endpoint}`;
		}

		/**
		 * 手写 Connection 线协议：逐字复刻 `@deepseek-ai/dsh-client-connection/lib/client.js`
		 * 的 `createWebConnectionRpc().call` —— POST `${channel}/${endpoint}`（去掉前导 `/`，
		 * 即文档相对路径），body 是 `{type:'client-request', rpcId, method, payload}`，
		 * 其中 `method` 是**相对通道**的端点（宿主按它核对路由），响应信封是
		 * `{type:'server-response', rpcId, result:{ok,value|error}}`。
		 * 这样客户端**不依赖任何 Cordis 服务**；这条 HTTP 路由的信任栅栏与会话鉴权
		 * 仍然由宿主 Connection 的 `/api` 前缀路由把关。
		 */
		async function rawCall(endpoint, payload) {
			const rpcId = randomUuid();
			const url = `${API_CHANNEL}/${ROUTE_PREFIX}/${endpoint}`;
			const response = await fetch(url.slice(1), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ type: "client-request", rpcId, method: target(endpoint), payload: payload || {} })
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}（${url}）`);
			let envelope;
			try {
				envelope = await response.json();
			} catch {
				throw new Error(`响应不是 JSON（${url}）`);
			}
			if (!envelope || envelope.type !== "server-response" || typeof envelope.rpcId !== "string") {
				throw new Error("无效的 server-response 信封");
			}
			if (envelope.rpcId !== rpcId) throw new Error(`rpcId 不匹配（${endpoint}）`);
			const result = envelope.result;
			if (!result || (result.ok !== true && result.ok !== false)) throw new Error("无效的 server-response 结果");
			if (!result.ok) throw new Error(`${result.error ? result.error.code : "error"}: ${result.error ? result.error.message : "未知错误"}`);
			return result.value;
		}

		/** 首选宿主自带的调用器（若客户端真有这个服务），否则退回手写 fetch。 */
		async function call(endpoint, payload) {
			const connection = ctxRef === null ? null : ctxRef.get("connection");
			const rpc = connection ? connection.rpc : null;
			if (rpc && typeof rpc.call === "function") {
				const result = await rpc.call(API_CHANNEL, target(endpoint), payload || {});
				if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
				return result.value;
			}
			return rawCall(endpoint, payload);
		}
		function reportError(error) {
			const message = error instanceof Error ? error.message : String(error);
			if (ctxRef !== null && ctxRef.logger) ctxRef.logger.warn(`[session-curator] ${message}`);
			return message;
		}
		/** 逐项结果里第一条失败原因，用于把宿主拒绝转成一句人话。 */
		function firstFailure(results) {
			for (const row of results || []) {
				if (!row.ok) return row.reason || "操作失败";
			}
			return null;
		}

		// ── 展示辅助 ────────────────────────────────────────────────────────
		function formatBytes(bytes) {
			if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "0 B";
			const units = ["B", "KB", "MB", "GB"];
			let value = bytes;
			let unit = 0;
			while (value >= 1024 && unit < units.length - 1) {
				value /= 1024;
				unit += 1;
			}
			return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
		}
		function formatTime(ms) {
			if (typeof ms !== "number" || ms <= 0) return "";
			try {
				return new Date(ms).toLocaleString();
			} catch {
				return "";
			}
		}
		function text(t, key, params) {
			let value = t(key);
			if (params) {
				for (const name of Object.keys(params)) value = value.split(`{${name}}`).join(String(params[name]));
			}
			return value;
		}
		function baseName(path) {
			if (typeof path !== "string" || path === "") return "";
			const parts = path.split(/[\\/]/).filter((part) => part !== "");
			return parts.length > 0 ? parts[parts.length - 1] : path;
		}

		// ── 按工作区文件夹分组 ──────────────────────────────────────────────
		/**
		 * 分组键 = 会话**原来的工作区文件夹**。
		 * 优先 cwd（Windows 大小写不敏感、末尾分隔符无关，所以归一化后再比），
		 * 没有 cwd 时退到 workspaceId，两者都没有就落进"未知目录"那一组。
		 */
		function groupKeyOf(row) {
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
		function groupRows(rows, t) {
			const groups = new Map();
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

		// ── 内联样式（全部走主题 token，不依赖 styles 服务） ────────────────
		const S = {
			column: { display: "flex", flexDirection: "column", gap: "10px", padding: "4px 0", minWidth: 0 },
			rowLine: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
			tabBar: { display: "flex", alignItems: "center", gap: "6px" },
			card: {
				border: "1px solid var(--dsw-alias-border-l1)",
				borderRadius: "10px",
				overflow: "hidden"
			},
			list: { display: "flex", flexDirection: "column" },
			item: {
				display: "flex",
				alignItems: "center",
				gap: "10px",
				padding: "8px 10px",
				borderTop: "1px solid var(--dsw-alias-border-l1)"
			},
			itemMain: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: "1 1 auto" },
			itemTitle: {
				color: "var(--dsw-alias-label-primary)",
				fontSize: "13px",
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			itemMeta: {
				color: "var(--dsw-alias-label-secondary)",
				fontSize: "11px",
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			itemActions: { display: "flex", alignItems: "center", gap: "6px", flex: "0 0 auto" },
			/** 「⋯」触发器：图标按钮，弱化成次要前景色（跟侧边栏行的图标按钮一致）。 */
			rowMenuButton: { color: "var(--dsw-alias-label-secondary)", padding: "0 6px" },
			/**
			 * 文件夹那一行的底色。**不能用 `--dsw-alias-bg-layer-*`**：浅色主题里
			 * base / layer-1 / layer-2 / layer-3 都指向同一个颜色（`neutral-bluish-00`），
			 * 铺上去等于没铺（这就是之前"看不出区别"的原因）。
			 * `interactive-bg-active` 是带 alpha 的叠加色（#2631481a，约 10%），
			 * 深浅主题都有效；比行 hover 用的 `interactive-bg-hover`（约 6%）略重一点，
			 * 这样"文件夹条"和"鼠标划过的会话行"不会糊在一起。
			 */
			groupHead: {
				display: "flex",
				alignItems: "center",
				gap: "10px",
				padding: "6px 10px",
				background: "var(--dsw-alias-interactive-bg-active)",
				borderTop: "1px solid var(--dsw-alias-border-l1)"
			},
			groupToggle: {
				display: "flex",
				alignItems: "center",
				gap: "8px",
				minWidth: 0,
				flex: "1 1 auto",
				background: "transparent",
				border: "none",
				padding: 0,
				margin: 0,
				color: "inherit",
				font: "inherit",
				textAlign: "left",
				cursor: "pointer"
			},
			/** 图标只吃 `size` / `className`，不接 `style`：颜色靠外层 span 的 currentColor 传下去。 */
			groupCaret: { color: "var(--dsw-alias-label-tertiary)", flex: "0 0 auto", display: "flex", alignItems: "center" },
			groupIcon: { color: "var(--dsw-alias-label-secondary)", flex: "0 0 auto", display: "flex", alignItems: "center" },
			groupTitle: {
				color: "var(--dsw-alias-label-primary)",
				fontSize: "12px",
				fontWeight: 600,
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
				flex: "0 1 auto"
			},
			groupMeta: { color: "var(--dsw-alias-label-tertiary)", fontSize: "11px", flex: "0 0 auto" },
			groupPath: {
				color: "var(--dsw-alias-label-tertiary)",
				fontSize: "11px",
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
				minWidth: 0,
				flex: "0 1 auto"
			},
			empty: { color: "var(--dsw-alias-label-secondary)", fontSize: "12px", padding: "14px 10px", textAlign: "center" },
			error: { color: "var(--dsw-alias-state-error-primary)", fontSize: "12px" },
			footer: { color: "var(--dsw-alias-label-secondary)", fontSize: "11px", display: "flex", gap: "10px", flexWrap: "wrap" },
			mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
			ack: { display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--dsw-alias-label-primary)" },
			/** 顶部条：页签在左，动作靠 `marginInlineStart: auto` 推到右边。 */
			header: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
			headerActions: { display: "flex", alignItems: "center", gap: "8px", marginInlineStart: "auto" },
			/** 配置页的一行：左边标签 + 说明，右边控件。 */
			configRow: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: "12px",
				padding: "10px 12px",
				borderTop: "1px solid var(--dsw-alias-border-l1)"
			},
			configMain: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
			configLabel: { color: "var(--dsw-alias-label-primary)", fontSize: "13px" },
			configHint: { color: "var(--dsw-alias-label-tertiary)", fontSize: "11px" },
			configControl: { display: "flex", alignItems: "center", gap: "8px", flex: "0 0 auto" },
			configFoot: {
				display: "flex",
				alignItems: "center",
				gap: "8px",
				flexWrap: "wrap",
				padding: "10px 12px",
				borderTop: "1px solid var(--dsw-alias-border-l1)"
			},
			/** 版本号：浅色小字。 */
			version: { color: "var(--dsw-alias-label-tertiary)", fontSize: "11px" },
			/**
			 * 升级提示块。底色用带 alpha 的 `interactive-bg-active` —— 浅色主题里
			 * base / layer-1 / layer-2 / layer-3 是同一个颜色，铺上去等于没铺。
			 */
			updateBox: {
				display: "flex",
				flexDirection: "column",
				gap: "6px",
				padding: "10px 12px",
				borderTop: "1px solid var(--dsw-alias-border-l1)",
				background: "var(--dsw-alias-interactive-bg-active)"
			},
			updateTitle: { color: "var(--dsw-alias-label-primary)", fontSize: "12px", fontWeight: 600 },
			updateSteps: { color: "var(--dsw-alias-label-secondary)", fontSize: "11px", display: "flex", flexDirection: "column", gap: "4px" },
			code: {
				display: "block",
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
				fontSize: "11px",
				color: "var(--dsw-alias-label-primary)",
				background: "var(--dsw-alias-interactive-bg-active)",
				borderRadius: "6px",
				padding: "6px 8px",
				overflowX: "auto",
				whiteSpace: "pre"
			},
			link: { color: "var(--dsw-alias-label-primary)", fontSize: "11px" }
		};

		// ── 会话行 ──────────────────────────────────────────────────────────
		/**
		 * 一行会话。分组开着时 `showCwd` 为 false —— 文件夹已经写在组标题上，
		 * 行里不必再重复一遍；平铺时才把它显示回来。
		 *
		 * 右侧原来并排 2–3 个文字按钮（"看着有点乱"），现在统一成**一个「⋯」菜单**
		 * （`Menu` + `IconEllipsisOutlineRegular`，与侧边栏会话行的 ⋯ 完全同一套写法）：
		 * 每行的形状一致，动作收进菜单，危险项用 `danger` 标红。
		 */
		function SessionRow(props) {
			const row = props.row;
			const t = props.t;
			const meta = [];
			if (props.showCwd) meta.push(row.cwd ? row.cwd : t("noProject"));
			// 体积 / 文件数可以在配置页关掉（默认开）；文件夹那一段不受影响。
			if (props.showMeta !== false) {
				if (row.bytes) meta.push(formatBytes(row.bytes));
				if (row.files) meta.push(text(t, "files", { n: row.files }));
			}
			const time = props.showDeletedAt ? formatTime(row.deletedAt) : formatTime(row.createdAt);
			if (time !== "") meta.push(time);

			const menu = props.menu;
			return h(
				"div",
				{ style: props.first ? { ...S.item, borderTop: "none" } : S.item },
				h("input", {
					type: "checkbox",
					checked: props.checked,
					disabled: props.busy,
					"aria-label": row.title,
					onChange: () => props.onToggle()
				}),
				h(
					"div",
					{ style: S.itemMain },
					h("div", { style: S.itemTitle, title: row.title }, row.title),
					h("div", { style: S.itemMeta, title: row.cwd || "" }, meta.join(" · "))
				),
				h(
					"div",
					{ style: S.itemActions },
					h(Menu, {
						open: props.menuOpen,
						portal: true,
						side: "bottom",
						align: "end",
						closeOnPointerLeave: true,
						items: menu.items,
						onSelect: (id) => menu.run(id),
						onClose: () => props.onCloseMenu(),
						anchor: h(Button, {
							size: "sm",
							variant: "ghost",
							disabled: props.busy,
							style: S.rowMenuButton,
							icon: h(IconEllipsisOutlineRegular, {}),
							"aria-label": `${row.title} — ${t("rowActions")}`,
							onClick: (event) => {
								event.stopPropagation();
								props.onToggleMenu();
							}
						})
					})
				)
			);
		}

		/** 一个工作区分组的标题行：左边（箭头 + 文件夹图标 + 名字）折叠 / 展开，右边一个小按钮选整组。 */
		function GroupHeader(props) {
			const group = props.group;
			const t = props.t;
			const total = group.rows.length;
			const allSelected = total > 0 && group.rows.every((row) => props.selected.includes(row.sessionId));
			const action = allSelected ? t("clearShort") : t("selectAllShort");
			return h(
				"div",
				{ style: props.first ? { ...S.groupHead, borderTop: "none" } : S.groupHead },
				h(
					"button",
					{
						type: "button",
						style: S.groupToggle,
						title: props.collapsed ? t("expand") : t("collapse"),
						onClick: () => props.onToggleCollapse()
					},
					// 箭头与文件夹图标都用 DSH 自带图标（跟侧边栏的项目行同款，展开 = 打开的文件夹）。
					h("span", { style: S.groupCaret }, props.collapsed
						? h(IconChevronRightOutlineRegular, { size: 12 })
						: h(IconChevronDownOutlineRegular, { size: 12 })),
					h("span", { style: S.groupIcon }, props.collapsed
						? h(IconFolderCloseRegular, { size: 14 })
						: h(IconFolderOpenRegular, { size: 14 })),
					h("span", { style: S.groupTitle, title: group.cwd || group.title }, group.title),
					h("span", { style: S.groupMeta }, text(t, "sessions", { n: total })),
					group.bytes > 0 ? h("span", { style: S.groupMeta }, formatBytes(group.bytes)) : null,
					group.cwd !== null ? h("span", { style: { ...S.groupPath, ...S.mono }, title: group.cwd }, group.cwd) : null
				),
				h(Button, {
					size: "sm",
					variant: "ghost",
					disabled: props.busy,
					title: `${group.title} — ${allSelected ? t("clearGroup") : t("selectGroup")}`,
					onClick: () => props.onToggleGroup()
				}, action)
			);
		}

		// ── 设置面板 ────────────────────────────────────────────────────────
		function SessionManagerPanel(props) {
			const t = props.t;
			const settings = useStore(settingsStore);
			/** 初始页签来自配置页的"默认页签"。 */
			const [tab, setTab] = React.useState(settings.tab);
			const [snapshot, setSnapshot] = React.useState(null);
			const [error, setError] = React.useState(null);
			const [loading, setLoading] = React.useState(true);
			const [busy, setBusy] = React.useState(false);
			const [selected, setSelected] = React.useState([]);
			// 折叠的分组键（`<tab>:<groupKey>`），按页签各记各的。
			const [collapsed, setCollapsed] = React.useState([]);
			// 同一时刻只允许一个行的「⋯」菜单开着：存 sessionId。
			const [menuFor, setMenuFor] = React.useState(null);
			const grouping = useStore(groupingStore);
			const revision = useStore(mutationStore);
			const update = useStore(updateStore);
			// 官方侧边栏的"显示已归档"：初值从它自己的 localStorage 读；改完要刷新页面才生效，
			// 所以另外记住"挂载时是什么"，两者不一致时才提示刷新。
			const [sidebarArchived, setSidebarArchived] = React.useState(readSidebarArchived);
			const [sidebarAtMount] = React.useState(readSidebarArchived);

			const applyResult = (value) => {
				if (value && value.archived) setSnapshot(value);
			};

			const refresh = React.useCallback(async () => {
				setLoading(true);
				try {
					applyResult(await call("snapshot", {}));
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

			// 换页签时清空选择，避免把上一个页签的 id 带到下一个页签的操作里。
			React.useEffect(() => {
				setSelected([]);
				setMenuFor(null);
			}, [tab]);

			const run = async (endpoint, ids, payload) => {
				if (ids.length === 0) return;
				setBusy(true);
				try {
					const value = await call(endpoint, { ids, ...(payload || {}) });
					applyResult(value);
					setError(firstFailure(value.results));
					setSelected([]);
				} catch (failure) {
					setError(reportError(failure));
				} finally {
					setBusy(false);
				}
			};

			const toggle = (sessionId) => {
				setSelected((current) => current.includes(sessionId) ? current.filter((id) => id !== sessionId) : current.concat([sessionId]));
			};

			/** 整组一起选 / 取消选：组内全选就整组取消，否则补齐。 */
			const toggleGroup = (group) => {
				const ids = group.rows.map((row) => row.sessionId);
				const all = ids.every((id) => selected.includes(id));
				setSelected((current) => all
					? current.filter((id) => !ids.includes(id))
					: [...new Set(current.concat(ids))]);
			};

			const archived = snapshot ? snapshot.archived : [];
			const pinned = snapshot ? snapshot.pinned : [];
			const trashed = snapshot ? snapshot.trashed : [];
			/** 排序是显示层的事：`host` 就是宿主给的顺序（回收站是最近删除在前）。 */
			const sortRows = (list) => {
				if (settings.order === "title") {
					return [...list].sort((left, right) => String(left.title ?? "").localeCompare(String(right.title ?? "")));
				}
				if (settings.order === "bytes") {
					return [...list].sort((left, right) => (right.bytes ?? 0) - (left.bytes ?? 0));
				}
				return list;
			};
			const rows = sortRows(tab === "archived" ? archived : tab === "pinned" ? pinned : tab === "trash" ? trashed : []);
			const selectedRows = rows.filter((row) => selected.includes(row.sessionId));

			// 分组只是显示层：选择、批量操作、计数仍然按整个页签的行来算。
			const groups = grouping ? groupRows(rows, t) : [];
			const blockOf = (group) => {
				const key = `${tab}:${group.key}`;
				return { key, group, rows: collapsed.includes(key) ? [] : group.rows };
			};
			const blocks = grouping ? groups.map(blockOf) : [{ key: `${tab}:flat`, group: null, rows }];

			const tabs = [
				{ id: "archived", label: t("titleArchived"), count: archived.length },
				{ id: "pinned", label: t("titlePinned"), count: pinned.length },
				{ id: "trash", label: t("titleTrash"), count: trashed.length },
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
			const rowMenu = (row) => {
				const moveToTrash = {
					id: "trash",
					label: t("moveToTrash"),
					icon: h(IconTrashOutlineRegular, { size: 14 }),
					danger: true
				};
				if (tab === "archived") {
					return {
						items: [
							{ id: "unarchive", label: t("unarchive"), icon: h(IconUnarchiveOutlineRegular, { size: 14 }) },
							{ id: "pin", label: t("pin"), icon: h(IconPinOutlineRegular, { size: 14 }) },
							moveToTrash
						],
						run: (id) => {
							setMenuFor(null);
							if (id === "trash") requestTrash([row.sessionId], row.title);
							else void run(id, [row.sessionId]);
						}
					};
				}
				if (tab === "pinned") {
					return {
						items: [
							{ id: "unpin", label: t("unpin"), icon: h(IconPinOutlineRegular, { size: 14 }) },
							moveToTrash
						],
						run: (id) => {
							setMenuFor(null);
							if (id === "trash") requestTrash([row.sessionId], row.title);
							else void run(id, [row.sessionId]);
						}
					};
				}
				return {
					items: [
						{ id: "restore", label: t("restore"), icon: h(IconRefreshOutlineRegular, { size: 14 }) },
						{ id: "purge", label: t("purge"), icon: h(IconTrashOutlineRegular, { size: 14 }), danger: true }
					],
					run: (id) => {
						setMenuFor(null);
						if (id === "purge") requestPurge([row.sessionId], row.title);
						else void run(id, [row.sessionId]);
					}
				};
			};

			const batch = [];
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
			const nodes = [];
			let first = true;
			for (const block of blocks) {
				if (block.group !== null) {
					const group = block.group;
					const isCollapsed = collapsed.includes(block.key);
					nodes.push(h(GroupHeader, {
						key: `group:${block.key}`,
						group,
						t,
						first,
						busy,
						selected,
						collapsed: isCollapsed,
						onToggleGroup: () => toggleGroup(group),
						onToggleCollapse: () => setCollapsed((current) => current.includes(block.key)
							? current.filter((item) => item !== block.key)
							: current.concat([block.key]))
					}));
					first = false;
				}
				for (const row of block.rows) {
					nodes.push(h(SessionRow, {
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
			const configRow = (key, label, hint, control, firstRow) => h(
				"div",
				{ key, style: firstRow ? { ...S.configRow, borderTop: "none" } : S.configRow },
				h(
					"div",
					{ style: S.configMain },
					h("span", { style: S.configLabel }, label),
					hint === null ? null : h("span", { style: S.configHint }, hint)
				),
				h("div", { style: S.configControl }, control)
			);

			/** 版本号优先用宿主报的（快照里带 `version`），其次用更新检查回来的当前版本。 */
			const version = typeof (snapshot && snapshot.version) === "string"
				? snapshot.version
				: (update.value && typeof update.value.current === "string" ? update.value.current : null);
			const outdated = update.state === "done" && update.value !== null && update.value.outdated === true;
			/** 状态行：检查中 / 失败 / 已是最新。有新版本时改用下面的升级块。 */
			const updateLine = update.state === "checking"
				? h("span", { style: S.configHint }, t("updateChecking"))
				: update.state === "failed"
					? h("span", { style: S.error }, text(t, "updateFailed", { reason: update.error === null ? "?" : update.error }))
					: update.value !== null && typeof update.value.error === "string"
						? h("span", { style: S.configHint }, text(t, "updateFailed", { reason: update.value.error }))
						: update.state === "done" && !outdated
							? h("span", { style: S.configHint }, t("updateLatest"))
							: null;

			const configPage = h(
				"div",
				{ style: S.column },
				h(
					"div",
					{ style: S.card },
					configRow("config:tab", t("configTab"), t("configTabHint"), h(SegmentedControl, {
						id: "session-curator-default-tab",
						value: settings.tab,
						options: [
							{ value: "archived", label: t("titleArchived") },
							{ value: "pinned", label: t("titlePinned") },
							{ value: "trash", label: t("titleTrash") }
						],
						label: t("configTab"),
						onChange: (next) => void updateSettings({ tab: next })
					}), true),
					configRow("config:grouping", t("configGrouping"), t("configGroupingHint"), h(Switch, {
						checked: settings.grouping,
						label: t("configGrouping"),
						onChange: (next) => {
							updateSettings({ grouping: next });
							groupingStore.set(next);
						}
					})),
					configRow("config:sidebar-archived", t("configSidebarArchived"), t("configSidebarArchivedHint"), h(Switch, {
						checked: sidebarArchived !== "default",
						label: t("configSidebarArchived"),
						onChange: (next) => {
							writeSidebarArchived(next);
							setSidebarArchived(next ? "show" : "default");
						}
					})),
					// 官方 store 只在创建时读一次 localStorage，所以改完必须刷新页面。
					sidebarArchived === sidebarAtMount ? null : h(
						"div",
						{ key: "config:sidebar-refresh", style: S.configFoot },
						h("span", { style: S.configHint }, t("configSidebarRefreshHint")),
						h(Button, {
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
					configRow("config:meta", t("configMeta"), t("configMetaHint"), h(Switch, {
						checked: settings.showMeta,
						label: t("configMeta"),
						onChange: (next) => void updateSettings({ showMeta: next })
					})),
					configRow("config:order", t("configOrder"), t("configOrderHint"), h(SegmentedControl, {
						id: "session-curator-order",
						value: settings.order,
						options: [
							{ value: "host", label: t("orderHost") },
							{ value: "title", label: t("orderTitle") },
							{ value: "bytes", label: t("orderBytes") }
						],
						label: t("configOrder"),
						onChange: (next) => void updateSettings({ order: next })
					})),
					configRow("config:auto", t("configAutoUpdate"), t("configAutoUpdateHint"), h(Switch, {
						checked: settings.autoUpdate,
						label: t("configAutoUpdate"),
						onChange: (next) => void updateSettings({ autoUpdate: next })
					})),
					h(
						"div",
						{ key: "config:reset", style: { ...S.configFoot, justifyContent: "flex-end" } },
						h(Button, {
							size: "sm",
							variant: "outline",
							onClick: () => {
								updateSettings({ ...DEFAULT_SETTINGS });
								groupingStore.set(DEFAULT_SETTINGS.grouping);
							}
						}, t("configReset"))
					)
				),

				h(
					"div",
					{ style: S.card },
					h(
						"div",
						{ style: { ...S.configRow, borderTop: "none" } },
						h(
							"div",
							{ style: S.configMain },
							h("span", { style: S.configLabel }, t("aboutTitle")),
							h("span", { style: S.configHint }, "dsh-session-curator")
						),
						h(
							"div",
							{ style: S.configControl },
							// 版本号：浅色小字。
							h("span", { style: S.version }, `${t("versionLabel")} ${version === null ? "—" : `v${version}`}`),
							h(Button, {
								size: "sm",
								variant: "outline",
								disabled: update.state === "checking",
								onClick: () => void checkUpdate(true)
							}, t("updateCheckNow"))
						)
					),
					updateLine === null ? null : h("div", { key: "config:update", style: S.configFoot }, updateLine),
					outdated
						? h(
							"div",
							{ key: "config:upgrade", style: S.updateBox },
							h("span", { style: S.updateTitle }, text(t, "updateAvailable", { latest: update.value.latest, current: version === null ? "?" : version })),
							h(
								"span",
								{ style: S.updateSteps },
								h("span", null, t("updateStepsTitle")),
								h("span", null, t("updateStepOne")),
								h("code", { style: S.code }, "dsh plugin --profile desktop add dsh-session-curator@latest"),
								h("span", null, t("updateStepTwo"))
							),
							h("a", {
								style: S.link,
								href: "https://www.npmjs.com/package/dsh-session-curator",
								target: "_blank",
								rel: "noreferrer"
							}, t("updateOpen"))
						)
						: null
				)
			);

			return h(
				"div",
				{ style: S.column },
				h(
					"div",
					{ style: S.header },
					h(
						"div",
						{ style: S.tabBar },
						tabs.map((entry) => h(Button, {
							key: entry.id,
							size: "sm",
							variant: tab === entry.id ? "primary" : "ghost",
							onClick: () => setTab(entry.id)
						}, `${entry.label}${entry.count > 0 ? ` (${entry.count})` : ""}`))
					),
					// 分组与刷新推到右边；配置页上没有它们。
					isConfig ? null : h(
						"div",
						{ style: S.headerActions },
						h(Button, {
							size: "sm",
							variant: "outline",
							title: t("groupHint"),
							onClick: () => {
								const next = !grouping;
								groupingStore.set(next);
								updateSettings({ grouping: next });
							}
						}, grouping ? t("groupingOn") : t("groupingOff")),
						h(Button, { size: "sm", variant: "outline", disabled: loading || busy, onClick: () => void refresh() }, t("refresh"))
					)
				),

				error ? h("div", { style: S.error }, error) : null,

				isConfig ? null : h(
					"div",
					{ style: S.card },
					loading && !snapshot
						? h("div", { style: S.empty }, t("loading"))
						: rows.length === 0
							? h("div", { style: S.empty }, tab === "archived" ? t("emptyArchived") : tab === "pinned" ? t("emptyPinned") : t("emptyTrash"))
							: h("div", { style: S.list }, nodes)
				),

				isConfig ? null : h(
					"div",
					{ style: S.rowLine },
					h(Button, {
						size: "sm",
						variant: "ghost",
						disabled: busy || rows.length === 0,
						onClick: () => setSelected(selected.length === rows.length ? [] : rows.map((row) => row.sessionId))
					}, selected.length === rows.length && rows.length > 0 ? t("selectNone") : t("selectAll")),
					batch.map((action) => h(Button, {
						key: action.label,
						size: "sm",
						variant: action.variant || "ghost",
						disabled: busy,
						onClick: action.run
					}, action.label)),
					tab === "trash" && trashed.length > 0
						? h(Button, {
							size: "sm",
							variant: "outline",
							disabled: busy,
							onClick: () => requestPurge(trashed.map((row) => row.sessionId), "")
						}, t("emptyTrashAll"))
						: null,
					busy ? h("span", { style: S.footer }, t("working")) : null
				),

				isConfig ? configPage : null,

				isConfig ? null : h(
					"div",
					{ style: S.footer },
					h("span", null, text(t, "total", { n: rows.length, size: formatBytes(totalBytes) })),
					grouping && groups.length > 0 ? h("span", null, text(t, "workspaces", { n: groups.length })) : null,
					selected.length > 0 ? h("span", null, text(t, "selected", { n: selected.length })) : null,
					snapshot ? h("span", { style: S.mono, title: snapshot.trashDir }, snapshot.trashDir) : null
				)
			);
		}

		// ── 全局确认弹窗宿主（挂在 shell.overlay 上） ────────────────────────
		function DialogHost(props) {
			const t = props.t;
			const request = useStore(dialogStore);
			const [busy, setBusy] = React.useState(false);
			const [ack, setAck] = React.useState(false);
			const [error, setError] = React.useState(null);

			// 每次新请求都重置勾选与错误（hooks 先于条件渲染，保持调用顺序稳定）。
			const requestKey = request === null ? "" : `${request.kind}:${request.ids.join(",")}:${request.title}`;
			React.useEffect(() => {
				setAck(false);
				setError(null);
			}, [requestKey]);

			if (request === null) return null;

			const purge = request.kind === "purge";
			const many = request.ids.length > 1;
			const title = purge ? t("confirmPurgeTitle") : t("confirmTrashTitle");
			const body = purge
				? (many ? text(t, "confirmPurgeManyBody", { n: request.ids.length }) : text(t, "confirmPurgeBody", { title: request.title }))
				: text(t, "confirmTrashBody", { title: request.title });

			const close = () => {
				if (busy) return;
				dialogStore.set(null);
			};

			const confirm = async () => {
				setBusy(true);
				try {
					const value = await call(purge ? "purge" : "trash", { ids: request.ids });
					const failure = firstFailure(value.results);
					if (failure === null) {
						dialogStore.set(null);
						mutationStore.set(mutationStore.get() + 1);
					} else {
						setError(failure);
					}
				} catch (thrown) {
					setError(reportError(thrown));
				} finally {
					setBusy(false);
				}
			};

			return h(
				Modal,
				{
					open: true,
					onClose: close,
					title,
					closeLabel: t("close"),
					description: body,
					footer: h(
						"div",
						{ style: S.rowLine },
						h(Button, { size: "md", variant: "ghost", disabled: busy, onClick: close }, t("cancel")),
						h(Button, {
							size: "md",
							variant: "primary",
							disabled: busy || (purge && !ack),
							onClick: () => void confirm()
						}, purge ? t("confirmPurgeAction") : t("confirmTrashAction"))
					)
				},
				purge
					? h(
						"div",
						{ style: S.column },
						h(
							"label",
							{ style: S.ack },
							h("input", {
								type: "checkbox",
								checked: ack,
								disabled: busy,
								onChange: (event) => setAck(Boolean(event.target.checked))
							}),
							t("ackPurge")
						),
						error ? h("div", { style: S.error }, error) : null
					)
					: (error ? h("div", { style: S.error }, error) : null)
			);
		}

		// ── 插件装配 ────────────────────────────────────────────────────────
		const inject = ["slots", "locale"];

		function apply(ctx) {
			ctxRef = ctx;
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-session-curator: dictionaries");
			const t = ctx.locale.bind(NS);

			// 逐个贡献：某个槽位声明缺失时只丢这一个贡献，不连累其余的。
			const contribute = (slot, options, component, label) => {
				try {
					ctx.slots.inject(slot, () => ctx.slots.register(options, component));
				} catch (error) {
					reportError(error);
					if (ctx.logger) ctx.logger.warn(`[session-curator] slot ${slot} 注册失败（${label}）`);
				}
			};

			// 1) 会话行「⋯」菜单里的删除项，排在官方 archive（400）之后。
			contribute("sidebar.workspaces.session.menu.item", {
				name: "sidebar.workspaces.session.menu.item",
				id: MENU_ID,
				order: 500,
				label: () => t("menuDelete"),
				locale: NS
			}, ({ sessionId, displayTitle, useMenuOpenState }) => {
				const [, setMenuOpen] = useMenuOpenState();
				return h(MenuItemButton, {
					danger: true,
					separatorBefore: true,
					onSelect: () => {
						setMenuOpen(false);
						requestTrash([sessionId], displayTitle || sessionId);
					}
				}, t("menuDelete"));
			}, "menu item");

			// 2) 全局确认弹窗宿主。
			contribute("shell.overlay", {
				name: "shell.overlay",
				id: OVERLAY_ID,
				order: 60,
				locale: NS
			}, DialogHost, "dialog host");

			// 3) 设置页：已归档 / 已置顶 / 回收站（id 见 sectionIdFor：为了导航栏的归档图标）。
			contribute("settings.section", {
				name: "settings.section",
				id: sectionIdFor(ctx),
				order: 45,
				label: () => t("sectionLabel"),
				locale: NS
			}, SessionManagerPanel, "settings section");
		}

		bundleModule.exports.NS = NS;
		bundleModule.exports.apply = apply;
		bundleModule.exports.inject = inject;
		// 纯函数 / 纯组件，给 scripts/client.mjs 直接单测（浏览器里用不到这几个导出）。
		bundleModule.exports.groupRows = groupRows;
		bundleModule.exports.groupKeyOf = groupKeyOf;
		bundleModule.exports.SessionRow = SessionRow;
		bundleModule.exports.GroupHeader = GroupHeader;
		bundleModule.exports.sectionIdFor = sectionIdFor;
		return bundleModule.exports;
	}
});

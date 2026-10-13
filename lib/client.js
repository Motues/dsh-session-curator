// 本文件由 `node scripts/build.mjs` 从 src/client/**/*.ts 生成，不要手改。
window.__ModuleLoader__.load({
	id: "dsh-session-curator",
	// 浏览器只认这种「工厂 + 局部 require」的束：factory 收到的 require 就是 DSH 的模块表，
	// esbuild 把 external 的 import 编译成了对这个参数的调用。
	factory: (require) => {
		const module = { exports: {} };
		(function (module, exports, require) {
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target2, all) => {
  for (var name in all)
    __defProp(target2, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target2) => (target2 = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target2, "default", { value: mod, enumerable: true }) : target2,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  GroupHeader: () => GroupHeader,
  NS: () => NS,
  SessionRow: () => SessionRow,
  apply: () => apply,
  collapseKey: () => collapseKey,
  groupKeyOf: () => groupKeyOf,
  groupRows: () => groupRows,
  inject: () => inject,
  isGroupCollapsed: () => isGroupCollapsed,
  sectionIdFor: () => sectionIdFor,
  toggledCollapse: () => toggledCollapse
});
module.exports = __toCommonJS(index_exports);
var React6 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives5 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/components/dialog-host.ts
var React2 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/runtime.ts
var current = null;
function setContext(ctx) {
  current = ctx;
}
function connectionRpc() {
  const ctx = current;
  if (ctx === null) return null;
  const connection = ctx.get("connection");
  const rpc = connection === null || connection === void 0 ? null : connection.rpc;
  return rpc && typeof rpc.call === "function" ? rpc : null;
}
function ctxLogger() {
  const ctx = current;
  return ctx !== null && ctx.logger ? ctx.logger : null;
}
function reportError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const logger = ctxLogger();
  if (logger) logger.warn(`[session-curator] ${message}`);
  return message;
}

// src/client/api.ts
var API_CHANNEL = "/api";
var ROUTE_PREFIX = "session-curator";
function randomUuid() {
  const bytes = new Uint8Array(16);
  const crypto = globalThis.crypto;
  if (crypto && typeof crypto.getRandomValues === "function") crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  const view = new DataView(bytes.buffer);
  view.setUint8(6, view.getUint8(6) & 15 | 64);
  view.setUint8(8, view.getUint8(8) & 63 | 128);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function target(endpoint) {
  return `${ROUTE_PREFIX}/${endpoint}`;
}
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
  const message = envelope;
  if (!message || message.type !== "server-response" || typeof message.rpcId !== "string") {
    throw new Error("无效的 server-response 信封");
  }
  if (message.rpcId !== rpcId) throw new Error(`rpcId 不匹配（${endpoint}）`);
  const result = message.result;
  if (!result || result.ok !== true && result.ok !== false) throw new Error("无效的 server-response 结果");
  if (result.ok !== true) {
    throw new Error(`${result.error ? result.error.code : "error"}: ${result.error ? result.error.message : "未知错误"}`);
  }
  return result.value;
}
async function call(endpoint, payload) {
  const rpc = connectionRpc();
  if (rpc !== null) {
    const result = await rpc.call(API_CHANNEL, target(endpoint), payload || {});
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
  }
  return await rawCall(endpoint, payload);
}
function firstFailure(results) {
  for (const row of results || []) {
    if (!row.ok) return row.reason || "操作失败";
  }
  return null;
}

// src/client/stores.ts
var React = __toESM(require("react"), 1);
function createStore(initial) {
  let value = initial;
  const listeners = /* @__PURE__ */ new Set();
  return {
    get: () => value,
    set: (next) => {
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}
function useStore(store) {
  const [value, setValue] = React.useState(store.get);
  React.useEffect(() => store.subscribe(() => setValue(store.get())), [store]);
  return value;
}

// src/client/dialog.ts
var dialogStore = createStore(null);
var mutationStore = createStore(0);
function requestTrash(ids, title) {
  dialogStore.set({ kind: "trash", ids, title });
}
function requestPurge(ids, title) {
  dialogStore.set({ kind: "purge", ids, title });
}

// src/client/i18n.ts
var NS = "session-curator";
var zh = {
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
  configGroupDefault: "分组默认状态",
  configGroupDefaultHint: "以后打开的文件夹默认是折叠还是展开；手动点过的文件夹保留手动状态",
  groupExpanded: "展开",
  groupCollapsed: "折叠",
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
var en = {
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
  configGroupDefault: "Default folder state",
  configGroupDefaultHint: "Whether folders start collapsed or expanded; folders you toggled keep their manual state",
  groupExpanded: "Expanded",
  groupCollapsed: "Collapsed",
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
var dictionaries = { zh, en };
function text(t, key, params) {
  let value = t(key);
  if (params) {
    for (const name of Object.keys(params)) value = value.split(`{${name}}`).join(String(params[name]));
  }
  return value;
}
var TAB_LABEL = {
  archived: "titleArchived",
  pinned: "titlePinned",
  trash: "titleTrash"
};

// src/client/styles.ts
var S = {
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
  /**
   * 「⋯」触发器：图标按钮，弱化成次要前景色（跟侧边栏行的图标按钮一致）。
   * `flex: 0 0 auto` 防"长标题挤坏按钮"：行内标题再长也只能挤 `itemMain`
   *（那边有 minWidth: 0 + 省略号），别让收缩落到这个按钮上。
   */
  rowMenuButton: { color: "var(--dsw-alias-label-secondary)", padding: "0 6px", flex: "0 0 auto" },
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
  /**
   * 分组标题右侧的「全选 / 取消」。
   *
   * 为什么必须写这两条：路径一长，`groupHead` 这行必然溢出，浏览器按 flex 基准**按比例**
   * 分配收缩量 —— 右侧按钮也会被挤窄。而 DSH 的 `Button` 是 `display: inline-flex`
   * 且**没有 `white-space: nowrap`**，窄到一定程度「全选」两个字就在按钮里折成两行。
   * 让它完全不参与收缩（`0 0 auto`）、再兜一条 `nowrap`，收缩就只剩左边的折叠按钮承担：
   * 标题 / 路径各自 `minWidth: 0` + 省略号，该截断的地方截断。
   */
  groupAction: { flex: "0 0 auto", whiteSpace: "nowrap" },
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

// src/client/components/dialog-host.ts
function DialogHost(props) {
  const t = props.t;
  const request = useStore(dialogStore);
  const [busy, setBusy] = React2.useState(false);
  const [ack, setAck] = React2.useState(false);
  const [error, setError] = React2.useState(null);
  const requestKey = request === null ? "" : `${request.kind}:${request.ids.join(",")}:${request.title}`;
  React2.useEffect(() => {
    setAck(false);
    setError(null);
  }, [requestKey]);
  if (request === null) return null;
  const purge = request.kind === "purge";
  const many = request.ids.length > 1;
  const title = purge ? t("confirmPurgeTitle") : t("confirmTrashTitle");
  const body = purge ? many ? text(t, "confirmPurgeManyBody", { n: request.ids.length }) : text(t, "confirmPurgeBody", { title: request.title }) : text(t, "confirmTrashBody", { title: request.title });
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
  return React2.createElement(
    import_dsh_client_ui_primitives.Modal,
    {
      open: true,
      onClose: close,
      title,
      closeLabel: t("close"),
      description: body,
      footer: React2.createElement(
        "div",
        { style: S.rowLine },
        React2.createElement(import_dsh_client_ui_primitives.Button, { size: "md", variant: "ghost", disabled: busy, onClick: close }, t("cancel")),
        React2.createElement(import_dsh_client_ui_primitives.Button, {
          size: "md",
          variant: "primary",
          disabled: busy || purge && !ack,
          onClick: () => void confirm()
        }, purge ? t("confirmPurgeAction") : t("confirmTrashAction"))
      )
    },
    purge ? React2.createElement(
      "div",
      { style: S.column },
      React2.createElement(
        "label",
        { style: S.ack },
        React2.createElement("input", {
          type: "checkbox",
          checked: ack,
          disabled: busy,
          onChange: (event) => setAck(Boolean(event.target.checked))
        }),
        t("ackPurge")
      ),
      error ? React2.createElement("div", { style: S.error }, error) : null
    ) : error ? React2.createElement("div", { style: S.error }, error) : null
  );
}

// src/client/components/settings-panel.ts
var React5 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives4 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/format.ts
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
function baseName(path) {
  if (typeof path !== "string" || path === "") return "";
  const parts = path.split(/[\\/]/).filter((part) => part !== "");
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

// src/client/groups.ts
function groupKeyOf(row) {
  if (typeof row.cwd === "string" && row.cwd.trim() !== "") {
    return `cwd:${row.cwd.trim().replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase()}`;
  }
  if (typeof row.workspaceId === "string" && row.workspaceId !== "") return `id:${row.workspaceId}`;
  return "unknown";
}
function groupRows(rows, t) {
  const groups = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const key = groupKeyOf(row);
    let group = groups.get(key);
    if (group === void 0) {
      const cwd = typeof row.cwd === "string" && row.cwd !== "" ? row.cwd : null;
      const title = (typeof row.workspaceTitle === "string" && row.workspaceTitle !== "" ? row.workspaceTitle : null) ?? (cwd === null ? null : baseName(cwd) || cwd) ?? t("noProject");
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
function sortRows(rows, order) {
  if (order === "title") {
    return [...rows].sort((left, right) => String(left.title ?? "").localeCompare(String(right.title ?? "")));
  }
  if (order === "bytes") {
    return [...rows].sort((left, right) => (right.bytes ?? 0) - (left.bytes ?? 0));
  }
  return rows;
}
function collapseKey(tab, groupKey) {
  return `${tab}:${groupKey}`;
}
function isGroupCollapsed(key, overrides, fallback) {
  const manual = overrides[key];
  return manual === void 0 ? fallback === "collapsed" : manual;
}
function toggledCollapse(key, overrides, fallback) {
  const next = { ...overrides };
  const value = !isGroupCollapsed(key, overrides, fallback);
  if (value === (fallback === "collapsed")) delete next[key];
  else next[key] = value;
  return next;
}

// src/client/settings.ts
var DEFAULT_SETTINGS = {
  tab: "archived",
  grouping: true,
  // 与 0.1.1 的行为一致：分组默认是**展开**的，老用户升级后界面不变。
  groupDefault: "expanded",
  showMeta: true,
  order: "host",
  autoUpdate: true
};
var SETTINGS_KEY = "dsh-session-curator.settings";
function readSettings() {
  try {
    const raw = globalThis.localStorage ? globalThis.localStorage.getItem(SETTINGS_KEY) : null;
    if (typeof raw !== "string" || raw === "") return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return { ...DEFAULT_SETTINGS };
    const next = { ...DEFAULT_SETTINGS };
    const pick = (key, validate) => {
      const value = validate(parsed[key]);
      if (value !== void 0) next[key] = value;
    };
    pick("tab", (value) => value === "archived" || value === "pinned" || value === "trash" ? value : void 0);
    pick("grouping", (value) => typeof value === "boolean" ? value : void 0);
    pick("groupDefault", (value) => value === "expanded" || value === "collapsed" ? value : void 0);
    pick("showMeta", (value) => typeof value === "boolean" ? value : void 0);
    pick("order", (value) => value === "host" || value === "title" || value === "bytes" ? value : void 0);
    pick("autoUpdate", (value) => typeof value === "boolean" ? value : void 0);
    return next;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
var settingsStore = createStore(readSettings());
function updateSettings(patch) {
  const next = { ...settingsStore.get(), ...patch };
  settingsStore.set(next);
  try {
    if (globalThis.localStorage) globalThis.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
  }
  return next;
}
var groupingStore = createStore(settingsStore.get().grouping);
var SIDEBAR_VIEW_KEY = "dsh.workspace.view.v5";
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
function writeSidebarArchived(show) {
  try {
    if (!globalThis.localStorage) return false;
    const raw = globalThis.localStorage.getItem(SIDEBAR_VIEW_KEY);
    const parsed = raw === null || raw === "" ? null : JSON.parse(raw);
    const target2 = parsed === null || typeof parsed !== "object" || Array.isArray(parsed) ? {} : parsed;
    target2.archivedFilter = show ? "show" : "default";
    globalThis.localStorage.setItem(SIDEBAR_VIEW_KEY, JSON.stringify(target2));
    return true;
  } catch {
    return false;
  }
}

// src/client/update.ts
var updateStore = createStore({ state: "idle", value: null, error: null });
async function checkUpdate(force) {
  updateStore.set({ state: "checking", value: updateStore.get().value, error: null });
  try {
    const value = await call("check-update", force === true ? { force: true } : {});
    updateStore.set({ state: "done", value, error: null });
  } catch (error) {
    updateStore.set({ state: "failed", value: updateStore.get().value, error: reportError(error) });
  }
}

// src/client/components/group-header.ts
var React3 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");
function GroupHeader(props) {
  const group = props.group;
  const t = props.t;
  const total = group.rows.length;
  const allSelected = total > 0 && group.rows.every((row) => props.selected.includes(row.sessionId));
  const action = allSelected ? t("clearShort") : t("selectAllShort");
  return React3.createElement(
    "div",
    { style: props.first ? { ...S.groupHead, borderTop: "none" } : S.groupHead },
    React3.createElement(
      "button",
      {
        type: "button",
        style: S.groupToggle,
        title: props.collapsed ? t("expand") : t("collapse"),
        onClick: () => props.onToggleCollapse()
      },
      React3.createElement("span", { style: S.groupCaret }, props.collapsed ? React3.createElement(import_dsh_client_ui_primitives2.IconChevronRightOutlineRegular, { size: 12 }) : React3.createElement(import_dsh_client_ui_primitives2.IconChevronDownOutlineRegular, { size: 12 })),
      React3.createElement("span", { style: S.groupIcon }, props.collapsed ? React3.createElement(import_dsh_client_ui_primitives2.IconFolderCloseRegular, { size: 14 }) : React3.createElement(import_dsh_client_ui_primitives2.IconFolderOpenRegular, { size: 14 })),
      React3.createElement("span", { style: S.groupTitle, title: group.cwd || group.title }, group.title),
      React3.createElement("span", { style: S.groupMeta }, text(t, "sessions", { n: total })),
      group.bytes > 0 ? React3.createElement("span", { style: S.groupMeta }, formatBytes(group.bytes)) : null,
      group.cwd !== null ? React3.createElement("span", { style: { ...S.groupPath, ...S.mono }, title: group.cwd }, group.cwd) : null
    ),
    React3.createElement(import_dsh_client_ui_primitives2.Button, {
      size: "sm",
      variant: "ghost",
      disabled: props.busy,
      // 长路径不许把这个按钮挤窄（否则中文标签折行），见 styles.ts 的 groupAction。
      style: S.groupAction,
      title: `${group.title} — ${allSelected ? t("clearGroup") : t("selectGroup")}`,
      onClick: () => props.onToggleGroup()
    }, action)
  );
}

// src/client/components/session-row.ts
var React4 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");
function SessionRow(props) {
  const row = props.row;
  const t = props.t;
  const meta = [];
  if (props.showCwd) meta.push(row.cwd ? row.cwd : t("noProject"));
  if (props.showMeta !== false) {
    if (row.bytes) meta.push(formatBytes(row.bytes));
    if (row.files) meta.push(text(t, "files", { n: row.files }));
  }
  const time = props.showDeletedAt ? formatTime(row.deletedAt) : formatTime(row.createdAt);
  if (time !== "") meta.push(time);
  const menu = props.menu;
  return React4.createElement(
    "div",
    { style: props.first ? { ...S.item, borderTop: "none" } : S.item },
    React4.createElement("input", {
      type: "checkbox",
      checked: props.checked,
      disabled: props.busy,
      "aria-label": row.title,
      onChange: () => props.onToggle()
    }),
    React4.createElement(
      "div",
      { style: S.itemMain },
      React4.createElement("div", { style: S.itemTitle, title: row.title }, row.title),
      React4.createElement("div", { style: S.itemMeta, title: row.cwd || "" }, meta.join(" · "))
    ),
    React4.createElement(
      "div",
      { style: S.itemActions },
      React4.createElement(import_dsh_client_ui_primitives3.Menu, {
        open: props.menuOpen,
        portal: true,
        side: "bottom",
        align: "end",
        closeOnPointerLeave: true,
        items: menu.items,
        onSelect: (id) => menu.run(id),
        onClose: () => props.onCloseMenu(),
        anchor: React4.createElement(import_dsh_client_ui_primitives3.Button, {
          size: "sm",
          variant: "ghost",
          disabled: props.busy,
          style: S.rowMenuButton,
          icon: React4.createElement(import_dsh_client_ui_primitives3.IconEllipsisOutlineRegular, {}),
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

// src/client/components/settings-panel.ts
function SessionManagerPanel(props) {
  const t = props.t;
  const settings = useStore(settingsStore);
  const [tab, setTab] = React5.useState(settings.tab);
  const [snapshot, setSnapshot] = React5.useState(null);
  const [error, setError] = React5.useState(null);
  const [loading, setLoading] = React5.useState(true);
  const [busy, setBusy] = React5.useState(false);
  const [selected, setSelected] = React5.useState([]);
  const [collapsedOverrides, setCollapsedOverrides] = React5.useState({});
  const [menuFor, setMenuFor] = React5.useState(null);
  const grouping = useStore(groupingStore);
  const revision = useStore(mutationStore);
  const update = useStore(updateStore);
  const [sidebarArchived, setSidebarArchived] = React5.useState(readSidebarArchived);
  const [sidebarAtMount] = React5.useState(readSidebarArchived);
  const applyResult = (value) => {
    if (value && value.archived) setSnapshot(value);
  };
  const refresh = React5.useCallback(async () => {
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
  React5.useEffect(() => {
    void refresh();
  }, [refresh, revision]);
  React5.useEffect(() => {
    if (tab !== "config" || !settings.autoUpdate || update.state !== "idle") return;
    void checkUpdate(false);
  }, [tab, settings.autoUpdate, update.state]);
  React5.useEffect(() => {
    setSelected([]);
    setMenuFor(null);
  }, [tab]);
  const run = async (endpoint, ids) => {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const value = await call(endpoint, { ids });
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
    setSelected((current2) => current2.includes(sessionId) ? current2.filter((id) => id !== sessionId) : current2.concat([sessionId]));
  };
  const toggleGroup = (group) => {
    const ids = group.rows.map((row) => row.sessionId);
    const all = ids.every((id) => selected.includes(id));
    setSelected((current2) => all ? current2.filter((id) => !ids.includes(id)) : [...new Set(current2.concat(ids))]);
  };
  const toggleCollapse = (key) => {
    setCollapsedOverrides((current2) => toggledCollapse(key, current2, settings.groupDefault));
  };
  const archived = snapshot ? snapshot.archived : [];
  const pinned = snapshot ? snapshot.pinned : [];
  const trashed = snapshot ? snapshot.trashed : [];
  const rows = sortRows(tab === "archived" ? archived : tab === "pinned" ? pinned : tab === "trash" ? trashed : [], settings.order);
  const selectedRows = rows.filter((row) => selected.includes(row.sessionId));
  const groups = grouping ? groupRows(rows, t) : [];
  const blockOf = (group) => {
    const key = collapseKey(tab, group.key);
    return { key, group, rows: isGroupCollapsed(key, collapsedOverrides, settings.groupDefault) ? [] : group.rows };
  };
  const blocks = grouping ? groups.map(blockOf) : [{ key: `${tab}:flat`, group: null, rows }];
  const tabs = [
    { id: "archived", label: t(TAB_LABEL.archived), count: archived.length },
    { id: "pinned", label: t(TAB_LABEL.pinned), count: pinned.length },
    { id: "trash", label: t(TAB_LABEL.trash), count: trashed.length },
    { id: "config", label: t("titleConfig"), count: 0 }
  ];
  const rowMenu = (row) => {
    const moveToTrash = {
      id: "trash",
      label: t("moveToTrash"),
      icon: React5.createElement(import_dsh_client_ui_primitives4.IconTrashOutlineRegular, { size: 14 }),
      danger: true
    };
    if (tab === "archived") {
      return {
        items: [
          { id: "unarchive", label: t("unarchive"), icon: React5.createElement(import_dsh_client_ui_primitives4.IconUnarchiveOutlineRegular, { size: 14 }) },
          { id: "pin", label: t("pin"), icon: React5.createElement(import_dsh_client_ui_primitives4.IconPinOutlineRegular, { size: 14 }) },
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
          { id: "unpin", label: t("unpin"), icon: React5.createElement(import_dsh_client_ui_primitives4.IconPinOutlineRegular, { size: 14 }) },
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
        { id: "restore", label: t("restore"), icon: React5.createElement(import_dsh_client_ui_primitives4.IconRefreshOutlineRegular, { size: 14 }) },
        { id: "purge", label: t("purge"), icon: React5.createElement(import_dsh_client_ui_primitives4.IconTrashOutlineRegular, { size: 14 }), danger: true }
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
  const totalBytes = tab === "archived" ? totals ? totals.archivedBytes : 0 : tab === "trash" ? totals ? totals.trashBytes : 0 : 0;
  const nodes = [];
  let first = true;
  for (const block of blocks) {
    if (block.group !== null) {
      const group = block.group;
      const key = block.key;
      nodes.push(React5.createElement(GroupHeader, {
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
      nodes.push(React5.createElement(SessionRow, {
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
  const configRow = (key, label, hint, control, firstRow) => React5.createElement(
    "div",
    { key, style: firstRow ? { ...S.configRow, borderTop: "none" } : S.configRow },
    React5.createElement(
      "div",
      { style: S.configMain },
      React5.createElement("span", { style: S.configLabel }, label),
      hint === null ? null : React5.createElement("span", { style: S.configHint }, hint)
    ),
    React5.createElement("div", { style: S.configControl }, control)
  );
  const version = snapshot !== null && typeof snapshot.version === "string" ? snapshot.version : update.value !== null && typeof update.value.current === "string" ? update.value.current : null;
  const outdated = update.state === "done" && update.value !== null && update.value.outdated === true;
  const updateLine = update.state === "checking" ? React5.createElement("span", { style: S.configHint }, t("updateChecking")) : update.state === "failed" ? React5.createElement("span", { style: S.error }, text(t, "updateFailed", { reason: update.error === null ? "?" : update.error })) : update.value !== null && typeof update.value.error === "string" ? React5.createElement("span", { style: S.configHint }, text(t, "updateFailed", { reason: update.value.error })) : update.state === "done" && !outdated ? React5.createElement("span", { style: S.configHint }, t("updateLatest")) : null;
  const configPage = React5.createElement(
    "div",
    { style: S.column },
    React5.createElement(
      "div",
      { style: S.card },
      configRow("config:tab", t("configTab"), t("configTabHint"), React5.createElement(import_dsh_client_ui_primitives4.SegmentedControl, {
        id: "session-curator-default-tab",
        value: settings.tab,
        options: [
          { value: "archived", label: t(TAB_LABEL.archived) },
          { value: "pinned", label: t(TAB_LABEL.pinned) },
          { value: "trash", label: t(TAB_LABEL.trash) }
        ],
        label: t("configTab"),
        onChange: (next) => void updateSettings({ tab: next })
      }), true),
      configRow("config:grouping", t("configGrouping"), t("configGroupingHint"), React5.createElement(import_dsh_client_ui_primitives4.Switch, {
        checked: settings.grouping,
        label: t("configGrouping"),
        onChange: (next) => {
          updateSettings({ grouping: next });
          groupingStore.set(next);
        }
      })),
      configRow("config:group-default", t("configGroupDefault"), t("configGroupDefaultHint"), React5.createElement(import_dsh_client_ui_primitives4.SegmentedControl, {
        id: "session-curator-group-default",
        value: settings.groupDefault,
        options: [
          { value: "expanded", label: t("groupExpanded") },
          { value: "collapsed", label: t("groupCollapsed") }
        ],
        label: t("configGroupDefault"),
        onChange: (next) => void updateSettings({ groupDefault: next })
      })),
      configRow("config:sidebar-archived", t("configSidebarArchived"), t("configSidebarArchivedHint"), React5.createElement(import_dsh_client_ui_primitives4.Switch, {
        checked: sidebarArchived !== "default",
        label: t("configSidebarArchived"),
        onChange: (next) => {
          writeSidebarArchived(next);
          setSidebarArchived(next ? "show" : "default");
        }
      })),
      // 官方 store 只在创建时读一次 localStorage，所以改完必须刷新页面。
      sidebarArchived === sidebarAtMount ? null : React5.createElement(
        "div",
        { key: "config:sidebar-refresh", style: S.configFoot },
        React5.createElement("span", { style: S.configHint }, t("configSidebarRefreshHint")),
        React5.createElement(import_dsh_client_ui_primitives4.Button, {
          size: "sm",
          variant: "outline",
          onClick: () => {
            try {
              globalThis.location.reload();
            } catch {
            }
          }
        }, t("refreshPage"))
      ),
      configRow("config:meta", t("configMeta"), t("configMetaHint"), React5.createElement(import_dsh_client_ui_primitives4.Switch, {
        checked: settings.showMeta,
        label: t("configMeta"),
        onChange: (next) => void updateSettings({ showMeta: next })
      })),
      configRow("config:order", t("configOrder"), t("configOrderHint"), React5.createElement(import_dsh_client_ui_primitives4.SegmentedControl, {
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
      configRow("config:auto", t("configAutoUpdate"), t("configAutoUpdateHint"), React5.createElement(import_dsh_client_ui_primitives4.Switch, {
        checked: settings.autoUpdate,
        label: t("configAutoUpdate"),
        onChange: (next) => void updateSettings({ autoUpdate: next })
      })),
      React5.createElement(
        "div",
        { key: "config:reset", style: { ...S.configFoot, justifyContent: "flex-end" } },
        React5.createElement(import_dsh_client_ui_primitives4.Button, {
          size: "sm",
          variant: "outline",
          onClick: () => {
            updateSettings({ ...DEFAULT_SETTINGS });
            groupingStore.set(DEFAULT_SETTINGS.grouping);
          }
        }, t("configReset"))
      )
    ),
    React5.createElement(
      "div",
      { style: S.card },
      React5.createElement(
        "div",
        { style: { ...S.configRow, borderTop: "none" } },
        React5.createElement(
          "div",
          { style: S.configMain },
          React5.createElement("span", { style: S.configLabel }, t("aboutTitle")),
          React5.createElement("span", { style: S.configHint }, "dsh-session-curator")
        ),
        React5.createElement(
          "div",
          { style: S.configControl },
          // 版本号：浅色小字。
          React5.createElement("span", { style: S.version }, `${t("versionLabel")} ${version === null ? "—" : `v${version}`}`),
          React5.createElement(import_dsh_client_ui_primitives4.Button, {
            size: "sm",
            variant: "outline",
            disabled: update.state === "checking",
            onClick: () => void checkUpdate(true)
          }, t("updateCheckNow"))
        )
      ),
      updateLine === null ? null : React5.createElement("div", { key: "config:update", style: S.configFoot }, updateLine),
      outdated && update.value !== null ? React5.createElement(
        "div",
        { key: "config:upgrade", style: S.updateBox },
        React5.createElement("span", { style: S.updateTitle }, text(t, "updateAvailable", { latest: update.value.latest ?? "?", current: version === null ? "?" : version })),
        React5.createElement(
          "span",
          { style: S.updateSteps },
          React5.createElement("span", null, t("updateStepsTitle")),
          React5.createElement("span", null, t("updateStepOne")),
          React5.createElement("code", { style: S.code }, "dsh plugin --profile desktop add dsh-session-curator@latest"),
          React5.createElement("span", null, t("updateStepTwo"))
        ),
        React5.createElement("a", {
          style: S.link,
          href: "https://www.npmjs.com/package/dsh-session-curator",
          target: "_blank",
          rel: "noreferrer"
        }, t("updateOpen"))
      ) : null
    )
  );
  return React5.createElement(
    "div",
    { style: S.column },
    React5.createElement(
      "div",
      { style: S.header },
      React5.createElement(
        "div",
        { style: S.tabBar },
        tabs.map((entry) => React5.createElement(import_dsh_client_ui_primitives4.Button, {
          key: entry.id,
          size: "sm",
          variant: tab === entry.id ? "primary" : "ghost",
          onClick: () => setTab(entry.id)
        }, `${entry.label}${entry.count > 0 ? ` (${entry.count})` : ""}`))
      ),
      // 分组与刷新推到右边；配置页上没有它们。
      isConfig ? null : React5.createElement(
        "div",
        { style: S.headerActions },
        React5.createElement(import_dsh_client_ui_primitives4.Button, {
          size: "sm",
          variant: "outline",
          title: t("groupHint"),
          onClick: () => {
            const next = !grouping;
            groupingStore.set(next);
            updateSettings({ grouping: next });
          }
        }, grouping ? t("groupingOn") : t("groupingOff")),
        React5.createElement(import_dsh_client_ui_primitives4.Button, { size: "sm", variant: "outline", disabled: loading || busy, onClick: () => void refresh() }, t("refresh"))
      )
    ),
    error ? React5.createElement("div", { style: S.error }, error) : null,
    isConfig ? null : React5.createElement(
      "div",
      { style: S.card },
      loading && !snapshot ? React5.createElement("div", { style: S.empty }, t("loading")) : rows.length === 0 ? React5.createElement("div", { style: S.empty }, tab === "archived" ? t("emptyArchived") : tab === "pinned" ? t("emptyPinned") : t("emptyTrash")) : React5.createElement("div", { style: S.list }, nodes)
    ),
    isConfig ? null : React5.createElement(
      "div",
      { style: S.rowLine },
      React5.createElement(import_dsh_client_ui_primitives4.Button, {
        size: "sm",
        variant: "ghost",
        disabled: busy || rows.length === 0,
        onClick: () => setSelected(selected.length === rows.length ? [] : rows.map((row) => row.sessionId))
      }, selected.length === rows.length && rows.length > 0 ? t("selectNone") : t("selectAll")),
      batch.map((action) => React5.createElement(import_dsh_client_ui_primitives4.Button, {
        key: action.label,
        size: "sm",
        variant: action.variant || "ghost",
        disabled: busy,
        onClick: action.run
      }, action.label)),
      tab === "trash" && trashed.length > 0 ? React5.createElement(import_dsh_client_ui_primitives4.Button, {
        size: "sm",
        variant: "outline",
        disabled: busy,
        onClick: () => requestPurge(trashed.map((row) => row.sessionId), "")
      }, t("emptyTrashAll")) : null,
      busy ? React5.createElement("span", { style: S.footer }, t("working")) : null
    ),
    isConfig ? configPage : null,
    isConfig ? null : React5.createElement(
      "div",
      { style: S.footer },
      React5.createElement("span", null, text(t, "total", { n: rows.length, size: formatBytes(totalBytes) })),
      grouping && groups.length > 0 ? React5.createElement("span", null, text(t, "workspaces", { n: groups.length })) : null,
      selected.length > 0 ? React5.createElement("span", null, text(t, "selected", { n: selected.length })) : null,
      snapshot ? React5.createElement("span", { style: S.mono, title: snapshot.trashDir }, snapshot.trashDir) : null
    )
  );
}

// src/client/index.ts
var MENU_ID = "session-curator.delete";
var OVERLAY_ID = "session-curator.dialog";
var SECTION_ID = "session-curator";
var NAV_SECTION_ID = "archived-sessions";
function sectionIdFor(ctx) {
  try {
    const taken = ctx.slots.entries("settings.section").some((entry) => entry?.options?.id === NAV_SECTION_ID);
    return taken ? SECTION_ID : NAV_SECTION_ID;
  } catch {
    return SECTION_ID;
  }
}
var inject = ["slots", "locale"];
function apply(ctx) {
  setContext(ctx);
  ctx.effect(() => ctx.locale.register(NS, dictionaries), "dsh-session-curator: dictionaries");
  const t = ctx.locale.bind(NS);
  const contribute = (slot, options, component, label) => {
    try {
      ctx.slots.inject(slot, () => ctx.slots.register(options, component));
    } catch (error) {
      reportError(error);
      if (ctx.logger) ctx.logger.warn(`[session-curator] slot ${slot} 注册失败（${label}）`);
    }
  };
  contribute("sidebar.workspaces.session.menu.item", {
    name: "sidebar.workspaces.session.menu.item",
    id: MENU_ID,
    order: 500,
    label: () => t("menuDelete"),
    locale: NS
  }, (props) => {
    const [, setMenuOpen] = props.useMenuOpenState();
    return React6.createElement(import_dsh_client_ui_primitives5.MenuItemButton, {
      danger: true,
      separatorBefore: true,
      onSelect: () => {
        setMenuOpen(false);
        requestTrash([props.sessionId], props.displayTitle || props.sessionId);
      }
    }, t("menuDelete"));
  }, "menu item");
  contribute("shell.overlay", {
    name: "shell.overlay",
    id: OVERLAY_ID,
    order: 60,
    locale: NS
  }, DialogHost, "dialog host");
  contribute("settings.section", {
    name: "settings.section",
    id: sectionIdFor(ctx),
    order: 45,
    label: () => t("sectionLabel"),
    locale: NS
  }, SessionManagerPanel, "settings section");
}
		})(module, module.exports, require);
		return module.exports;
	}
});

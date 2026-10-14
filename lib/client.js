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
  Dropdown: () => Dropdown,
  GroupHeader: () => GroupHeader,
  NS: () => NS,
  SessionRow: () => SessionRow,
  TRASH_DAYS_MAX: () => TRASH_DAYS_MAX,
  TRASH_DAYS_MIN: () => TRASH_DAYS_MIN,
  TRASH_RETENTION_DAYS: () => TRASH_RETENTION_DAYS,
  UsagePanel: () => UsagePanel,
  apply: () => apply,
  cachedSnapshot: () => cachedSnapshot,
  collapseKey: () => collapseKey,
  describeSession: () => describeSession,
  dialogStore: () => dialogStore,
  effectiveTrashDays: () => effectiveTrashDays,
  filterRows: () => filterRows,
  forgetDetails: () => forgetDetails,
  forgetSnapshot: () => forgetSnapshot,
  groupKeyOf: () => groupKeyOf,
  groupRows: () => groupRows,
  inject: () => inject,
  isFilterActive: () => isFilterActive,
  isGroupCollapsed: () => isGroupCollapsed,
  matchesFilter: () => matchesFilter,
  matchesSearch: () => matchesSearch,
  parseCustomDays: () => parseCustomDays,
  sectionIdFor: () => sectionIdFor,
  showNotice: () => showNotice,
  showTrashUndo: () => showTrashUndo,
  sortRows: () => sortRows,
  toastStore: () => toastStore,
  toggledCollapse: () => toggledCollapse,
  undoTrash: () => undoTrash,
  workspaceSummaries: () => workspaceSummaries
});
module.exports = __toCommonJS(index_exports);
var React11 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives9 = require("@deepseek-ai/dsh-client-ui-primitives");

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
function requestPurgeOld(days, count, bytes) {
  dialogStore.set({ kind: "purge-old", ids: [], title: "", days, count, bytes });
}

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
  restoreUnavailable: "无法恢复（缺元数据）",
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
  // 跨页签的"整个工作区一起处理"（分组标题右侧的「⋯」）。
  workspaceActions: "整个工作区",
  workspaceMenu: "工作区操作",
  archiveWorkspace: "整个工作区归档",
  trashWorkspace: "整个工作区移入回收站",
  workspaceRunningHint: "这个工作区里有会话正在运行，危险动作已禁用",
  // 运行中徽标（宿主用官方的 workspace/session-activity 判定）。
  running: "运行中",
  runningHint: "会话正在运行，先停止它再操作",
  // 导出 / 定位。
  copyPath: "复制路径",
  revealInFolder: "在资源管理器中显示",
  pathCopied: "已复制路径：{path}",
  pathCopyFailed: "复制失败，路径是：{path}",
  revealFailed: "没能打开文件管理器（{reason}），路径是：{path}",
  // 磁盘占用视图。
  titleUsage: "磁盘占用",
  usageTitle: "磁盘占用",
  usageTotal: "共 {n} 个会话 · {size}（磁盘上 {disk} 个）",
  usageByWorkspace: "按工作区",
  usageLargest: "最占地方的会话",
  usageOldest: "最久没打开的会话",
  usageLoading: "正在统计…",
  usageArchived: "已归档",
  usagePinned: "已置顶",
  usageTrashed: "在回收站",
  usageSuggestArchive: "建议归档",
  usageArchive: "归档",
  usageUnarchive: "取消归档",
  usageNoData: "没有可统计的会话。",
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
  orderCreatedAt: "创建时间",
  orderDeletedAt: "删除时间",
  // 搜索与过滤（只影响显示；批量操作与计数仍按整个页签算）。
  searchLabel: "搜索会话",
  searchPlaceholder: "搜索标题或目录…",
  searchClear: "清除搜索",
  timeFilterLabel: "时间",
  timeAll: "全部",
  timeRecent: "最近 7 天",
  filtered: "已过滤出 {n} 个会话（共 {total} 个）",
  emptyFiltered: "没有符合搜索条件的会话。",
  // 回收站保留策略（永久删除：永远先预览、再确认，绝不自动后台清理）。
  configTrashDays: "回收站保留天数",
  configTrashDaysHint: "「清理 N 天前」按这个天数算；不会自动执行，每次都要先看预览再确认",
  retentionDays: "{n} 天",
  retentionCustom: "自定义",
  customDaysPlaceholder: "天数",
  customDaysLabel: "自定义保留天数",
  customDaysHint: "填 {min}–{max} 之间的整数；留空就用上面的档位",
  customDaysInvalid: "天数要在 {min}–{max} 之间",
  trashCleanup: "删除 {n} 天前的会话",
  trashPreview: "将删除 {n} 个会话 · {size}",
  trashPreviewNone: "没有超过 {days} 天的会话",
  trashPreviewLoading: "正在统计…",
  confirmPurgeOldTitle: "清理旧会话",
  confirmPurgeOldBody: "将永久删除 {n} 个在 {days} 天前移入回收站的会话（{size}），无法恢复。",
  ackPurgeOld: "我明白这无法撤销",
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
  updateOpen: "打开 npm 页面",
  // 会话行 hover 卡片（`sidebar.session.row.hover`）。
  hoverStats: "{size} · {n} 个文件",
  hoverCwd: "原目录",
  hoverArchived: "已归档",
  hoverPinned: "已置顶",
  hoverTrashed: "在回收站",
  hoverDeleted: "删除于",
  // 删除成功后的撤销提示（`Toast`）。
  toastTrashed: "「{title}」已移入回收站",
  toastTrashedMany: "{n} 个会话已移入回收站",
  toastUndo: "撤销",
  toastUndoFailed: "撤销失败：{reason}"
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
  restoreUnavailable: "Cannot restore (no metadata)",
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
  // Cross-tab "handle the whole workspace" (the ⋯ on a folder header).
  workspaceActions: "Whole workspace",
  workspaceMenu: "Workspace actions",
  archiveWorkspace: "Archive this whole workspace",
  trashWorkspace: "Move this whole workspace to the trash",
  workspaceRunningHint: "A session in this workspace is running, so the destructive actions are off",
  // Running badge (the host asks the official workspace/session-activity hook).
  running: "Running",
  runningHint: "This session is running; stop it first",
  // Export / locate.
  copyPath: "Copy path",
  revealInFolder: "Show in file explorer",
  pathCopied: "Path copied: {path}",
  pathCopyFailed: "Copy failed — the path is: {path}",
  revealFailed: "Could not open the file explorer ({reason}); the path is: {path}",
  // Disk usage view.
  titleUsage: "Disk usage",
  usageTitle: "Disk usage",
  usageTotal: "{n} sessions · {size} ({disk} on disk)",
  usageByWorkspace: "By workspace",
  usageLargest: "Largest sessions",
  usageOldest: "Least recently opened",
  usageLoading: "Measuring…",
  usageArchived: "Archived",
  usagePinned: "Pinned",
  usageTrashed: "In trash",
  usageSuggestArchive: "Archive suggested",
  usageArchive: "Archive",
  usageUnarchive: "Unarchive",
  usageNoData: "No sessions to measure.",
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
  orderCreatedAt: "Created",
  orderDeletedAt: "Deleted",
  // Search and filtering (display only; batch actions and counts still cover the whole tab).
  searchLabel: "Search sessions",
  searchPlaceholder: "Search title or folder…",
  searchClear: "Clear search",
  timeFilterLabel: "Time",
  timeAll: "All",
  timeRecent: "Last 7 days",
  filtered: "{n} of {total} sessions match",
  emptyFiltered: "No session matches the search.",
  // Trash retention (permanent deletion: always preview, then confirm; never automatic).
  configTrashDays: "Trash retention",
  configTrashDaysHint: "How “clean up N days ago” counts the days; it never runs on its own — every cleanup needs a preview and a confirmation",
  retentionDays: "{n} days",
  retentionCustom: "Custom",
  customDaysPlaceholder: "Days",
  customDaysLabel: "Custom retention days",
  customDaysHint: "An integer between {min} and {max}; leave it empty to use the preset above",
  customDaysInvalid: "Days must be between {min} and {max}",
  trashCleanup: "Delete sessions older than {n} days",
  trashPreview: "{n} sessions · {size} will be deleted",
  trashPreviewNone: "Nothing is older than {days} days",
  trashPreviewLoading: "Counting…",
  confirmPurgeOldTitle: "Clean up old sessions",
  confirmPurgeOldBody: "{n} sessions moved to the trash more than {days} days ago ({size}) are deleted for good and cannot be recovered.",
  ackPurgeOld: "I understand this cannot be undone",
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
  updateOpen: "Open the npm page",
  // Session-row hover card (`sidebar.session.row.hover`).
  hoverStats: "{size} · {n} files",
  hoverCwd: "Folder",
  hoverArchived: "Archived",
  hoverPinned: "Pinned",
  hoverTrashed: "In trash",
  hoverDeleted: "Deleted",
  // Undo notice after a successful delete (`Toast`).
  toastTrashed: "“{title}” moved to the trash",
  toastTrashedMany: "{n} sessions moved to the trash",
  toastUndo: "Undo",
  toastUndoFailed: "Undo failed: {reason}"
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

// src/client/snapshot.ts
var last = null;
function cachedSnapshot() {
  return last;
}
function rememberSnapshot(value) {
  last = value;
}
function forgetSnapshot() {
  last = null;
}

// src/client/styles.ts
var ROW_ICON_BUTTON = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "16px",
  height: "16px",
  padding: 0,
  margin: 0,
  border: "none",
  background: "transparent",
  borderRadius: "var(--dsw-radius-xs)",
  cursor: "pointer",
  flex: "none"
};
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
  /**
   * 标题那一行：标题 + 状态胶囊（「运行中」）。
   *
   * 胶囊 `flex: 0 0 auto`、标题 `minWidth: 0` + 省略号 —— 长标题只挤自己那一段，
   * 不会把胶囊压成两行（与分组标题那次"长路径挤坏按钮"同一条教训，见 groupAction）。
   */
  itemTitleRow: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0 },
  itemTitle: {
    color: "var(--dsw-alias-label-primary)",
    fontSize: "13px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0
  },
  itemMeta: {
    color: "var(--dsw-alias-label-secondary)",
    fontSize: "11px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
  },
  /** 状态胶囊：与 hover 卡片那几个同款（带 alpha 的叠加色，深浅主题都有效）。 */
  badge: {
    color: "var(--dsw-alias-label-secondary)",
    fontSize: "10px",
    lineHeight: "16px",
    padding: "0 6px",
    borderRadius: "8px",
    background: "var(--dsw-alias-interactive-bg-active)",
    flex: "0 0 auto"
  },
  badgeDanger: {
    color: "var(--dsw-alias-state-error-primary)",
    fontSize: "10px",
    lineHeight: "16px",
    padding: "0 6px",
    borderRadius: "8px",
    background: "var(--dsw-alias-interactive-bg-active)",
    flex: "0 0 auto"
  },
  /** 「运行中」：同款胶囊，但用业务蓝表示"它是活的"，不是危险。 */
  badgeRunning: {
    color: "var(--dsw-alias-state-business-primary)",
    fontSize: "10px",
    lineHeight: "16px",
    padding: "0 6px",
    borderRadius: "8px",
    background: "var(--dsw-alias-interactive-bg-active)",
    flex: "0 0 auto"
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
  /**
   * 数据页签上的过滤工具条：搜索框在左、时间档在右。
   *
   * `flexWrap` 是必需的：设置页本身可能很窄（侧边栏展开时尤其），搜索框的
   * `minWidth` 兜住它不被压成一条线，挤不下时时间档换行，而不是把输入框挤没。
   */
  filterBar: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
  /** 搜索框自己撑开剩余宽度；给个下限，窄屏下也不至于只剩图标。 */
  searchInput: { flex: "1 1 auto", minWidth: "160px" },
  /** 把时间档推到右边（搜索框与它之间那段空白）。 */
  filterSpacer: { flex: "1 1 auto" },
  // ── 磁盘占用视图（配置页里的一块） ─────────────────────────────────────
  usageBody: { display: "flex", flexDirection: "column", padding: "0 12px 12px", gap: "2px" },
  usageHeading: {
    color: "var(--dsw-alias-label-tertiary)",
    fontSize: "11px",
    marginTop: "8px",
    marginBottom: "2px"
  },
  /** 一条工作区横条：轨道 + 名字 + 数字。名字可以很长，所以它自己省略。 */
  usageBarRow: { display: "flex", alignItems: "center", gap: "8px", minWidth: 0 },
  usageBarTrack: {
    width: "70px",
    height: "6px",
    borderRadius: "3px",
    background: "var(--dsw-alias-interactive-bg-active)",
    flex: "0 0 auto",
    overflow: "hidden"
  },
  usageBarFill: { display: "block", height: "100%", background: "var(--dsw-alias-state-business-primary)" },
  usageBarName: {
    color: "var(--dsw-alias-label-primary)",
    fontSize: "12px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
    flex: "1 1 auto"
  },
  usageBarMeta: { color: "var(--dsw-alias-label-secondary)", fontSize: "11px", flex: "0 0 auto" },
  /** 榜单里的一行：与列表行同一套几何，只是没有勾选框。 */
  usageRow: { display: "flex", alignItems: "center", gap: "10px", padding: "6px 0", minWidth: 0 },
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
  /** 下拉锚点：文字 + 双向箭头图标，别被挤窄（长标签在按钮里折行是这个仓库踩过的坑）。 */
  dropdownAnchor: { flex: "0 0 auto" },
  dropdownButton: { flex: "0 0 auto", whiteSpace: "nowrap" },
  /** 保留策略那一格：档位下拉 + 自定义天数输入框。 */
  retentionDays: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end" },
  customDaysInput: { width: "88px", flex: "0 0 auto" },
  /** 天数非法时只把边框标红，不动尺寸（否则整行会跳一下）。 */
  customDaysInvalid: { borderColor: "var(--dsw-alias-state-error-primary)" },
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
  link: { color: "var(--dsw-alias-label-primary)", fontSize: "11px" },
  /**
   * 会话行 hover 卡片里我们那一节。卡片自己的 `hoverContent` 已经是纵向 flex 且有间距，
   * 这里只补一点点上边距，不加分隔线 —— 上面那行是官方画的相对时间。
   */
  hoverBlock: { display: "flex", flexDirection: "column", gap: "3px", marginTop: "2px", minWidth: 0 },
  hoverLine: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0 },
  hoverLabel: { color: "var(--dsw-alias-label-tertiary)", fontSize: "11px", flex: "0 0 auto" },
  hoverMeta: { color: "var(--dsw-alias-label-secondary)", fontSize: "11px", flex: "0 0 auto" },
  /** 原目录可能很长：让它自己省略，别把卡片撑宽。 */
  hoverPath: {
    color: "var(--dsw-alias-label-secondary)",
    fontSize: "11px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
    flex: "0 1 auto"
  },
  hoverBadges: { display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" },
  /** 状态胶囊：底色用带 alpha 的 `interactive-bg-active`（浅色主题里 layer 系列是同一个颜色）。 */
  hoverBadge: {
    color: "var(--dsw-alias-label-secondary)",
    fontSize: "10px",
    lineHeight: "16px",
    padding: "0 6px",
    borderRadius: "8px",
    background: "var(--dsw-alias-interactive-bg-active)",
    flex: "0 0 auto"
  },
  hoverBadgeDanger: {
    color: "var(--dsw-alias-state-error-primary)",
    fontSize: "10px",
    lineHeight: "16px",
    padding: "0 6px",
    borderRadius: "8px",
    background: "var(--dsw-alias-interactive-bg-active)",
    flex: "0 0 auto"
  },
  /**
   * 侧边栏会话行 hover 时那个「移入回收站」图标按钮（见
   * `components/trash-row-button.ts`）：16×16 的朴素按钮，**两种状态都没有底色**，
   * 只有前景色变深一档。
   *
   * `color-mix` 是 DSH 自己的产物里就在用的写法（例如 ui-deliverables 的
   * `color-mix(in srgb, var(--dsw-alias-interactive-bg-hover) 50%, transparent)`）。
   * 为什么不换 `state-error-secondary`：那个 token 在浅色主题里是 red-400，比 primary
   * （red-600）**更浅**，方向正好相反。
   */
  rowIconButton: { ...ROW_ICON_BUTTON, color: "var(--dsw-alias-state-error-primary)" },
  rowIconButtonHover: { ...ROW_ICON_BUTTON, color: "color-mix(in srgb, var(--dsw-alias-state-error-primary) 78%, #000)" }
};

// src/client/toast.ts
var toastStore = createStore(null);
var sequence = 0;
function showTrashUndo(ids, title) {
  if (ids.length === 0) return;
  sequence += 1;
  toastStore.set({ seq: sequence, ids: [...ids], title, error: null });
}
function showNotice(message) {
  if (message === "") return;
  sequence += 1;
  toastStore.set({ seq: sequence, ids: [], title: message, error: null });
}
function dismissToast() {
  toastStore.set(null);
}
function failToast(reason) {
  const current2 = toastStore.get();
  if (current2 === null) return;
  toastStore.set({ ...current2, error: reason });
}
async function undoTrash() {
  const current2 = toastStore.get();
  if (current2 === null || current2.error !== null) return;
  try {
    const value = await call("restore", { ids: current2.ids });
    const failure = firstFailure(value.results);
    if (failure !== null) {
      failToast(failure);
      return;
    }
    mutationStore.set(mutationStore.get() + 1);
    rememberSnapshot(value);
    dismissToast();
  } catch (thrown) {
    failToast(reportError(thrown));
  }
}

// src/client/components/dialog-host.ts
function DialogHost(props) {
  const t = props.t;
  const request = useStore(dialogStore);
  const [busy, setBusy] = React2.useState(false);
  const [ack, setAck] = React2.useState(false);
  const [error, setError] = React2.useState(null);
  const requestKey = request === null ? "" : `${request.kind}:${request.ids.join(",")}:${request.title}:${request.days ?? ""}`;
  React2.useEffect(() => {
    setAck(false);
    setError(null);
  }, [requestKey]);
  if (request === null) return null;
  const purgeOld = request.kind === "purge-old";
  const purge = request.kind === "purge" || purgeOld;
  const many = request.ids.length > 1;
  const days = request.days ?? 0;
  const title = purgeOld ? t("confirmPurgeOldTitle") : purge ? t("confirmPurgeTitle") : t("confirmTrashTitle");
  const body = purgeOld ? text(t, "confirmPurgeOldBody", { n: request.count ?? 0, days, size: formatBytes(request.bytes ?? 0) }) : purge ? many ? text(t, "confirmPurgeManyBody", { n: request.ids.length }) : text(t, "confirmPurgeBody", { title: request.title }) : text(t, "confirmTrashBody", { title: request.title });
  const close = () => {
    if (busy) return;
    dialogStore.set(null);
  };
  const confirm = async () => {
    setBusy(true);
    try {
      const endpoint = purgeOld ? "purge-older-than" : purge ? "purge" : "trash";
      const value = await call(endpoint, purgeOld ? { days } : { ids: request.ids });
      const failure = firstFailure(value.results);
      if (failure === null) {
        dialogStore.set(null);
        rememberSnapshot(value);
        mutationStore.set(mutationStore.get() + 1);
        if (!purge) showTrashUndo(request.ids, request.title);
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
        React2.createElement(
          import_dsh_client_ui_primitives.Button,
          {
            size: "md",
            variant: "primary",
            disabled: busy || purge && !ack,
            onClick: () => void confirm()
          },
          purge ? t("confirmPurgeAction") : t("confirmTrashAction")
        )
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
        purgeOld ? t("ackPurgeOld") : t("ackPurge")
      ),
      error ? React2.createElement("div", { style: S.error }, error) : null
    ) : error ? React2.createElement("div", { style: S.error }, error) : null
  );
}

// src/client/components/session-hover.ts
var React3 = __toESM(require("react"), 1);

// src/client/detail.ts
var TTL_MS = 3e4;
var cache = /* @__PURE__ */ new Map();
var inflight = /* @__PURE__ */ new Map();
var watching = false;
function forgetDetails() {
  cache.clear();
}
function watchMutations() {
  if (watching) return;
  watching = true;
  mutationStore.subscribe(forgetDetails);
}
async function describeSession(sessionId) {
  watchMutations();
  const cached = cache.get(sessionId);
  if (cached !== void 0 && Date.now() - cached.at < TTL_MS) return cached.value;
  const running = inflight.get(sessionId);
  if (running !== void 0) return running;
  const request = call("describe", { ids: [sessionId] }).then((value) => {
    cache.set(sessionId, { at: Date.now(), value });
    return value;
  }).finally(() => {
    inflight.delete(sessionId);
  });
  inflight.set(sessionId, request);
  return request;
}

// src/client/components/session-hover.ts
function SessionHover(props) {
  const t = props.t;
  const [detail, setDetail] = React3.useState(null);
  React3.useEffect(() => {
    let live = true;
    describeSession(props.sessionId).then(
      (value) => {
        if (live) setDetail(value);
      },
      () => {
      }
    );
    return () => {
      live = false;
    };
  }, [props.sessionId]);
  if (detail === null) return null;
  const badges = [];
  if (detail.trashed) badges.push({ key: "trashed", label: t("hoverTrashed"), danger: true });
  if (detail.archived) badges.push({ key: "archived", label: t("hoverArchived"), danger: false });
  if (detail.pinned) badges.push({ key: "pinned", label: t("hoverPinned"), danger: false });
  const lines = [
    React3.createElement(
      "div",
      { key: "stats", style: S.hoverLine },
      React3.createElement("span", { style: S.hoverMeta }, text(t, "hoverStats", { size: formatBytes(detail.bytes), n: detail.files }))
    )
  ];
  if (detail.cwd) {
    lines.push(
      React3.createElement(
        "div",
        { key: "cwd", style: S.hoverLine },
        React3.createElement("span", { style: S.hoverLabel }, t("hoverCwd")),
        React3.createElement("span", { style: S.hoverPath, title: detail.cwd }, detail.cwd)
      )
    );
  }
  if (detail.trashed && detail.deletedAt) {
    lines.push(
      React3.createElement(
        "div",
        { key: "deletedAt", style: S.hoverLine },
        React3.createElement("span", { style: S.hoverLabel }, t("hoverDeleted")),
        React3.createElement("span", { style: S.hoverMeta }, formatTime(detail.deletedAt))
      )
    );
  }
  if (badges.length > 0) {
    lines.push(
      React3.createElement(
        "div",
        { key: "badges", style: S.hoverBadges },
        badges.map(
          (badge) => React3.createElement(
            "span",
            {
              key: badge.key,
              style: badge.danger ? S.hoverBadgeDanger : S.hoverBadge
            },
            badge.label
          )
        )
      )
    );
  }
  return React3.createElement("div", { style: S.hoverBlock }, lines);
}

// src/client/components/settings-panel.ts
var React8 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives6 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/export.ts
function openSessionPath(sessionId, reveal) {
  return call("open", reveal === true ? { ids: [sessionId], target: "reveal" } : { ids: [sessionId], target: "path" });
}
async function copyText(value) {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard !== void 0 && typeof clipboard.writeText === "function") {
    try {
      await clipboard.writeText(value);
      return true;
    } catch {
    }
  }
  try {
    const document = globalThis.document;
    if (document === void 0) return false;
    const area = document.createElement("textarea");
    area.value = value;
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

// src/client/groups.ts
function workspaceSummaries(archived, pinned, trashed) {
  const summaries = /* @__PURE__ */ new Map();
  const bucketOf = (key) => {
    let summary = summaries.get(key);
    if (summary === void 0) {
      summary = { key, archivableIds: [], trashableIds: [], activeIds: [] };
      summaries.set(key, summary);
    }
    return summary;
  };
  for (const rows of [archived, pinned]) {
    for (const row of rows) {
      const summary = bucketOf(groupKeyOf(row));
      summary.archivableIds.push(row.sessionId);
      summary.trashableIds.push(row.sessionId);
      if (row.active === true) summary.activeIds.push(row.sessionId);
    }
  }
  for (const row of trashed) bucketOf(groupKeyOf(row));
  return summaries;
}
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
  const descending = (pick) => (left, right) => {
    const a = pick(left);
    const b = pick(right);
    const hasA = typeof a === "number" && Number.isFinite(a) && a > 0;
    const hasB = typeof b === "number" && Number.isFinite(b) && b > 0;
    if (!hasA && !hasB) return 0;
    if (!hasA) return 1;
    if (!hasB) return -1;
    return b - a;
  };
  if (order === "title") {
    return [...rows].sort((left, right) => String(left.title ?? "").localeCompare(String(right.title ?? "")));
  }
  if (order === "bytes") {
    return [...rows].sort((left, right) => (right.bytes ?? 0) - (left.bytes ?? 0));
  }
  if (order === "createdAt") return [...rows].sort(descending((row) => row.createdAt));
  if (order === "deletedAt") return [...rows].sort(descending((row) => row.deletedAt));
  return rows;
}
var RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1e3;
function isTrashRow(row) {
  return typeof row.deletedAt === "number";
}
function matchesSearch(row, search) {
  const needle = search.trim().toLowerCase();
  if (needle === "") return true;
  const haystacks = [row.title, row.cwd, row.workspaceTitle];
  return haystacks.some((value) => typeof value === "string" && value.toLowerCase().includes(needle));
}
function timeStampOf(row) {
  if (isTrashRow(row)) return typeof row.deletedAt === "number" && row.deletedAt > 0 ? row.deletedAt : null;
  if (typeof row.createdAt === "number" && row.createdAt > 0) return row.createdAt;
  return null;
}
function matchesFilter(row, filter) {
  if (!matchesSearch(row, filter.search)) return false;
  if (filter.timeFilter !== "recent") return true;
  const stamp = timeStampOf(row);
  if (stamp === null) return false;
  return (filter.now ?? Date.now()) - stamp <= RECENT_WINDOW_MS;
}
function filterRows(rows, filter) {
  if (filter.search.trim() === "" && filter.timeFilter === "all") return rows;
  return rows.filter((row) => matchesFilter(row, filter));
}
function isFilterActive(filter) {
  return filter.search.trim() !== "" || filter.timeFilter !== "all";
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
var TRASH_RETENTION_DAYS = [7, 30, 90];
var DEFAULT_TRASH_DAYS = 30;
var TRASH_DAYS_MIN = 1;
var TRASH_DAYS_MAX = 3650;
function parseCustomDays(raw) {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < TRASH_DAYS_MIN || value > TRASH_DAYS_MAX) return null;
  return value;
}
function effectiveTrashDays(settings) {
  return parseCustomDays(settings.trashDaysCustom) ?? settings.trashDays;
}
var DEFAULT_SETTINGS = {
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
var SEARCH_MAX_LENGTH = 200;
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
    pick(
      "order",
      (value) => value === "host" || value === "title" || value === "bytes" || value === "createdAt" || value === "deletedAt" ? value : void 0
    );
    pick("autoUpdate", (value) => typeof value === "boolean" ? value : void 0);
    pick("search", (value) => typeof value === "string" ? value.slice(0, SEARCH_MAX_LENGTH) : void 0);
    pick("timeFilter", (value) => value === "all" || value === "recent" ? value : void 0);
    pick("trashDays", (value) => typeof value === "number" && TRASH_RETENTION_DAYS.includes(value) ? value : void 0);
    pick("trashDaysCustom", (value) => typeof value === "string" ? value.slice(0, 8) : void 0);
    return next;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
var settingsStore = createStore(readSettings());
function updateSettings(patch) {
  const next = { ...settingsStore.get(), ...patch };
  if (typeof next.search === "string" && next.search.length > SEARCH_MAX_LENGTH) next.search = next.search.slice(0, SEARCH_MAX_LENGTH);
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

// src/client/components/dropdown.ts
var React4 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");
function Dropdown(props) {
  const current2 = props.options.find((option) => option.value === props.value);
  const display = props.display ?? (current2 === void 0 ? String(props.value) : current2.label);
  const optionId = (value) => `${props.id}-${String(value)}`;
  return React4.createElement(import_dsh_client_ui_primitives2.Menu, {
    open: props.open,
    portal: true,
    side: "bottom",
    align: props.align ?? "end",
    items: props.options.map((option) => ({
      id: optionId(option.value),
      label: option.label,
      disabled: option.disabled === true
    })),
    // 命中当前档位时由 `Menu` 在行**尾**画对勾 —— 这是数据行选中态的唯一来源。
    selectedId: optionId(props.value),
    onSelect: (id) => {
      props.onToggle(false);
      const picked = props.options.find((option) => optionId(option.value) === id);
      if (picked !== void 0 && picked.value !== props.value) props.onChange(picked.value);
    },
    onClose: () => props.onToggle(false),
    className: S.dropdownAnchor,
    anchor: React4.createElement(
      import_dsh_client_ui_primitives2.Button,
      {
        size: "sm",
        variant: "outline",
        disabled: props.disabled === true,
        style: S.dropdownButton,
        "aria-label": props.label,
        "aria-haspopup": "menu",
        "aria-expanded": props.open,
        icon: React4.createElement(import_dsh_client_ui_primitives2.IconChevronsUpDownOutlineRegular, { size: 14 }),
        onClick: () => props.onToggle(!props.open)
      },
      display
    )
  });
}

// src/client/components/group-header.ts
var React5 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");
function GroupHeader(props) {
  const group = props.group;
  const t = props.t;
  const total = group.rows.length;
  const allSelected = total > 0 && group.rows.every((row) => props.selected.includes(row.sessionId));
  const action = allSelected ? t("clearShort") : t("selectAllShort");
  const workspaceActions = props.workspaceActions ?? [];
  return React5.createElement(
    "div",
    { style: props.first ? { ...S.groupHead, borderTop: "none" } : S.groupHead },
    React5.createElement(
      "button",
      {
        type: "button",
        style: S.groupToggle,
        title: props.collapsed ? t("expand") : t("collapse"),
        onClick: () => props.onToggleCollapse()
      },
      React5.createElement(
        "span",
        { style: S.groupCaret },
        props.collapsed ? React5.createElement(import_dsh_client_ui_primitives3.IconChevronRightOutlineRegular, { size: 12 }) : React5.createElement(import_dsh_client_ui_primitives3.IconChevronDownOutlineRegular, { size: 12 })
      ),
      React5.createElement(
        "span",
        { style: S.groupIcon },
        props.collapsed ? React5.createElement(import_dsh_client_ui_primitives3.IconFolderCloseRegular, { size: 14 }) : React5.createElement(import_dsh_client_ui_primitives3.IconFolderOpenRegular, { size: 14 })
      ),
      React5.createElement("span", { style: S.groupTitle, title: group.cwd || group.title }, group.title),
      React5.createElement("span", { style: S.groupMeta }, text(t, "sessions", { n: total })),
      group.bytes > 0 ? React5.createElement("span", { style: S.groupMeta }, formatBytes(group.bytes)) : null,
      group.cwd !== null ? React5.createElement("span", { style: { ...S.groupPath, ...S.mono }, title: group.cwd }, group.cwd) : null
    ),
    // 工作区动作：先勾选（本页签），再「⋯」（跨页签）。两个都不参与 flex 收缩，
    // 长路径挤的只能是左边的折叠按钮（见 styles.ts 的 groupAction）。
    React5.createElement(
      import_dsh_client_ui_primitives3.Button,
      {
        size: "sm",
        variant: "ghost",
        disabled: props.busy,
        style: S.groupAction,
        title: `${group.title} — ${allSelected ? t("clearGroup") : t("selectGroup")}`,
        onClick: () => props.onToggleGroup()
      },
      action
    ),
    workspaceActions.length === 0 ? null : React5.createElement(import_dsh_client_ui_primitives3.Menu, {
      open: props.workspaceMenuOpen === true,
      portal: true,
      side: "bottom",
      align: "end",
      closeOnPointerLeave: true,
      items: workspaceActions,
      onSelect: (id) => props.onRunWorkspaceAction?.(id),
      onClose: () => props.onCloseWorkspaceMenu?.(),
      anchor: React5.createElement(import_dsh_client_ui_primitives3.Button, {
        size: "sm",
        variant: "ghost",
        disabled: props.busy,
        style: S.rowMenuButton,
        icon: React5.createElement(import_dsh_client_ui_primitives3.IconEllipsisOutlineRegular, {}),
        "aria-label": `${group.title} — ${t("workspaceActions")}`,
        onClick: () => props.onToggleWorkspaceMenu?.()
      })
    })
  );
}
function workspaceActionsOf(t, summary) {
  return [
    {
      id: "archive",
      label: t("archiveWorkspace"),
      icon: React5.createElement(import_dsh_client_ui_primitives3.IconArchiveOutlineRegular, { size: 14 }),
      // 全都归档过了就没什么可归档的；有会话正在跑时也不给点（归档会先停掉它的工作）。
      disabled: summary.archivableIds.length === 0 || summary.activeIds.length > 0
    },
    {
      id: "trash",
      label: t("trashWorkspace"),
      icon: React5.createElement(import_dsh_client_ui_primitives3.IconTrashOutlineRegular, { size: 14 }),
      danger: true,
      disabled: summary.trashableIds.length === 0 || summary.activeIds.length > 0
    }
  ];
}

// src/client/components/session-row.ts
var React6 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives4 = require("@deepseek-ai/dsh-client-ui-primitives");
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
  const running = row.active === true;
  return React6.createElement(
    "div",
    { style: props.first ? { ...S.item, borderTop: "none" } : S.item },
    React6.createElement("input", {
      type: "checkbox",
      checked: props.checked,
      disabled: props.busy,
      "aria-label": row.title,
      onChange: () => props.onToggle()
    }),
    React6.createElement(
      "div",
      { style: S.itemMain },
      React6.createElement(
        "div",
        { style: S.itemTitleRow },
        React6.createElement("div", { style: S.itemTitle, title: row.title }, row.title),
        // 胶囊：`flex: 0 0 auto`，所以长标题只会挤标题那一段（它有 minWidth: 0 + 省略号）。
        running ? React6.createElement("span", { style: S.badgeRunning, title: t("runningHint") }, t("running")) : null
      ),
      React6.createElement("div", { style: S.itemMeta, title: row.cwd || "" }, meta.join(" · "))
    ),
    React6.createElement(
      "div",
      { style: S.itemActions },
      React6.createElement(import_dsh_client_ui_primitives4.Menu, {
        open: props.menuOpen,
        portal: true,
        side: "bottom",
        align: "end",
        closeOnPointerLeave: true,
        items: menu.items,
        onSelect: (id) => menu.run(id),
        onClose: () => props.onCloseMenu(),
        anchor: React6.createElement(import_dsh_client_ui_primitives4.Button, {
          size: "sm",
          variant: "ghost",
          disabled: props.busy,
          style: S.rowMenuButton,
          icon: React6.createElement(import_dsh_client_ui_primitives4.IconEllipsisOutlineRegular, {}),
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

// src/client/components/usage-panel.ts
var React7 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives5 = require("@deepseek-ai/dsh-client-ui-primitives");
function usageRow(t, row, busy, onArchive, onUnarchive) {
  const badges = [];
  if (row.trashed) badges.push({ key: "trashed", label: t("usageTrashed"), style: S.badgeDanger });
  else if (row.archived) badges.push({ key: "archived", label: t("usageArchived"), style: S.badge });
  else if (row.pinned) badges.push({ key: "pinned", label: t("usagePinned"), style: S.badge });
  if (row.active) badges.push({ key: "running", label: t("running"), style: S.badgeRunning });
  const action = row.trashed ? null : row.archived ? { label: t("usageUnarchive"), run: () => onUnarchive(row.sessionId) } : row.active ? null : { label: t("usageArchive"), run: () => onArchive(row.sessionId) };
  const when = row.deletedAt !== null ? formatTime(row.deletedAt) : formatTime(row.createdAt);
  return React7.createElement(
    "div",
    { key: row.sessionId, style: S.usageRow },
    React7.createElement(
      "div",
      { style: S.itemMain },
      React7.createElement(
        "div",
        { style: S.itemTitleRow },
        React7.createElement("div", { style: S.itemTitle, title: row.title }, row.title),
        badges.map((badge) => React7.createElement("span", { key: badge.key, style: badge.style }, badge.label))
      ),
      React7.createElement(
        "div",
        { style: S.itemMeta, title: row.cwd || "" },
        [formatBytes(row.bytes), text(t, "files", { n: row.files }), row.workspaceTitle ?? row.cwd ?? t("noProject"), when].filter((part) => part !== "").join(" · ")
      )
    ),
    React7.createElement(
      "div",
      { style: S.itemActions },
      action === null ? null : React7.createElement(
        import_dsh_client_ui_primitives5.Button,
        {
          size: "sm",
          variant: "outline",
          disabled: busy,
          onClick: action.run
        },
        action.label
      )
    )
  );
}
function UsagePanel(props) {
  const t = props.t;
  const usage = props.usage;
  const maxBytes = usage === null || usage.groups.length === 0 ? 0 : Math.max(...usage.groups.map((group) => group.bytes), 1);
  return React7.createElement(
    "div",
    { style: S.card },
    React7.createElement(
      "div",
      { style: { ...S.configRow, borderTop: "none" } },
      React7.createElement(
        "div",
        { style: S.configMain },
        React7.createElement("span", { style: S.configLabel }, t("usageTitle")),
        React7.createElement(
          "span",
          { style: S.configHint },
          props.loading ? t("usageLoading") : usage === null ? props.error ?? "" : text(t, "usageTotal", {
            n: usage.totalSessions,
            size: formatBytes(usage.totalBytes),
            disk: usage.onDiskSessions
          })
        )
      )
    ),
    usage === null || usage.totalSessions === 0 ? React7.createElement("div", { style: S.empty }, props.loading ? t("usageLoading") : t("usageNoData")) : React7.createElement(
      "div",
      { style: S.usageBody },
      // 按工作区：横条 + 名字 + 体积 / 条数。
      React7.createElement("span", { style: S.usageHeading }, t("usageByWorkspace")),
      usage.groups.map(
        (group) => React7.createElement(
          "div",
          { key: group.key, style: S.usageBarRow },
          React7.createElement(
            "span",
            { style: S.usageBarTrack },
            React7.createElement("span", {
              style: {
                ...S.usageBarFill,
                // 占比：按最大组归一，所以最小的组也看得见（下限 2%）。
                width: `${Math.max(2, Math.round(group.bytes / maxBytes * 100))}%`
              }
            })
          ),
          React7.createElement(
            "span",
            { style: S.usageBarName, title: group.key },
            group.title === "" ? t("noProject") : group.title
          ),
          React7.createElement(
            "span",
            { style: S.usageBarMeta },
            `${formatBytes(group.bytes)} · ${text(t, "sessions", { n: group.count })}`
          )
        )
      ),
      React7.createElement("span", { style: S.usageHeading }, t("usageLargest")),
      usage.largest.map((row) => usageRow(t, row, props.busy, props.onArchive, props.onUnarchive)),
      React7.createElement("span", { style: S.usageHeading }, t("usageOldest")),
      usage.oldest.map((row) => usageRow(t, row, props.busy, props.onArchive, props.onUnarchive))
    )
  );
}

// src/client/components/settings-panel.ts
function SessionManagerPanel(props) {
  const t = props.t;
  const settings = useStore(settingsStore);
  const [tab, setTab] = React8.useState(settings.tab);
  const [snapshot, setSnapshot] = React8.useState(cachedSnapshot);
  const [error, setError] = React8.useState(null);
  const [loading, setLoading] = React8.useState(true);
  const [busy, setBusy] = React8.useState(false);
  const [selected, setSelected] = React8.useState([]);
  const [collapsedOverrides, setCollapsedOverrides] = React8.useState({});
  const [menuFor, setMenuFor] = React8.useState(null);
  const [workspaceMenuFor, setWorkspaceMenuFor] = React8.useState(null);
  const [trashStats, setTrashStats] = React8.useState(null);
  const [trashStatsError, setTrashStatsError] = React8.useState(null);
  const [trashStatsBusy, setTrashStatsBusy] = React8.useState(false);
  const [usage, setUsage] = React8.useState(null);
  const [usageError, setUsageError] = React8.useState(null);
  const [usageBusy, setUsageBusy] = React8.useState(false);
  const [usageReload, setUsageReload] = React8.useState(0);
  const [openDropdown, setOpenDropdown] = React8.useState(null);
  const grouping = useStore(groupingStore);
  const revision = useStore(mutationStore);
  const update = useStore(updateStore);
  const [sidebarArchived, setSidebarArchived] = React8.useState(readSidebarArchived);
  const [sidebarAtMount] = React8.useState(readSidebarArchived);
  const applyResult = (value) => {
    if (value && value.archived) {
      rememberSnapshot(value);
      setSnapshot(value);
    }
  };
  const refresh = React8.useCallback(async () => {
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
  React8.useEffect(() => {
    void refresh();
  }, [refresh, revision]);
  React8.useEffect(() => {
    if (tab !== "config" || !settings.autoUpdate || update.state !== "idle") return;
    void checkUpdate(false);
  }, [tab, settings.autoUpdate, update.state]);
  React8.useEffect(() => {
    setSelected([]);
    setMenuFor(null);
    setWorkspaceMenuFor(null);
  }, [tab]);
  const retentionDays = effectiveTrashDays(settings);
  React8.useEffect(() => {
    if (tab !== "config") return;
    let cancelled = false;
    setTrashStatsBusy(true);
    setTrashStatsError(null);
    void call("trash-stats", { days: retentionDays }).then((value) => {
      if (!cancelled) setTrashStats(value);
    }).catch((failure) => {
      if (!cancelled) {
        setTrashStats(null);
        setTrashStatsError(reportError(failure));
      }
    }).finally(() => {
      if (!cancelled) setTrashStatsBusy(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, retentionDays]);
  React8.useEffect(() => {
    if (tab !== "usage") return;
    let cancelled = false;
    setUsageBusy(true);
    setUsageError(null);
    void call("usage", {}).then((value) => {
      if (!cancelled) setUsage(value);
    }).catch((failure) => {
      if (!cancelled) {
        setUsage(null);
        setUsageError(reportError(failure));
      }
    }).finally(() => {
      if (!cancelled) setUsageBusy(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, revision, usageReload]);
  const refreshUsage = () => setUsageReload((current2) => current2 + 1);
  const runUsageAction = (endpoint, sessionId) => {
    void run(endpoint, [sessionId]).then(() => refreshUsage());
  };
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
  const filter = React8.useMemo(
    () => ({ search: settings.search, timeFilter: settings.timeFilter }),
    [settings.search, settings.timeFilter]
  );
  const filtered = React8.useMemo(() => filterRows(rows, filter), [rows, filter]);
  const filtering = isFilterActive(filter);
  const selectedRows = rows.filter((row) => selected.includes(row.sessionId));
  const groups = grouping ? groupRows(filtered, t) : [];
  const blockOf = (group) => {
    const key = collapseKey(tab, group.key);
    return { key, group, rows: isGroupCollapsed(key, collapsedOverrides, settings.groupDefault) ? [] : group.rows };
  };
  const blocks = grouping ? groups.map(blockOf) : [{ key: `${tab}:flat`, group: null, rows: filtered }];
  const tabs = [
    { id: "archived", label: t(TAB_LABEL.archived), count: archived.length },
    { id: "pinned", label: t(TAB_LABEL.pinned), count: pinned.length },
    { id: "trash", label: t(TAB_LABEL.trash), count: trashed.length },
    { id: "usage", label: t("titleUsage"), count: 0 },
    { id: "config", label: t("titleConfig"), count: 0 }
  ];
  const orderOptions = [
    { value: "host", label: t("orderHost") },
    { value: "title", label: t("orderTitle") },
    { value: "bytes", label: t("orderBytes") },
    { value: "createdAt", label: t("orderCreatedAt") },
    { value: "deletedAt", label: t("orderDeletedAt") }
  ];
  const customDays = settings.trashDaysCustom;
  const customDaysValid = customDays.trim() === "" || parseCustomDays(customDays) !== null;
  const retentionOptions = TRASH_RETENTION_DAYS.map((days) => ({ value: days, label: text(t, "retentionDays", { n: days }) }));
  const summaries = React8.useMemo(() => workspaceSummaries(archived, pinned, trashed), [archived, pinned, trashed]);
  const copyRowPath = async (sessionId) => {
    try {
      const value = await openSessionPath(sessionId);
      const copied = await copyText(value.path);
      showNotice(copied ? text(t, "pathCopied", { path: value.path }) : text(t, "pathCopyFailed", { path: value.path }));
    } catch (failure) {
      showNotice(reportError(failure));
    }
  };
  const revealRow = async (sessionId) => {
    try {
      const value = await openSessionPath(sessionId, true);
      if (!value.revealed) {
        await copyText(value.path);
        showNotice(text(t, "revealFailed", { reason: value.reason ?? "?", path: value.path }));
      }
    } catch (failure) {
      showNotice(reportError(failure));
    }
  };
  const rowMenu = (row) => {
    const running = row.active === true;
    const moveToTrash = {
      id: "trash",
      label: t("moveToTrash"),
      icon: React8.createElement(import_dsh_client_ui_primitives6.IconTrashOutlineRegular, { size: 14 }),
      danger: true,
      disabled: running
    };
    const locate = [
      { id: "copy-path", label: t("copyPath"), icon: React8.createElement(import_dsh_client_ui_primitives6.IconCopyOutlineRegular, { size: 14 }) },
      { id: "reveal", label: t("revealInFolder"), icon: React8.createElement(import_dsh_client_ui_primitives6.IconFolderOpenRegular, { size: 14 }) }
    ];
    const handleLocate = (id) => {
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
          { id: "unarchive", label: t("unarchive"), icon: React8.createElement(import_dsh_client_ui_primitives6.IconUnarchiveOutlineRegular, { size: 14 }) },
          { id: "pin", label: t("pin"), icon: React8.createElement(import_dsh_client_ui_primitives6.IconPinOutlineRegular, { size: 14 }) },
          moveToTrash,
          ...locate
        ],
        run: (id) => {
          setMenuFor(null);
          if (handleLocate(id)) return;
          if (id === "trash") requestTrash([row.sessionId], row.title);
          else void run(id, [row.sessionId]);
        }
      };
    }
    if (tab === "pinned") {
      return {
        items: [
          { id: "unpin", label: t("unpin"), icon: React8.createElement(import_dsh_client_ui_primitives6.IconPinOutlineRegular, { size: 14 }) },
          moveToTrash,
          ...locate
        ],
        run: (id) => {
          setMenuFor(null);
          if (handleLocate(id)) return;
          if (id === "trash") requestTrash([row.sessionId], row.title);
          else void run(id, [row.sessionId]);
        }
      };
    }
    const restorable = row.restorable !== false;
    return {
      items: [
        {
          id: "restore",
          label: t(restorable ? "restore" : "restoreUnavailable"),
          icon: React8.createElement(import_dsh_client_ui_primitives6.IconRefreshOutlineRegular, { size: 14 }),
          disabled: !restorable
        },
        { id: "purge", label: t("purge"), icon: React8.createElement(import_dsh_client_ui_primitives6.IconTrashOutlineRegular, { size: 14 }), danger: true },
        ...locate
      ],
      run: (id) => {
        setMenuFor(null);
        if (handleLocate(id)) return;
        if (id === "restore" && !restorable) return;
        if (id === "purge") requestPurge([row.sessionId], row.title);
        else void run(id, [row.sessionId]);
      }
    };
  };
  const runWorkspaceAction = (group, id) => {
    setWorkspaceMenuFor(null);
    const summary = summaries.get(group.key);
    if (summary === void 0) return;
    if (id === "archive") void run("archive", summary.archivableIds);
    if (id === "trash") requestTrash(summary.trashableIds, group.title);
  };
  const batch = [];
  if (tab === "archived" && selected.length > 0) {
    batch.push({ label: t("unarchive"), run: () => void run("unarchive", selected) });
    batch.push({
      label: t("moveToTrash"),
      variant: "outline",
      run: () => requestTrash(selected, selectedRows[0] ? selectedRows[0].title : "")
    });
  }
  if (tab === "pinned" && selected.length > 0) {
    batch.push({ label: t("unpin"), run: () => void run("unpin", selected) });
    batch.push({
      label: t("moveToTrash"),
      variant: "outline",
      run: () => requestTrash(selected, selectedRows[0] ? selectedRows[0].title : "")
    });
  }
  if (tab === "trash" && selected.length > 0) {
    const canRestore = selectedRows.some((row) => row.restorable !== false);
    batch.push({ label: t("restore"), disabled: !canRestore, run: () => void run("restore", selected) });
    batch.push({
      label: t("purge"),
      variant: "outline",
      run: () => requestPurge(selected, selectedRows[0] ? selectedRows[0].title : "")
    });
  }
  const totals = snapshot ? snapshot.totals : null;
  const totalBytes = tab === "archived" ? totals ? totals.archivedBytes : 0 : tab === "trash" ? totals ? totals.trashBytes : 0 : 0;
  const nodes = [];
  let first = true;
  for (const block of blocks) {
    if (block.group !== null) {
      const group = block.group;
      const key = block.key;
      const summary = summaries.get(group.key);
      nodes.push(
        React8.createElement(GroupHeader, {
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
          // "未知目录"那一组也有 key，但它的目标集合可能只含回收站条目 ——
          // `workspaceActionsOf` 会把两项都置 `disabled`，菜单仍然画得出来（不是坏形状）。
          workspaceActions: summary === void 0 ? [] : workspaceActionsOf(t, summary),
          workspaceMenuOpen: workspaceMenuFor === group.key,
          onToggleWorkspaceMenu: () => setWorkspaceMenuFor(workspaceMenuFor === group.key ? null : group.key),
          onCloseWorkspaceMenu: () => setWorkspaceMenuFor(null),
          onRunWorkspaceAction: (id) => runWorkspaceAction(group, id)
        })
      );
      first = false;
    }
    for (const row of block.rows) {
      nodes.push(
        React8.createElement(SessionRow, {
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
        })
      );
      first = false;
    }
  }
  const isConfig = tab === "config";
  const isUsage = tab === "usage";
  const isDataTab = !isConfig && !isUsage;
  const configRow = (key, label, hint, control, firstRow) => React8.createElement(
    "div",
    { key, style: firstRow ? { ...S.configRow, borderTop: "none" } : S.configRow },
    React8.createElement(
      "div",
      { style: S.configMain },
      React8.createElement("span", { style: S.configLabel }, label),
      hint === null ? null : React8.createElement("span", { style: S.configHint }, hint)
    ),
    React8.createElement("div", { style: S.configControl }, control)
  );
  const retentionCount = trashStats === null ? 0 : trashStats.count;
  const retentionBytes = trashStats === null ? 0 : trashStats.bytes;
  const retentionFoot = React8.createElement(
    "div",
    { key: "config:trash-preview", style: S.configFoot },
    trashStatsBusy ? React8.createElement("span", { style: S.configHint }, t("trashPreviewLoading")) : trashStatsError !== null ? React8.createElement("span", { style: S.error }, trashStatsError) : React8.createElement(
      "span",
      { style: S.configHint },
      retentionCount > 0 ? text(t, "trashPreview", { n: retentionCount, size: formatBytes(retentionBytes) }) : text(t, "trashPreviewNone", { days: retentionDays })
    ),
    React8.createElement(
      import_dsh_client_ui_primitives6.Button,
      {
        size: "sm",
        variant: "outline",
        // 自定义天数非法时不给点：这时候 `retentionDays` 回落到档位，点下去删的和看到的
        // 那行数字对不上（虽然那行也是按档位算的，但用户以为自己填的数生效了）。
        disabled: busy || trashStatsBusy || retentionCount === 0 || !customDaysValid,
        onClick: () => requestPurgeOld(retentionDays, retentionCount, retentionBytes)
      },
      text(t, "trashCleanup", { n: retentionDays })
    )
  );
  const filterBar = React8.createElement(
    "div",
    { style: S.filterBar },
    React8.createElement(import_dsh_client_ui_primitives6.Input, {
      value: settings.search,
      placeholder: t("searchPlaceholder"),
      "aria-label": t("searchLabel"),
      icon: React8.createElement(import_dsh_client_ui_primitives6.IconSearchOutlineRegular, {}),
      style: S.searchInput,
      onChange: (event) => void updateSettings({ search: event.target.value })
    }),
    filtering ? React8.createElement(
      import_dsh_client_ui_primitives6.Button,
      {
        size: "sm",
        variant: "ghost",
        onClick: () => void updateSettings({ search: "", timeFilter: "all" })
      },
      t("searchClear")
    ) : null,
    React8.createElement("div", { style: S.filterSpacer }),
    React8.createElement(import_dsh_client_ui_primitives6.SegmentedControl, {
      id: "session-curator-time-filter",
      value: settings.timeFilter,
      options: [
        { value: "all", label: t("timeAll") },
        { value: "recent", label: t("timeRecent") }
      ],
      label: t("timeFilterLabel"),
      onChange: (next) => void updateSettings({ timeFilter: next })
    })
  );
  const version = snapshot !== null && typeof snapshot.version === "string" ? snapshot.version : update.value !== null && typeof update.value.current === "string" ? update.value.current : null;
  const outdated = update.state === "done" && update.value !== null && update.value.outdated === true;
  const updateLine = update.state === "checking" ? React8.createElement("span", { style: S.configHint }, t("updateChecking")) : update.state === "failed" ? React8.createElement(
    "span",
    { style: S.error },
    text(t, "updateFailed", { reason: update.error === null ? "?" : update.error })
  ) : update.value !== null && typeof update.value.error === "string" ? React8.createElement("span", { style: S.configHint }, text(t, "updateFailed", { reason: update.value.error })) : update.state === "done" && !outdated ? React8.createElement("span", { style: S.configHint }, t("updateLatest")) : null;
  const configPage = React8.createElement(
    "div",
    { style: S.column },
    React8.createElement(
      "div",
      { style: S.card },
      configRow(
        "config:tab",
        t("configTab"),
        t("configTabHint"),
        React8.createElement(import_dsh_client_ui_primitives6.SegmentedControl, {
          id: "session-curator-default-tab",
          value: settings.tab,
          options: [
            { value: "archived", label: t(TAB_LABEL.archived) },
            { value: "pinned", label: t(TAB_LABEL.pinned) },
            { value: "trash", label: t(TAB_LABEL.trash) }
          ],
          label: t("configTab"),
          onChange: (next) => void updateSettings({ tab: next })
        }),
        true
      ),
      configRow(
        "config:grouping",
        t("configGrouping"),
        t("configGroupingHint"),
        React8.createElement(import_dsh_client_ui_primitives6.Switch, {
          checked: settings.grouping,
          label: t("configGrouping"),
          onChange: (next) => {
            updateSettings({ grouping: next });
            groupingStore.set(next);
          }
        })
      ),
      configRow(
        "config:group-default",
        t("configGroupDefault"),
        t("configGroupDefaultHint"),
        React8.createElement(import_dsh_client_ui_primitives6.SegmentedControl, {
          id: "session-curator-group-default",
          value: settings.groupDefault,
          options: [
            { value: "expanded", label: t("groupExpanded") },
            { value: "collapsed", label: t("groupCollapsed") }
          ],
          label: t("configGroupDefault"),
          onChange: (next) => void updateSettings({ groupDefault: next })
        })
      ),
      configRow(
        "config:sidebar-archived",
        t("configSidebarArchived"),
        t("configSidebarArchivedHint"),
        React8.createElement(import_dsh_client_ui_primitives6.Switch, {
          checked: sidebarArchived !== "default",
          label: t("configSidebarArchived"),
          onChange: (next) => {
            writeSidebarArchived(next);
            setSidebarArchived(next ? "show" : "default");
          }
        })
      ),
      // 官方 store 只在创建时读一次 localStorage，所以改完必须刷新页面。
      sidebarArchived === sidebarAtMount ? null : React8.createElement(
        "div",
        { key: "config:sidebar-refresh", style: S.configFoot },
        React8.createElement("span", { style: S.configHint }, t("configSidebarRefreshHint")),
        React8.createElement(
          import_dsh_client_ui_primitives6.Button,
          {
            size: "sm",
            variant: "outline",
            onClick: () => {
              try {
                globalThis.location.reload();
              } catch {
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
        React8.createElement(import_dsh_client_ui_primitives6.Switch, {
          checked: settings.showMeta,
          label: t("configMeta"),
          onChange: (next) => void updateSettings({ showMeta: next })
        })
      ),
      // 排序：5 档，所以是下拉（`Dropdown` 见 components/dropdown.ts）。
      configRow(
        "config:order",
        t("configOrder"),
        t("configOrderHint"),
        React8.createElement(Dropdown, {
          id: "session-curator-order",
          value: settings.order,
          options: orderOptions,
          label: t("configOrder"),
          open: openDropdown === "order",
          onToggle: (next) => setOpenDropdown(next ? "order" : null),
          onChange: (next) => void updateSettings({ order: next })
        })
      ),
      // ── 回收站保留策略 ──────────────────────────────────────────────
      // 这条**故意不做成自动清理**：它是本插件唯一不可撤销的动作。这里只让用户选一个
      // 天数（档位或自定义）并看到预览，真正的删除必须再点一次、再过一道确认弹窗（`purge-old`）。
      configRow(
        "config:trash-days",
        t("configTrashDays"),
        t("configTrashDaysHint"),
        React8.createElement(
          "div",
          { style: S.retentionDays },
          React8.createElement(Dropdown, {
            id: "session-curator-trash-days",
            value: settings.trashDays,
            options: retentionOptions,
            label: t("configTrashDays"),
            // 填了自定义天数时锚点显示"自定义"，否则显示档位 —— 让"现在到底按哪个算"一眼可见。
            display: customDaysValid && customDays.trim() !== "" ? t("retentionCustom") : void 0,
            open: openDropdown === "trash-days",
            onToggle: (next) => setOpenDropdown(next ? "trash-days" : null),
            onChange: (next) => void updateSettings({ trashDays: next, trashDaysCustom: "" })
          }),
          React8.createElement(import_dsh_client_ui_primitives6.Input, {
            value: customDays,
            placeholder: t("customDaysPlaceholder"),
            "aria-label": t("customDaysLabel"),
            "aria-invalid": !customDaysValid,
            title: text(t, "customDaysHint", { min: TRASH_DAYS_MIN, max: TRASH_DAYS_MAX }),
            style: customDaysValid ? S.customDaysInput : { ...S.customDaysInput, ...S.customDaysInvalid },
            onChange: (event) => void updateSettings({ trashDaysCustom: event.target.value })
          })
        )
      ),
      retentionFoot,
      configRow(
        "config:auto",
        t("configAutoUpdate"),
        t("configAutoUpdateHint"),
        React8.createElement(import_dsh_client_ui_primitives6.Switch, {
          checked: settings.autoUpdate,
          label: t("configAutoUpdate"),
          onChange: (next) => void updateSettings({ autoUpdate: next })
        })
      ),
      React8.createElement(
        "div",
        { key: "config:reset", style: { ...S.configFoot, justifyContent: "flex-end" } },
        React8.createElement(
          import_dsh_client_ui_primitives6.Button,
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
    React8.createElement(
      "div",
      { style: S.card },
      React8.createElement(
        "div",
        { style: { ...S.configRow, borderTop: "none" } },
        React8.createElement(
          "div",
          { style: S.configMain },
          React8.createElement("span", { style: S.configLabel }, t("aboutTitle")),
          React8.createElement("span", { style: S.configHint }, "dsh-session-curator")
        ),
        React8.createElement(
          "div",
          { style: S.configControl },
          // 版本号：浅色小字。
          React8.createElement("span", { style: S.version }, `${t("versionLabel")} ${version === null ? "—" : `v${version}`}`),
          React8.createElement(
            import_dsh_client_ui_primitives6.Button,
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
      updateLine === null ? null : React8.createElement("div", { key: "config:update", style: S.configFoot }, updateLine),
      outdated && update.value !== null ? React8.createElement(
        "div",
        { key: "config:upgrade", style: S.updateBox },
        React8.createElement(
          "span",
          { style: S.updateTitle },
          text(t, "updateAvailable", { latest: update.value.latest ?? "?", current: version === null ? "?" : version })
        ),
        React8.createElement(
          "span",
          { style: S.updateSteps },
          React8.createElement("span", null, t("updateStepsTitle")),
          React8.createElement("span", null, t("updateStepOne")),
          React8.createElement("code", { style: S.code }, "dsh plugin --profile desktop add dsh-session-curator@latest"),
          React8.createElement("span", null, t("updateStepTwo"))
        ),
        React8.createElement(
          "a",
          {
            style: S.link,
            href: "https://www.npmjs.com/package/dsh-session-curator",
            target: "_blank",
            rel: "noreferrer"
          },
          t("updateOpen")
        )
      ) : null
    )
  );
  const usagePage = React8.createElement(
    "div",
    { style: S.column },
    React8.createElement(
      "div",
      { style: S.rowLine },
      React8.createElement("div", { style: S.filterSpacer }),
      React8.createElement(
        import_dsh_client_ui_primitives6.Button,
        {
          size: "sm",
          variant: "outline",
          disabled: usageBusy,
          onClick: () => void refreshUsage()
        },
        t("refresh")
      )
    ),
    React8.createElement(UsagePanel, {
      t,
      usage,
      loading: usageBusy,
      error: usageError,
      busy,
      // 榜单上的动作走与列表同一个端点（`run()` 会顺手刷新快照），但**完事之后还要
      // 重拉一次 `usage`**：`run()` 只换快照，`usage` 不在快照里 —— 不重拉的话
      // 刚点了「取消归档」的那一行仍然顶着「已归档」胶囊，看起来像没生效。
      onArchive: (sessionId) => runUsageAction("archive", sessionId),
      onUnarchive: (sessionId) => runUsageAction("unarchive", sessionId)
    })
  );
  return React8.createElement(
    "div",
    { style: S.column },
    React8.createElement(
      "div",
      { style: S.header },
      React8.createElement(
        "div",
        { style: S.tabBar },
        tabs.map(
          (entry) => React8.createElement(
            import_dsh_client_ui_primitives6.Button,
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
      isDataTab ? React8.createElement(
        "div",
        { style: S.headerActions },
        React8.createElement(
          import_dsh_client_ui_primitives6.Button,
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
        React8.createElement(
          import_dsh_client_ui_primitives6.Button,
          { size: "sm", variant: "outline", disabled: loading || busy, onClick: () => void refresh() },
          t("refresh")
        )
      ) : null
    ),
    error ? React8.createElement("div", { style: S.error }, error) : null,
    // 过滤工具条：只有数据页签上有（配置页没有列表可筛，磁盘占用页也不是列表）。
    isDataTab ? filterBar : null,
    isDataTab ? React8.createElement(
      "div",
      { style: S.card },
      loading && !snapshot ? React8.createElement("div", { style: S.empty }, t("loading")) : filtered.length === 0 ? React8.createElement(
        "div",
        { style: S.empty },
        filtering ? t("emptyFiltered") : tab === "archived" ? t("emptyArchived") : tab === "pinned" ? t("emptyPinned") : t("emptyTrash")
      ) : React8.createElement("div", { style: S.list }, nodes)
    ) : null,
    isDataTab ? React8.createElement(
      "div",
      { style: S.rowLine },
      React8.createElement(
        import_dsh_client_ui_primitives6.Button,
        {
          size: "sm",
          variant: "ghost",
          disabled: busy || rows.length === 0,
          onClick: () => setSelected(selected.length === rows.length ? [] : rows.map((row) => row.sessionId))
        },
        selected.length === rows.length && rows.length > 0 ? t("selectNone") : t("selectAll")
      ),
      batch.map(
        (action) => React8.createElement(
          import_dsh_client_ui_primitives6.Button,
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
      tab === "trash" && trashed.length > 0 ? React8.createElement(
        import_dsh_client_ui_primitives6.Button,
        {
          size: "sm",
          variant: "outline",
          disabled: busy,
          onClick: () => requestPurge(
            trashed.map((row) => row.sessionId),
            ""
          )
        },
        t("emptyTrashAll")
      ) : null,
      busy ? React8.createElement("span", { style: S.footer }, t("working")) : null
    ) : null,
    isUsage ? usagePage : null,
    isConfig ? configPage : null,
    isDataTab ? React8.createElement(
      "div",
      { style: S.footer },
      React8.createElement("span", null, text(t, "total", { n: rows.length, size: formatBytes(totalBytes) })),
      // 过滤只改显示：合计那一行报的仍是整个页签的条数，这里再补一句"筛出来几条"。
      filtering ? React8.createElement("span", null, text(t, "filtered", { n: filtered.length, total: rows.length })) : null,
      grouping && groups.length > 0 ? React8.createElement("span", null, text(t, "workspaces", { n: groups.length })) : null,
      selected.length > 0 ? React8.createElement("span", null, text(t, "selected", { n: selected.length })) : null,
      snapshot ? React8.createElement("span", { style: S.mono, title: snapshot.trashDir }, snapshot.trashDir) : null
    ) : null
  );
}

// src/client/components/toast-host.ts
var React9 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives7 = require("@deepseek-ai/dsh-client-ui-primitives");
var HOLD_MS = 5e3;
function ToastHost(props) {
  const t = props.t;
  const notice = useStore(toastStore);
  if (notice === null) return null;
  if (notice.error !== null) {
    return React9.createElement(
      import_dsh_client_ui_primitives7.Toast,
      {
        text: text(t, "toastUndoFailed", { reason: notice.error }),
        icon: React9.createElement(import_dsh_client_ui_primitives7.IconWarningOutlineRegular, {}),
        onDone: dismissToast
      },
      `session-curator-toast-${notice.seq}`
    );
  }
  if (notice.ids.length === 0) {
    return React9.createElement(
      import_dsh_client_ui_primitives7.Toast,
      {
        text: notice.title,
        holdMs: HOLD_MS,
        onDone: dismissToast
      },
      `session-curator-toast-${notice.seq}`
    );
  }
  const many = notice.ids.length > 1;
  return React9.createElement(
    import_dsh_client_ui_primitives7.Toast,
    {
      text: many ? text(t, "toastTrashedMany", { n: notice.ids.length }) : text(t, "toastTrashed", { title: notice.title }),
      tone: "success",
      holdMs: HOLD_MS,
      actions: [{ label: t("toastUndo"), onClick: () => void undoTrash() }],
      onDone: dismissToast
    },
    `session-curator-toast-${notice.seq}`
  );
}

// src/client/components/trash-row-button.ts
var React10 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives8 = require("@deepseek-ai/dsh-client-ui-primitives");
function TrashRowButton(props) {
  const [hovered, setHovered] = React10.useState(false);
  const title = props.displayTitle || props.sessionId;
  const label = props.t("moveToTrash");
  return React10.createElement(import_dsh_client_ui_primitives8.Tooltip, {
    label,
    side: "bottom",
    align: "end",
    delayMs: 500,
    children: React10.createElement(
      "button",
      {
        type: "button",
        style: hovered ? S.rowIconButtonHover : S.rowIconButton,
        "aria-label": `${title} — ${label}`,
        onPointerEnter: () => setHovered(true),
        onPointerLeave: () => setHovered(false),
        onClick: () => requestTrash([props.sessionId], title)
      },
      React10.createElement(import_dsh_client_ui_primitives8.IconTrashOutlineRegular, { size: 14 })
    )
  });
}

// src/client/index.ts
var MENU_ID = "session-curator.delete";
var OVERLAY_ID = "session-curator.dialog";
var TOAST_ID = "session-curator.toast";
var HOVER_ID = "session-curator.hover";
var ROW_ACTION_ID = "session-curator.trash";
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
  contribute(
    "sidebar.workspaces.session.menu.item",
    {
      name: "sidebar.workspaces.session.menu.item",
      id: MENU_ID,
      order: 500,
      label: () => t("menuDelete"),
      locale: NS
    },
    (props) => {
      const [, setMenuOpen] = props.useMenuOpenState();
      return React11.createElement(
        import_dsh_client_ui_primitives9.MenuItemButton,
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
		})(module, module.exports, require);
		return module.exports;
	}
});

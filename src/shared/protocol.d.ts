/**
 * 客户端 ↔ 宿主之间那条线协议的数据形状（**只有类型，没有任何运行时代码**）。
 *
 * 两个半区都 `import type` 这里：类型在编译期被完全擦掉，所以谁都不会真的去加载对方的
 * 代码 —— 客户端那份是浏览器里的 classic script，根本不可能 import 宿主的 Node 模块。
 * 放在共享位置是为了让"宿主产出的形状"和"客户端读的字段"由同一份声明约束：改一边忘了
 * 另一边，`pnpm run typecheck` 当场就红。
 */

/** 十三个端点的名字（精确 Fetch 路由 `/api/session-curator/<endpoint>` 的最后一段）。 */
export type Endpoint =
	| "snapshot"
	| "describe"
	| "archive"
	| "unarchive"
	| "pin"
	| "unpin"
	| "trash"
	| "restore"
	| "purge"
	| "trash-stats"
	| "purge-older-than"
	| "usage"
	| "open"
	| "check-update";

/** `open` 的两种动作。 */
export type OpenTarget = "path" | "reveal";

/** 端点的入参。三个页签共用一份，字段按端点各取所需。 */
export interface EndpointPayload {
	/** 会话 id 列表；宿主只认字符串数组（`idsOf()`）。 */
	ids?: string[];
	/** `archive` 专用：先停掉会话正在跑的工作再归档。 */
	stopActivity?: boolean;
	/** `check-update` 专用：跳过宿主那 10 分钟的缓存。 */
	force?: boolean;
	/**
	 * `trash-stats` / `purge-older-than` 专用：回收站保留天数。
	 *
	 * 传的是**天数**而不是截止时间戳：客户端点"预览"和随后点"确认"之间会隔几秒甚至几分钟，
	 * 由谁算那个时间戳会决定"预览到的那批"和"真删的那批"是不是同一批。让宿主每次都按
	 * `Date.now()` 现算，两边就是同一条规则（`trashStats()` 用的也是它）。
	 *
	 * 取值由客户端侧的白名单 `TRASH_RETENTION_DAYS`（`src/client/groups.ts`）决定，
	 * 宿主只做 1–3650 的粗校验 —— 这里只有类型，常量不进这份 `*.d.ts`。
	 */
	days?: number;
	/** `open` 专用：只要路径，还是把系统文件管理器也叫起来。 */
	target?: OpenTarget;
}

/** 列表行共有的字段：分组、排序、勾选都只看这些。 */
export interface ListedRow {
	sessionId: string;
	title: string;
	cwd: string | null;
	workspaceId: string | null;
	workspaceTitle: string | null;
	bytes: number;
	files: number;
}

/** 已归档 / 已置顶的一行：会话目录还在磁盘上。 */
export interface SessionRow extends ListedRow {
	createdAt: number | null;
	slug: string | null;
	onDisk: boolean;
	/**
	 * 这个会话此刻是不是**正在跑**（宿主用官方的 `workspace/session-activity` 判定的）。
	 *
	 * 列表拿它画「运行中」徽标并预先禁掉危险动作 —— 不等用户点了删除再回一句
	 * "会话正在运行，请先停止它"。删除端点那道检查照旧（它才是真正的把关）。
	 * 同一个事实在快照顶层还有一份 `activeSessionIds`，给"跨页签批量"那种手上没有行对象
	 * 的地方用。
	 */
	active: boolean;
}

/** 回收站里的一行：目录已经搬到 `<DSH_HOME>/storages/session-manager/trash` 下。 */
export interface TrashRow extends ListedRow {
	deletedAt: number;
	slug: string | null;
	restorable: boolean;
}

/**
 * 面板里真正拿到的一行：三个页签的行混在一个 `rows` 里渲染，
 * 所以 `createdAt`（归档 / 置顶行）与 `deletedAt`（回收站行）在展示层都是可选的。
 */
export interface PanelRow extends ListedRow {
	createdAt?: number | null;
	deletedAt?: number;
	slug?: string | null;
	onDisk?: boolean;
	restorable?: boolean;
	/** 只在归档 / 置顶行上有值（回收站里的会话不可能正在跑）。 */
	active?: boolean;
}

/** 批量操作的逐项结果：单项失败只留在这里，不抛传输层异常。 */
export interface StepResult {
	sessionId: string;
	ok: boolean;
	reason?: string;
	steps?: string[];
}

export interface Totals {
	archived: number;
	archivedBytes: number;
	pinned: number;
	trashed: number;
	trashBytes: number;
}

/** `snapshot` 的值：归档 / 置顶 / 回收站的完整快照，附带目录位置。 */
export interface Snapshot {
	dshHome: string;
	version: string | null;
	trashDir: string;
	sessionsDir: string;
	archived: SessionRow[];
	pinned: SessionRow[];
	trashed: TrashRow[];
	totals: Totals;
	/**
	 * 正在跑的会话 id（与每行的 `active` 同源）。
	 *
	 * 为什么除了行上的 `active` 还要平铺一份：客户端的"按工作区批量动作"要跨三个页签判断
	 * 整个工作区里有没有正在跑的会话，那些 id 可能根本不在当前页签的行里 —— 有一份集合就能
	 * O(1) 查，不必把三份行拼起来。
	 */
	activeSessionIds: string[];
}

/**
 * `describe` 的值：**单个**会话的完整事实（侧边栏 hover 卡片用）。
 *
 * 为什么快照不够：`snapshot` 只有已归档 / 已置顶 / 回收站三个集合，而 hover 卡片最常出现
 * 在**普通**会话行上 —— 那些 id 在快照里根本不存在。所以单独给一条"问一个会话"的端点，
 * 由宿主把归档 / 置顶 / 回收站三种状态合并成一个形状回给客户端。
 */
export interface SessionDetail {
	sessionId: string;
	title: string;
	cwd: string | null;
	workspaceId: string | null;
	workspaceTitle: string | null;
	slug: string | null;
	createdAt: number | null;
	bytes: number;
	files: number;
	/** 会话目录是否还在 `<DSH_HOME>/sessions` 下（回收站条目为 false）。 */
	onDisk: boolean;
	archived: boolean;
	pinned: boolean;
	/** 与 `SessionRow.active` 同源：这个会话此刻是不是正在跑。 */
	active: boolean;
	trashed: boolean;
	/** 只在回收站里才有值（`__trash.json` 的 `deletedAt`）。 */
	deletedAt: number | null;
	/** 回收站条目是否带得回原目录（缺 `__trash.json` 的老条目恢复不了）。 */
	restorable: boolean;
}

/** 一切变更操作的回包：逐项结果 + 变更之后的新快照。 */
export interface MutationResult extends Snapshot {
	results: StepResult[];
}

/**
 * `trash-stats` 的值：回收站保留策略的**预览**（只读，绝不删东西）。
 *
 * 客户端点"清理 N 天前的会话"之前先要它，把这行数字摆进确认弹窗；确认之后真删的是
 * `purge-older-than`，它按**同一套规则**（都用入参 `days` 现算截止时间）重新取一遍，
 * 所以预览与实际删掉的是同一批。
 */
export interface TrashStats {
	days: number;
	/** 截止时间（`Date.now() - days * 86400000`）：严格早于它的条目才算过期。 */
	cutoff: number;
	/** 将会被清掉的会话数 —— 只有 `deletedAt > 0` 且带得回原 slug 的条目才算（见宿主注释）。 */
	count: number;
	bytes: number;
	/** 回收站当前的全部条目数 / 体积，给"将删除 N / 共 M"这类文案用。 */
	totalCount: number;
	totalBytes: number;
}

/** `check-update` 的值；`error` 只在查询失败时出现（离线 / 超时 / 代理不通）。 */
export interface UpdateInfo {
	current: string | null;
	latest: string | null;
	outdated: boolean;
	checkedAt: number;
	error?: string;
}

/**
 * `usage` 的值：**磁盘占用视图**（配置页里那一块）。
 *
 * 与 `snapshot` 的分工：快照只覆盖"已归档 / 已置顶 / 回收站"三个集合，而"哪些会话最占地方"
 * 问的是**整台机器上所有会话**（含正在用的普通会话）—— 那些 id 在快照里根本不存在。
 * 所以单开一条只读端点，宿主扫一遍 `<DSH_HOME>/sessions`。
 *
 * 全量扫描不便宜（本机 191 个会话 ≈ 191 次 `readdir` + 每目录每文件一次 `stat`），所以这里
 * **只回聚合结果 + 两个榜单**，不回全部明细；客户端的展示也就只需要这些。目录体积走
 * `dirStats()` 的 mtime 缓存，而快照刚扫过的那批（归档 / 置顶 / 回收站）本来就命中缓存，
 * 于是这次多出来的成本主要是读投影缓存。
 */
export interface UsageRow {
	sessionId: string;
	title: string;
	cwd: string | null;
	workspaceTitle: string | null;
	bytes: number;
	files: number;
	createdAt: number | null;
	/** 删除时间（回收站里的会话才有）；`null` 表示这个会话还在磁盘上。 */
	deletedAt: number | null;
	archived: boolean;
	pinned: boolean;
	trashed: boolean;
	/** 正在跑的会话：榜单上标出来，并禁掉"建议归档"那个按钮。 */
	active: boolean;
}

/** 一个工作区的占用合计（按体积降序，客户端的横条图用它）。 */
export interface UsageGroup {
	key: string;
	title: string;
	/** 这个工作区有多少会话（含回收站里的）。 */
	count: number;
	bytes: number;
}

export interface Usage {
	/** 会话总数 / 总体积（含回收站）。 */
	totalSessions: number;
	totalBytes: number;
	/** 磁盘上的会话目录数（回收站条目不算）—— 与 `totalSessions` 的差就是回收站里的条数。 */
	onDiskSessions: number;
	groups: UsageGroup[];
	/** 最占地方的会话（体积降序，最多 `USAGE_TOP_LIMIT` 条）。 */
	largest: UsageRow[];
	/** 最久没打开的会话（`createdAt` 升序，没有时间的沉底；最多 `USAGE_TOP_LIMIT` 条）。 */
	oldest: UsageRow[];
}

/** `open` 的值：这条会话的日志目录，以及"到底做了什么"。 */
export interface OpenResult {
	sessionId: string;
	/** 日志目录的绝对路径（客户端"复制路径"用的是它）。 */
	path: string;
	/** `reveal` 是否真的把系统文件管理器叫起来了（平台不支持时为 false，但 `path` 仍然有效）。 */
	revealed: boolean;
	/** `revealed` 为 false 时的人话原因（界面据此提示"已复制路径，请手动打开"）。 */
	reason?: string;
}

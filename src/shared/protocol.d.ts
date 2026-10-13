/**
 * 客户端 ↔ 宿主之间那条线协议的数据形状（**只有类型，没有任何运行时代码**）。
 *
 * 两个半区都 `import type` 这里：类型在编译期被完全擦掉，所以谁都不会真的去加载对方的
 * 代码 —— 客户端那份是浏览器里的 classic script，根本不可能 import 宿主的 Node 模块。
 * 放在共享位置是为了让"宿主产出的形状"和"客户端读的字段"由同一份声明约束：改一边忘了
 * 另一边，`npm run typecheck` 当场就红。
 */

/** 九个端点的名字（精确 Fetch 路由 `/api/session-curator/<endpoint>` 的最后一段）。 */
export type Endpoint =
	| "snapshot"
	| "archive"
	| "unarchive"
	| "pin"
	| "unpin"
	| "trash"
	| "restore"
	| "purge"
	| "check-update";

/** 端点的入参。三个页签共用一份，字段按端点各取所需。 */
export interface EndpointPayload {
	/** 会话 id 列表；宿主只认字符串数组（`idsOf()`）。 */
	ids?: string[];
	/** `archive` 专用：先停掉会话正在跑的工作再归档。 */
	stopActivity?: boolean;
	/** `check-update` 专用：跳过宿主那 10 分钟的缓存。 */
	force?: boolean;
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
}

/** 一切变更操作的回包：逐项结果 + 变更之后的新快照。 */
export interface MutationResult extends Snapshot {
	results: StepResult[];
}

/** `check-update` 的值；`error` 只在查询失败时出现（离线 / 超时 / 代理不通）。 */
export interface UpdateInfo {
	current: string | null;
	latest: string | null;
	outdated: boolean;
	checkedAt: number;
	error?: string;
}

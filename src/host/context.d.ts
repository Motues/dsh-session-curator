/**
 * 宿主半区接触到的 cordis / DSH 服务面 —— **只有类型**。
 *
 * 为什么不 import `@deepseek-ai/*` 的类型：那些包从不发 npm（由 DSH 运行时注入），
 * 本地根本没有它们；而且 `lib/` 里出现 `@deepseek-ai/*` 裸标识符本身就违反仓库约定
 * （插件常以 junction 挂在 profile 下，Node 按 realpath 解析会直接 `Cannot find package`）。
 * 所以这里按"我们用到的形状"结构性描述，运行时零代码、编译后连文件都不存在。
 */
import type { Endpoint, EndpointPayload, OpenTarget } from "../shared/protocol.js";

/** `ctx.workspaceRegistry.list()` / `resolveByPath()` 给出的工作区。 */
export interface WorkspaceLike {
	id: unknown;
	path: string;
	title: string;
	sessionIds?: string[];
	attachSession?(sessionId: string): Promise<unknown>;
	detachSession?(sessionId: string): Promise<unknown>;
}

/** 归档 / 置顶 / 工作区记账的唯一来源（官方 `workspaceRegistry` 服务）。 */
export interface WorkspaceRegistryLike {
	list(): WorkspaceLike[];
	readonly archivedSessionIds: string[];
	readonly pinnedSessionIds: string[];
	archiveSession(sessionId: string, options?: { stopActivity?: boolean }): Promise<unknown>;
	unarchiveSession(sessionId: string): Promise<unknown>;
	pinSession(sessionId: string): Promise<unknown>;
	unpinSession(sessionId: string): Promise<unknown>;
	resolveByPath(path: string): Promise<WorkspaceLike | undefined>;
}

/** 一条精确 Fetch 路由（`ctx.connection.fetch.register()` 的入参）。 */
export interface FetchRoute {
	path: string;
	methods: string[];
	requestBody: "buffered";
	fetch(request: Request): Promise<Response>;
}

/** 插件 `apply(ctx)` 拿到的宿主 ctx：只有这几个面。 */
export interface HostContext {
	connection: {
		fetch: {
			register(route: FetchRoute): () => void;
		};
	};
	workspaceRegistry: WorkspaceRegistryLike;
	effect(callback: () => unknown, label?: string): unknown;
	waterfall(name: string, payload: { sessionId: string }, fallback: () => Promise<unknown>): Promise<unknown>;
	logger?: { warn(message: string): void };
}

/** 端点处理器：拿管理器 + 已归一化的入参，回一个可 JSON 化的值。 */
export type EndpointHandler = (manager: EndpointHost, payload: EndpointPayload) => Promise<unknown>;

/**
 * `routes.ts` 需要的管理器面。写在这里而不是直接引用 `SessionManager`，
 * 是为了让 `ENDPOINTS` 表只依赖"行为"、不依赖那个类（也避免 host 内部循环 import）。
 */
export interface EndpointHost {
	snapshot(): Promise<unknown>;
	/** 单个会话的事实；找不到就抛错，由信封兜住。 */
	describe(ids: string[]): Promise<unknown>;
	archive(ids: string[], stopActivity?: boolean): Promise<unknown>;
	unarchive(ids: string[]): Promise<unknown>;
	pin(ids: string[]): Promise<unknown>;
	unpin(ids: string[]): Promise<unknown>;
	/** 物理删除（不可恢复，逐项结果在信封里）。 */
	delete(ids: string[]): Promise<unknown>;
	/** 磁盘占用视图（只读，扫整个 sessions 根）。 */
	usage(): Promise<unknown>;
	/** 会话日志目录：只要路径，或再叫一次系统文件管理器。 */
	open(ids: string[], target: OpenTarget): Promise<unknown>;
	checkUpdate(force?: boolean): Promise<unknown>;
}

/** 端点到处理器的表：`registerRoutes()` 直接按它登记路由。 */
export type EndpointTable = Record<Endpoint, EndpointHandler>;

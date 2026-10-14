/**
 * 传输 / 分发：十一个端点 → 十一条精确 Fetch 路由。
 *
 * ── 为什么**不用** `ctx.connection.rpc.handle()`（踩过的坑，改回去之前先读）──
 *
 * 它内部把路由交给 `owner.effect(() => owner.webServer.register(route))`，而那个
 * `owner` 是 `this.ctx` —— **Connection 服务自己的 ctx**，不是读服务的插件 ctx。
 * cordis 的服务调用会带 shadow（`Context[symbols.shadow]` 指向提供者作用域），所以
 * 服务解析从"提供者的 fiber"开始；Connection 自己的 inject 只有 `["credentials"]`，
 * 于是必然抛：
 *
 *     cannot get property "webServer" without inject
 *     （@deepseek-ai/dsh-client-connection/lib/index.js:656）
 *
 * 结果：插件 fiber 直接变 `failed`、一条路由都没挂上，客户端每个 POST 落到 SPA 静态
 * 兜底，由 `@deepseek-ai/dsh-host-frontend-static` 对非 GET/HEAD 回 **HTTP 405** ——
 * 就是 `transport failure for /session-manager/trash: HTTP 405`。
 * 注意：**在插件自己的 inject 里加 `webServer` 修不了它**，因为报错的那个 ctx 不是插件的。
 *
 * 改走同样由 Connection 公布的 `ctx.connection.fetch.register()`：精确 Fetch 路由挂在
 * 共享 `/api` 前缀下，`admit()`（Host/Origin/`sec-fetch-site` + 浏览器会话 cookie）与
 * 请求体上限都仍由 Connection 的 `/api` 前缀路由先执行，插件依旧零鉴权代码。
 */
import { messageOf } from "./fs-utils.js";
import type { EndpointHost, EndpointTable, FetchRoute, HostContext } from "./context.js";
import type { Endpoint, EndpointPayload } from "../shared/protocol.js";

/** DSH 的共享 API 通道：唯一带 Host/Origin 信任栅栏与浏览器会话鉴权的 HTTP 面。 */
export const API_CHANNEL = "/api";
/** 频道下属于本插件的路径前缀（`/api/session-curator/<endpoint>`）。 */
export const ROUTE_PREFIX = "session-curator";
/** 端点只读 / 只写，一律 POST（Connection 的精确路由按方法集合匹配）。 */
const ROUTE_METHODS = ["POST"];

/** 一个频道（`/api/session-curator`）：精确路由表按完整 pathname 命中，所以每个端点一条。 */
export const ENDPOINTS: EndpointTable = {
	snapshot: (manager) => manager.snapshot(),
	describe: (manager, payload) => manager.describe(payload.ids ?? []),
	archive: (manager, payload) => manager.archive(payload.ids ?? [], payload.stopActivity),
	unarchive: (manager, payload) => manager.unarchive(payload.ids ?? []),
	pin: (manager, payload) => manager.pin(payload.ids ?? []),
	unpin: (manager, payload) => manager.unpin(payload.ids ?? []),
	trash: (manager, payload) => manager.trash(payload.ids ?? []),
	restore: (manager, payload) => manager.restore(payload.ids ?? []),
	purge: (manager, payload) => manager.purge(payload.ids ?? []),
	// 保留策略的两条都只吃 `days`（不是 id 列表）：预览只读，清理是永久删除。
	"trash-stats": (manager, payload) => manager.trashStats(daysOf(payload)),
	"purge-older-than": (manager, payload) => manager.purgeOlderThan(daysOf(payload)),
	// 磁盘占用视图（只读）与"复制路径 / 在资源管理器中显示"。
	usage: (manager) => manager.usage(),
	// `target` 只认字面量 `"reveal"`；其余一律当 `"path"`（只读，最保守的那条）。
	open: (manager, payload) => manager.open(payload.ids ?? [], payload.target === "reveal" ? "reveal" : "path"),
	"check-update": (manager, payload) => manager.checkUpdate(payload.force === true)
};

/** 只接受字符串数组；其余一律忽略，避免把宿主路径当 id 传来的越权尝试。 */
export function idsOf(payload: Record<string, unknown>): string[] {
	return Array.isArray(payload.ids) ? payload.ids.filter((value): value is string => typeof value === "string" && value !== "") : [];
}

/**
 * 保留天数：越界 / 非数字一律退回 **30 天**（界面的默认值）。
 *
 * 这里只做"是不是个正常数字"的粗校验，真正的夹取在 `retention.ts` 的
 * `retentionCutoff()`（预览与真删共用那一份）。为什么退回 30 而不是 0：`0` 会让截止时间
 * 变成"此刻"，等于把整个回收站当成过期 —— 缺字段的请求绝不能有这种后果。
 */
export function daysOf(payload: EndpointPayload): number {
	const value = payload.days;
	if (typeof value !== "number" || !Number.isFinite(value)) return 30;
	return Math.min(Math.max(Math.floor(value), 1), 3650);
}

/**
 * 一个端点处理器。返回 Connection 的固定信封：处理器自身的业务失败走
 * `{ok:false, error}`，端点内部的逐项失败则留在 `value.results` 里。
 */
export async function handle(manager: EndpointHost, endpoint: Endpoint, payload: unknown): Promise<unknown> {
	const run: ((manager: EndpointHost, payload: EndpointPayload) => Promise<unknown>) | undefined = ENDPOINTS[endpoint];
	if (run === undefined) {
		return { ok: false, error: { code: "session-curator/unknown-endpoint", message: `unknown endpoint ${endpoint}`, details: {} } };
	}
	const safe: Record<string, unknown> = payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
	// 越过线协议边界之后客户端发来的一切都不可信：这里如实标成 EndpointPayload，
	// 具体字段仍由各处理器自己判（`idsOf()` 已经归一化过 ids）。
	const normalized = { ...safe, ids: idsOf(safe) } as EndpointPayload;
	try {
		return { ok: true, value: await run(manager, normalized) };
	} catch (error) {
		return { ok: false, error: { code: "session-curator/error", message: messageOf(error), details: {} } };
	}
}

/** `{type:'server-response', rpcId, result}` —— 与 Connection 自己回的信封逐字一致。 */
function envelope(rpcId: string, result: unknown): Response {
	return Response.json({ type: "server-response", rpcId, result });
}

function badRequest(rpcId: string | null, message: string): Response {
	// 与 Connection 的 `invalidEnvelopeResponse` 一致：坏信封也回 200 + 错误信封，
	// 这样客户端读到的是人话，而不是一个传输层异常。
	return envelope(rpcId ?? "invalid-request", {
		ok: false,
		error: { code: "session-curator/bad-request", message, details: {} }
	});
}

/** `/api` 已在前面做完信任与鉴权，这里只校验信封、分发、回包。 */
export async function respond(manager: EndpointHost, endpoint: Endpoint, request: Request): Promise<Response> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return badRequest(null, "body is not JSON");
	}
	const message = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : null;
	const rpcId = typeof message?.rpcId === "string" ? message.rpcId : null;
	if (rpcId === null || message?.type !== "client-request" || typeof message.method !== "string") {
		return badRequest(rpcId, "invalid client-request message");
	}
	const target = `${ROUTE_PREFIX}/${endpoint}`;
	if (message.method !== target) {
		return badRequest(rpcId, `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(target)}`);
	}
	return envelope(rpcId, await handle(manager, endpoint, message.payload));
}

/** 为每个端点挂一条精确路由；注册挂在**插件自己的 fiber** 上，卸载时一起摘掉。 */
export function registerRoutes(ctx: HostContext, manager: EndpointHost): void {
	// 只知道"精确路由登记处"这一个面；命名避开全局 fetch。
	const fetchRoutes = ctx.connection.fetch;
	for (const endpoint of Object.keys(ENDPOINTS) as Endpoint[]) {
		const route: FetchRoute = {
			path: `${API_CHANNEL}/${ROUTE_PREFIX}/${endpoint}`,
			methods: ROUTE_METHODS,
			requestBody: "buffered",
			fetch: (request) => respond(manager, endpoint, request)
		};
		// `registerFetchRoute` 用的是调用方的 `owner.effect`，所以这里传的是插件的 ctx。
		ctx.effect(() => fetchRoutes.register(route), `dsh-session-curator: ${route.path}`);
	}
}

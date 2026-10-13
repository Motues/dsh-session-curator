/**
 * 与宿主通信：Connection 的共享 `/api` 通道。
 *
 * 首选官方调用器（`ctx.get('connection').rpc.call`，若该服务在客户端存在），
 * 否则退回**逐字复刻线协议**的手写 `fetch`。两条路的信任栅栏与会话鉴权都由宿主
 * Connection 的 `/api` 前缀路由把关，插件自身无需任何鉴权代码。
 */
import { connectionRpc } from "./runtime.js";
import type { Endpoint, EndpointPayload, StepResult } from "../shared/protocol.js";

/** 官方共享通道；本插件占 `/api/session-curator/<endpoint>`。 */
export const API_CHANNEL = "/api";
export const ROUTE_PREFIX = "session-curator";

/** RFC 4122 v4；浏览器在非安全上下文也有 crypto.getRandomValues。 */
export function randomUuid(): string {
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
export function target(endpoint: Endpoint): string {
	return `${ROUTE_PREFIX}/${endpoint}`;
}

/**
 * 手写 Connection 线协议：逐字复刻 `@deepseek-ai/dsh-client-connection/lib/client.js`
 * 的 `createWebConnectionRpc().call` —— POST `${channel}/${endpoint}`（去掉前导 `/`，
 * 即文档相对路径），body 是 `{type:'client-request', rpcId, method, payload}`，
 * 其中 `method` 是**相对通道**的端点（宿主按它核对路由），响应信封是
 * `{type:'server-response', rpcId, result:{ok,value|error}}`。
 * 这样客户端**不依赖任何 Cordis 服务**。
 */
export async function rawCall(endpoint: Endpoint, payload?: EndpointPayload): Promise<unknown> {
	const rpcId = randomUuid();
	const url = `${API_CHANNEL}/${ROUTE_PREFIX}/${endpoint}`;
	const response = await fetch(url.slice(1), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ type: "client-request", rpcId, method: target(endpoint), payload: payload || {} })
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}（${url}）`);
	let envelope: unknown;
	try {
		envelope = await response.json();
	} catch {
		throw new Error(`响应不是 JSON（${url}）`);
	}
	const message = envelope as { type?: unknown; rpcId?: unknown; result?: { ok?: unknown; value?: unknown; error?: { code?: string; message?: string } } } | null;
	if (!message || message.type !== "server-response" || typeof message.rpcId !== "string") {
		throw new Error("无效的 server-response 信封");
	}
	if (message.rpcId !== rpcId) throw new Error(`rpcId 不匹配（${endpoint}）`);
	const result = message.result;
	if (!result || (result.ok !== true && result.ok !== false)) throw new Error("无效的 server-response 结果");
	if (result.ok !== true) {
		throw new Error(`${result.error ? result.error.code : "error"}: ${result.error ? result.error.message : "未知错误"}`);
	}
	return result.value;
}

/** 首选宿主自带的调用器（若客户端真有这个服务），否则退回手写 fetch。 */
export async function call<T = unknown>(endpoint: Endpoint, payload?: EndpointPayload): Promise<T> {
	const rpc = connectionRpc();
	if (rpc !== null) {
		const result = await rpc.call(API_CHANNEL, target(endpoint), payload || {});
		if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
		return result.value as T;
	}
	return (await rawCall(endpoint, payload)) as T;
}

/** 逐项结果里第一条失败原因，用于把宿主拒绝转成一句人话。 */
export function firstFailure(results: StepResult[] | undefined): string | null {
	for (const row of results || []) {
		if (!row.ok) return row.reason || "操作失败";
	}
	return null;
}

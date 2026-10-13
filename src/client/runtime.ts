/**
 * 运行时引用（插件 ctx）与错误上报。
 *
 * 单独一层是为了打断环：`api.ts` 需要 ctx，组件需要 `api.ts`，而 `apply()` 又要给
 * 组件注册槽位 —— 把"当前 ctx"放在这里，谁都不用 import 谁。
 */
import type { TFn } from "./i18n.js";

/** Connection 的官方调用器（`call()` 优先用它，拿不到才退回手写 fetch）。 */
export interface ConnectionRpc {
	call(
		channel: string,
		method: string,
		payload: unknown
	): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }>;
}

export interface ClientSlots {
	inject(slot: string, callback: () => unknown): unknown;
	register(options: Record<string, unknown>, component: unknown): unknown;
	/**
	 * 槽位账本：只有设置外壳的 `navIcon(id)` 需要它（见 `sectionIdFor`）。
	 * 故意声明成必选：老版本外壳没有这个方法时靠调用点的 try/catch 退回自己的 id，
	 * 写成可选再 `?.()` 会让"没有账本"和"账本是空的"给出同一个答案。
	 */
	entries(slot: string): { options?: { id?: string } }[];
}

export interface ClientLocale {
	register(namespace: string, dictionaries: Record<string, Record<string, string>>): unknown;
	bind(namespace: string): TFn;
}

/** 客户端插件 `apply(ctx)` 拿到的 ctx —— 只声明我们真正碰的那几个面。 */
export interface ClientContext {
	get(name: string): unknown;
	locale: ClientLocale;
	slots: ClientSlots;
	effect(callback: () => unknown, label?: string): unknown;
	logger?: { warn(message: string): void };
}

let current: ClientContext | null = null;

export function setContext(ctx: ClientContext): void {
	current = ctx;
}

export function context(): ClientContext | null {
	return current;
}

export function connectionRpc(): ConnectionRpc | null {
	const ctx = current;
	if (ctx === null) return null;
	const connection = ctx.get("connection") as { rpc?: ConnectionRpc } | undefined | null;
	const rpc = connection === null || connection === undefined ? null : connection.rpc;
	return rpc && typeof rpc.call === "function" ? rpc : null;
}

export function ctxLogger(): { warn(message: string): void } | null {
	const ctx = current;
	return ctx !== null && ctx.logger ? ctx.logger : null;
}

export function reportError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const logger = ctxLogger();
	if (logger) logger.warn(`[session-curator] ${message}`);
	return message;
}

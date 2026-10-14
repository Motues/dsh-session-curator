/**
 * 「复制路径 / 在资源管理器中显示」的客户端一半。
 *
 * 两件事都**必须**由宿主给出路径：客户端既不知道 `<DSH_HOME>` 在哪，也不该有机会传一个
 * 自己拼的路径过去（宿主那侧的校验见 `src/host/open.ts`）。所以这里先问 `open` 端点拿到
 * 绝对路径，再决定是写剪贴板还是让宿主叫文件管理器。
 *
 * 剪贴板优先用 `navigator.clipboard`；它只在安全上下文（https / localhost）可用，
 * 失败时退回一个隐藏 `<textarea>` + `document.execCommand("copy")` —— DSH 的 GUI 就是
 * `http://127.0.0.1:19387`，属于安全上下文，但插件在别的部署形态下也应当能用。
 */
import { call } from "./api.js";
import type { OpenResult } from "../shared/protocol.js";

/** 会话日志目录的绝对路径（`reveal` 传 true 时顺便让宿主叫起文件管理器）。 */
export function openSessionPath(sessionId: string, reveal?: boolean): Promise<OpenResult> {
	return call<OpenResult>("open", reveal === true ? { ids: [sessionId], target: "reveal" } : { ids: [sessionId], target: "path" });
}

/** 写剪贴板：先试异步 API，再退回 `execCommand`。两条都失败就返回 false。 */
export async function copyText(value: string): Promise<boolean> {
	const clipboard = globalThis.navigator?.clipboard;
	if (clipboard !== undefined && typeof clipboard.writeText === "function") {
		try {
			await clipboard.writeText(value);
			return true;
		} catch {
			// 权限被拒 / 非安全上下文：继续往下试兜底那条
		}
	}
	try {
		const document = globalThis.document;
		if (document === undefined) return false;
		const area = document.createElement("textarea");
		area.value = value;
		// 不能留在可见区域里（会闪一下）：固定定位到屏幕外，且不可见。
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

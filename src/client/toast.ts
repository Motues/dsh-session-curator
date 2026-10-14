/**
 * 删除成功后的「撤销」提示（`Toast` 的状态）。
 *
 * 与确认弹窗放在 `dialog.ts` 相对，这里单独一份是因为它多了一步**异步撤销**：
 * 状态机、端点调用、失败降级都在这个模块里，组件只负责画。
 */
import { firstFailure, call } from "./api.js";
import { mutationStore } from "./dialog.js";
import { reportError } from "./runtime.js";
import { rememberSnapshot } from "./snapshot.js";
import { createStore } from "./stores.js";
import type { MutationResult } from "../shared/protocol.js";

export interface UndoNotice {
	/** 每次新提示都自增：`Toast` 靠 key 变化重启"滑入 → 停留 → 淡出"这一轮。 */
	seq: number;
	ids: string[];
	/** 单条时显示标题，多条时显示数量。 */
	title: string;
	/** 撤销失败的原因；有值时不再显示撤销按钮。 */
	error: string | null;
}

/** 当前可见的提示；null 表示没有。 */
export const toastStore = createStore<UndoNotice | null>(null);

let sequence = 0;

/** 软删除成功后调用：给用户 5 秒（`Toast` 的 holdMs）的撤销机会。 */
export function showTrashUndo(ids: string[], title: string): void {
	if (ids.length === 0) return;
	sequence += 1;
	toastStore.set({ seq: sequence, ids: [...ids], title, error: null });
}

/**
 * 一句**纯信息**提示（没有撤销按钮、没有 id）。
 *
 * 给"复制路径 / 在资源管理器里显示"这类顺手动作的结果用：它们不该占面板上那条错误行
 *（那是列表自己的错误面），也不该弹一个确认框。复用同一个 store —— `ToastHost` 在没有
 * `ids` 时不画撤销按钮（见 `components/toast-host.ts`）。
 */
export function showNotice(message: string): void {
	if (message === "") return;
	sequence += 1;
	toastStore.set({ seq: sequence, ids: [], title: message, error: null });
}

export function dismissToast(): void {
	toastStore.set(null);
}

/** 撤销失败：把原因写进**同一条**提示（seq 不变，所以它照原节奏淡出）。 */
export function failToast(reason: string): void {
	const current = toastStore.get();
	if (current === null) return;
	toastStore.set({ ...current, error: reason });
}

/**
 * 撤销 = 把刚移进回收站的 ids 原样恢复。
 *
 * 逐项失败（例如"目标会话目录已存在"）只报第一条原因：这是 toast，不是面板，
 * 说清"撤销没成功"比列全更合适。
 */
export async function undoTrash(): Promise<void> {
	const current = toastStore.get();
	if (current === null || current.error !== null) return;
	try {
		const value = await call<MutationResult>("restore", { ids: current.ids });
		const failure = firstFailure(value.results);
		if (failure !== null) {
			failToast(failure);
			return;
		}
		mutationStore.set(mutationStore.get() + 1);
		// 撤销回包同样是一份新快照：写进缓存，见 `snapshot.ts`。
		rememberSnapshot(value);
		dismissToast();
	} catch (thrown) {
		failToast(reportError(thrown));
	}
}

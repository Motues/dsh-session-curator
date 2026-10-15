/**
 * 全局的一次性提示（`Toast` 的状态）。
 *
 * 现在只有一种提示：**纯信息**（复制路径 / 在资源管理器中显示的结果）。
 * 回收站时代的"删除后 5 秒撤销"已随回收站一起移除 —— 删除是物理删除，没有可撤销的东西。
 * 组件只负责画（见 `components/toast-host.ts`）。
 */
import { createStore } from "./stores.js";

export interface Notice {
	/** 每次新提示都自增：`Toast` 靠 key 变化重启"滑入 → 停留 → 淡出"这一轮。 */
	seq: number;
	/** 要显示的人话。 */
	message: string;
}

/** 当前可见的提示；null 表示没有。 */
export const toastStore = createStore<Notice | null>(null);

let sequence = 0;

/**
 * 一句**纯信息**提示（没有撤销按钮、没有 id）。
 *
 * 给"复制路径 / 在资源管理器里显示"这类顺手动作的结果用：它们不该占面板上那条错误行
 *（那是列表自己的错误面），也不该弹一个确认框。
 */
export function showNotice(message: string): void {
	if (message === "") return;
	sequence += 1;
	toastStore.set({ seq: sequence, message });
}

export function dismissToast(): void {
	toastStore.set(null);
}

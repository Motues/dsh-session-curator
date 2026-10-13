/**
 * 两个模块级小 store（弹窗宿主、设置面板、侧边栏菜单项共享）。
 *
 * 放在一起是因为它们表达同一件事的两半：`dialogStore` 请求一次确认，
 * `mutationStore` 在确认之后通知所有订阅者"数据变了，去重新拉快照"。
 */
import { createStore } from "./stores.js";

export interface DialogRequest {
	kind: "trash" | "purge";
	ids: string[];
	/** 只对单个 id 有意义（批量时传第一条的标题，或空串）。 */
	title: string;
}

/** 待确认的请求；null 表示没有弹窗。 */
export const dialogStore = createStore<DialogRequest | null>(null);
/** 每次写操作成功后自增，让设置面板重新拉快照。 */
export const mutationStore = createStore<number>(0);

export function requestTrash(ids: string[], title: string): void {
	dialogStore.set({ kind: "trash", ids, title });
}

export function requestPurge(ids: string[], title: string): void {
	dialogStore.set({ kind: "purge", ids, title });
}

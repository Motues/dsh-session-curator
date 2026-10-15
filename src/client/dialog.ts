/**
 * 两个模块级小 store（弹窗宿主与设置面板共享）。
 *
 * 放在一起是因为它们表达同一件事的两半：`dialogStore` 请求一次确认，
 * `mutationStore` 在确认之后通知所有订阅者"数据变了，去重新拉快照"。
 */
import { createStore } from "./stores.js";

/**
 * 待确认的请求：只有"物理删除"这一种。
 *
 * 删除曾经分三条路（软删除 / 永久删除 / 按时间清理）—— 回收站移除之后只剩一条：
 * `delete` 端点直接删目录，不可恢复，所以弹窗文案与确认强度也只有一套。
 */
export interface DialogRequest {
	kind: "delete";
	ids: string[];
	/** 只对单个 id 有意义（批量时传第一条的标题，或空串）。 */
	title: string;
}

/** 待确认的请求；null 表示没有弹窗。 */
export const dialogStore = createStore<DialogRequest | null>(null);
/** 每次写操作成功后自增，让设置面板重新拉快照。 */
export const mutationStore = createStore<number>(0);

/** 请求一次物理删除确认（单行菜单、批量按钮、整个工作区都走它）。 */
export function requestDelete(ids: string[], title: string): void {
	dialogStore.set({ kind: "delete", ids, title });
}

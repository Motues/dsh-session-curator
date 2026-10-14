/**
 * 两个模块级小 store（弹窗宿主、设置面板、侧边栏菜单项共享）。
 *
 * 放在一起是因为它们表达同一件事的两半：`dialogStore` 请求一次确认，
 * `mutationStore` 在确认之后通知所有订阅者"数据变了，去重新拉快照"。
 */
import { createStore } from "./stores.js";

export interface DialogRequest {
	kind: "trash" | "purge" | "purge-old";
	ids: string[];
	/** 只对单个 id 有意义（批量时传第一条的标题，或空串）。 */
	title: string;
	/** `purge-old` 专用：保留天数（确认文案里要说清楚"多少天前"）。 */
	days?: number;
	/**
	 * `purge-old` 专用：**点确认之前**预览到的条数与体积。
	 *
	 * 只用来渲染确认弹窗（"将永久删除 N 个会话 · X MB"）——真删时宿主会按同一套规则重新
	 * 取一遍，预览与实际的偏差只可能是"点确认的这几秒里回收站又变了"。
	 */
	count?: number;
	bytes?: number;
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

/**
 * 「清理 N 天前」的确认请求：`ids` 留空 —— 真删的目标集合由宿主按 `days` 现算，
 * 客户端在这条路上永远不传具体 id（少一条"客户端说了算"的路径）。
 */
export function requestPurgeOld(days: number, count: number, bytes: number): void {
	dialogStore.set({ kind: "purge-old", ids: [], title: "", days, count, bytes });
}

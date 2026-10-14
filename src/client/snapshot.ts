/**
 * `snapshot` 端点的**模块级缓存**（设置面板重新挂载时先画这一份）。
 *
 * 为什么需要它：设置外壳每次进设置页都是**重新挂载**我们这个 section —— 面板里的
 * `useState` 全是新的，快照必然是 `null`，于是第一帧只能画"读取中…"，等宿主回话之后
 * 才突然长出整张列表。用户看到的就是"进去先没有会话，闪一下才出现"。
 *
 * 有了这份缓存之后：重新进入时第一帧直接用**上一次的快照**画出来（`loading && !snapshot`
 * 那条"空白"分支不会命中），随后那次 `refresh()` 照常在后台把它换成最新的一份
 *（stale-while-revalidate）。也就是说缓存的只是"上一眼"的观感，不改变任何数据的权威性 ——
 * 真正落库的仍是宿主的快照，界面上所有动作也仍然打端点。
 *
 * 失效只有两条路，都不需要 TTL：
 *   1. 每次成功拿到快照（`snapshot` 或任何变更端点的回包）都会覆盖它；
 *   2. `forgetSnapshot()` 供自检造确定初始状态。
 *
 * 变更回包（`MutationResult extends Snapshot`）也往这里写：删除是可以在**面板没挂载**时
 * 发生的（侧边栏行内按钮 / 菜单项 / 撤销 toast），不写的话下次进设置页会先闪一下
 * 那条其实已经不在的会话。
 */
import type { Snapshot } from "../shared/protocol.js";

let last: Snapshot | null = null;

/** 上一次成功拿到的快照；从没拿到过就是 `null`。 */
export function cachedSnapshot(): Snapshot | null {
	return last;
}

/** 记下最新的一份（`snapshot` 与一切变更端点的回包都走这里）。 */
export function rememberSnapshot(value: Snapshot): void {
	last = value;
}

/** 清空缓存（自检用；界面上没有任何一条路需要它）。 */
export function forgetSnapshot(): void {
	last = null;
}

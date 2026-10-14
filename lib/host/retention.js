/**
 * 保留天数 → 截止时间戳：**严格早于**它的条目才算过期。
 *
 * 上限 3650 天（10 年）只是防呆：`days` 来自线协议，客户端算错、或有人手工构造请求时，
 * 别让它退化成"把整个回收站清空"；`NaN` / 负数一律夹到 1 天（而不是 0：0 会让截止时间
 * 变成"此刻"，语义上等于清空）。
 */
export function retentionCutoff(days) {
    const safe = Number.isFinite(days) ? Math.min(Math.max(Math.floor(days), 1), 3650) : 1;
    return Date.now() - safe * 24 * 60 * 60 * 1000;
}
/**
 * 一条回收站条目该不该被"清理 N 天前"带走。
 *
 * 三个条件缺一不可：
 *   - `restorable`：老版本留下的、没有 `__trash.json` 的条目连原 slug 都不知道，
 *     `deletedAt` 也就无从谈起（`listTrash()` 会给它 0）。它们只能由用户在界面上
 *     逐条「永久删除」，绝不能被一个按时间的批量操作顺手带走；
 *   - `deletedAt > 0`：同上，缺删除时间的条目不参与时间判断；
 *   - `deletedAt < cutoff`：**严格**早于截止时间，边界那一条留着。
 */
export function isExpired(row, cutoff) {
    return row.restorable && row.deletedAt > 0 && row.deletedAt < cutoff;
}

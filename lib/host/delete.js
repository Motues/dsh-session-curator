/**
 * 危险操作：**物理删除**（不可恢复）。
 *
 * 为什么不再是"软删除到回收站"：回收站与归档在做同一件事（把会话从侧边栏藏起来、之后还能
 * 找回来），而归档是 DSH 自带的机制、不动磁盘、随时可逆。所以删除就做成**真正的删除**：
 * 删掉 `<DSH_HOME>/sessions/<slug>/<sessionId>/` 与它的投影缓存，不可撤销。想留退路的
 * 用户在确认弹窗里会被明确提示改用归档。
 *
 * 顺序不能随便改（与旧 `purge` 同一条教训）：**先把记账清干净，再删目录**。
 *   - `archivedSessionIds` / `pinnedSessionIds` 是持久化的集合，删除后还留着 id 就是一条
 *     "DSH 一直以为它归档着、界面上又找不到"的永久幽灵；
 *   - 工作区记账（`sessionIds`）同样要摘掉，否则侧边栏的"未分组"里会留一条点不开的幽灵行；
 *   - 目录最后删。万一 `rm` 失败（占用 / 权限），这一项在 `results[]` 里报失败，会话还在
 *     磁盘上，只是已经被取消归档 —— 用户仍然看得到它，可以重试，不会凭空丢数据。
 *
 * 正在跑的会话与**当前正在使用的会话**一律拒绝删除：前者由官方的
 * `workspace/session-activity` 判定（与官方归档同一条判据），后者是
 * `process.env.DSH_SESSION_ID`。
 */
import { promises as fsp } from "node:fs";
import { messageOf } from "./fs-utils.js";
import { projCacheFile } from "./paths.js";
/**
 * 逐项物理删除：会话目录 + 投影缓存，并把归档 / 置顶 / 工作区三处记账清干净。
 *
 * 单项失败只留在 `results[]` 里，不影响其余项（`each()` 的语义）。
 */
export async function deleteSessions(host, ids) {
    const dirs = await host.scanSessionDirs();
    return host.each(ids, async (sessionId) => {
        const steps = [];
        if (sessionId === process.env.DSH_SESSION_ID) {
            throw new Error("这是当前正在使用的会话，不能删除");
        }
        const activity = await host.sessionActivity(sessionId);
        if (activity.length > 0)
            throw new Error("会话正在运行，请先停止它");
        const info = dirs.get(sessionId);
        if (!info)
            throw new Error("找不到会话日志目录（可能已被删除）");
        // 三处记账先清：见文件头"顺序不能随便改"。
        if (host.registry.archivedSessionIds.includes(sessionId)) {
            await host.registry.unarchiveSession(sessionId);
            steps.push("unarchive");
        }
        if (host.registry.pinnedSessionIds.includes(sessionId)) {
            await host.registry.unpinSession(sessionId);
            steps.push("unpin");
        }
        const workspace = host.findWorkspaceOf(sessionId);
        if (workspace) {
            try {
                if (typeof workspace.detachSession === "function") {
                    await workspace.detachSession(sessionId);
                    steps.push("detach");
                }
            }
            catch (error) {
                // 摘不掉记账不该阻止删除：目录没了之后 DSH 自己也会把它清掉。
                steps.push(`detach-failed:${messageOf(error)}`);
            }
        }
        // 会话目录整个删掉（这是唯一不可逆的一步）。
        await fsp.rm(info.dir, { recursive: true, force: true });
        steps.push("delete");
        // 投影缓存是 DSH 自己的文件（`storages/session_projcache/sessions/<id>.json`）：
        // 会话都没了，留着一份标题 / cwd 的缓存只会在下次重建列表时对不上。
        try {
            await fsp.rm(projCacheFile(sessionId), { force: true });
            steps.push("projcache");
        }
        catch {
            // 缓存删不掉不影响会话本身
        }
        return steps;
    });
}

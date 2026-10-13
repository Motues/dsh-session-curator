/**
 * 危险操作：软删除（移入回收站）/ 恢复 / 永久删除。
 *
 * 这个文件里每一条顺序都是踩过事故之后定下来的，动之前先读注释；回归测试在
 * `scripts/smoke.mjs` 的"软删除语义（临时 DSH_HOME）"那一段。
 */
import { existsSync, promises as fsp } from "node:fs";
import { join } from "node:path";
import { messageOf, moveDir } from "./fs-utils.js";
import { META_FILE, PROJ_FILE, projCacheFile, sessionsRoot, trashRoot } from "./paths.js";
/**
 * 软删除：把会话**藏起来**（进归档集合）+ 移出工作区记账 + 搬到回收站（含投影缓存）。
 *
 * 为什么是"归档"而不是"取消归档"：DSH 里**唯一**能让一个会话从所有分组面
 *（侧边栏的工作区分组、**未分组**、置顶）消失的机制，就是 `archivedSessionIds`
 * 这个 registry-global 集合 —— 它的注释原话是 "sessions hidden from every grouping
 * surface"，而且归档**不动工作区记账**，槽位留着，所以恢复时位置不变。
 *
 * 反过来做（先 `unarchiveSession`）必然出幽灵行：取消归档会把会话重新暴露给
 * 客户端那份会话列表（`ctx.sessions.list`），而它的目录虽然已经被我们搬走，
 * 客户端 list 里那条还在 —— 侧边栏 `groupByWorkspace()` 的判定是
 * "在 list 里 && 不属于任何工作区 && 不在归档集合里" → 落进**未分组**。
 * 同时归档集合里已经没有它，等于谁也管不住这条幽灵行了。
 *
 * 原来是否归档记在 `__trash.json` 的 `wasArchived` 里，恢复时照原样还原。
 */
export async function trashSessions(host, ids) {
    await fsp.mkdir(trashRoot(), { recursive: true });
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
        // 必须**趁目录还在**归档：`archiveSession` 要先通过 `sessionKnown()`
        //（live 会话 / 头部索引 / 持久化清单），搬走之后三者都查不到了。
        const wasArchived = host.registry.archivedSessionIds.includes(sessionId);
        if (!wasArchived) {
            try {
                await host.registry.archiveSession(sessionId);
                steps.push("archive");
            }
            catch (error) {
                // 藏不住不该阻止删除：会话可能继续留在侧边栏，但数据照样进回收站。
                steps.push(`archive-failed:${messageOf(error)}`);
            }
        }
        // 置顶的会话也要先取消置顶：否则它的 id 还留在 pinnedSessionIds 里，
        // 搬进回收站之后会同时出现在"已置顶"和"回收站"两个页签。
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
                steps.push(`detach-failed:${messageOf(error)}`);
            }
        }
        const projection = await host.readProjection(sessionId);
        const target = join(trashRoot(), sessionId);
        await fsp.rm(target, { recursive: true, force: true });
        await moveDir(info.dir, target);
        steps.push("move");
        const cached = projCacheFile(sessionId);
        if (existsSync(cached)) {
            try {
                await fsp.rename(cached, join(target, PROJ_FILE));
                steps.push("projcache");
            }
            catch {
                // 缓存搬不动不影响会话本身
            }
        }
        await fsp.writeFile(join(target, META_FILE), JSON.stringify({
            version: 1,
            sessionId,
            slug: info.slug,
            title: projection.title,
            cwd: projection.cwd,
            workspaceId: workspace ? String(workspace.id) : null,
            workspaceTitle: workspace ? workspace.title : null,
            // 删除前是否已经归档 —— 恢复时要照原样还原（老条目没有这个字段，
            // 一律按"没归档过"处理，也就是恢复成普通会话）。
            wasArchived,
            deletedAt: Date.now()
        }, null, 2), "utf8");
        return steps;
    });
}
/**
 * 从回收站恢复；尽力把会话重新挂回原工作区，并把归档状态还原成删除前的样子。
 *
 * `trashSessions()` 会把会话塞进归档集合（藏起来），所以这里必须配对处理：
 *   - 删除前**已经归档**（`wasArchived: true`）→ 保持归档，它就回到"已归档"页签；
 *   - 其余（含老版本写下的、没有这个字段的条目）→ 取消归档，恢复成普通会话。
 * 不还原的话，恢复出来的会话会莫名其妙地"还在已归档里"。
 */
export async function restoreSessions(host, ids) {
    const dirs = await host.scanSessionDirs();
    return host.each(ids, async (sessionId) => {
        const steps = [];
        const source = join(trashRoot(), sessionId);
        if (!existsSync(source))
            throw new Error("回收站里没有这个会话");
        let meta = null;
        try {
            meta = JSON.parse(await fsp.readFile(join(source, META_FILE), "utf8"));
        }
        catch {
            meta = null;
        }
        if (typeof meta?.slug !== "string" || meta.slug === "") {
            throw new Error("缺少回收站元数据，无法确定原目录");
        }
        if (dirs.has(sessionId))
            throw new Error("目标会话目录已存在，请先处理同名会话");
        const target = join(sessionsRoot(), meta.slug, sessionId);
        await moveDir(source, target);
        steps.push("move");
        const cached = join(target, PROJ_FILE);
        if (existsSync(cached)) {
            try {
                await fsp.rename(cached, projCacheFile(sessionId));
                steps.push("projcache");
            }
            catch {
                // 同上，非关键
            }
        }
        try {
            await fsp.rm(join(target, META_FILE), { force: true });
        }
        catch {
            // 元数据残留无害
        }
        // 归档状态先还原，再挂回工作区：attachSession 要读得到会话头（目录已经回来了）。
        if (meta.wasArchived !== true && host.registry.archivedSessionIds.includes(sessionId)) {
            await host.registry.unarchiveSession(sessionId);
            steps.push("unarchive");
        }
        if (typeof meta.cwd === "string" && meta.cwd !== "") {
            try {
                const workspace = await host.registry.resolveByPath(meta.cwd);
                if (workspace && typeof workspace.attachSession === "function") {
                    await workspace.attachSession(sessionId);
                    steps.push("attach");
                }
            }
            catch {
                // 索引要等下次启动才会收录这个会话，挂靠失败不影响恢复
            }
        }
        return steps;
    });
}
/**
 * 永久删除（不可恢复）。
 *
 * 先取消归档：`trashSessions()` 为了让会话从侧边栏消失而把它放进了归档集合，永久删除之后
 * 再没人会去动这条 id —— 留在集合里就是一条**永久幽灵**（DSH 自身会一直以为它归档着，
 * 界面上又找不到它）。
 */
export async function purgeSessions(host, ids) {
    return host.each(ids, async (sessionId) => {
        const target = join(trashRoot(), sessionId);
        if (!existsSync(target))
            throw new Error("回收站里没有这个会话");
        const steps = [];
        if (host.registry.archivedSessionIds.includes(sessionId)) {
            await host.registry.unarchiveSession(sessionId);
            steps.push("unarchive");
        }
        await fsp.rm(target, { recursive: true, force: true });
        steps.push("purge");
        return steps;
    });
}

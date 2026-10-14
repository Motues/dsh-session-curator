/**
 * 危险操作：软删除（移入回收站）/ 恢复 / 永久删除。
 *
 * 这个文件里每一条顺序都是踩过事故之后定下来的，动之前先读注释；回归测试在
 * `scripts/smoke.mjs` 的"软删除语义（临时 DSH_HOME）"那一段。
 *
 * ── `__trash.json`（回收站条目的元数据）──────────────────────────────────
 * 位置：`<DSH_HOME>/storages/session-manager/trash/<sessionId>/__trash.json`，
 * 与会话自己的文件（`session.jsonl` 等）**同级同搬** —— 所以"恢复"就是把整个目录搬回
 * `<DSH_HOME>/sessions/<slug>/<sessionId>/`，元数据跟着回去，搬完再删掉它。
 *
 * **v1**（当前，`TRASH_META_VERSION = 1`）的字段：
 *
 * | 字段 | 类型 | 说明 |
 * | --- | --- | --- |
 * | `version` | `number` | 写这份文件的 schema 版本。**最早那一版没有这个字段**（插件还叫 `dsh-session-manager` 的时代），读的时候按 v1 处理 |
 * | `sessionId` | `string` | 会话 id；与目录名一致，冗余存一份便于人眼排错 |
 * | `slug` | `string` | 原目录 `<DSH_HOME>/sessions/<slug>/`。**恢复的关键字段**：缺失或不是非空字符串就恢复不了，界面会按 `restorable: false` 显示"无法恢复（缺元数据）" |
 * | `title` | `string \| null` | 删除时的标题（只用于展示） |
 * | `cwd` | `string \| null` | 原工作区路径；恢复时拿它去 `resolveByPath()` 把会话挂回去 |
 * | `workspaceId` | `string \| null` | 原工作区 id（展示 / 分组用，恢复**不**依赖它） |
 * | `workspaceTitle` | `string \| null` | 原工作区标题（同上） |
 * | `wasArchived` | `boolean` | 删除前是否已经在归档集合里；恢复时照原样还原。老条目没有这个字段，按 `false` 处理 |
 * | `deletedAt` | `number` | 删除时间（`Date.now()`）。`0` 或缺失 = 认不出删除时间的老条目，**永远不算过期**，只能逐条永久删除（见 `retention.ts`） |
 *
 * **版本约定：加字段不升版**。
 *   1. 读方必须容忍**缺字段**（老条目、以及将来加了字段之后的新条目），逐字段给默认值 ——
 *      正因为如此，"新增一个可选字段"**不需要**动 `version`。
 *   2. 只有**不兼容**的改动（改字段含义、挪位置、不重写就读不对）才 `+1`，并且必须同时
 *      `readTrashMeta()` 里补一段迁移：把老版本升成新版本，再往下走。
 *   3. 读到**比自己新**的 `version` 一律**拒绝**（`readTrashMeta()` 抛错，逐项失败里带原因），
 *      绝不按旧语义硬猜 —— 猜错的代价是"把一个会话恢复进错误的目录"。
 */
import { existsSync, promises as fsp } from "node:fs";
import { join } from "node:path";
import { messageOf, moveDir } from "./fs-utils.js";
import { META_FILE, PROJ_FILE, projCacheFile, sessionsRoot, trashRoot } from "./paths.js";
import { isExpired, retentionCutoff } from "./retention.js";
/** `__trash.json` 当前版本（字段表与版本约定见文件头）。 */
export const TRASH_META_VERSION = 1;
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
        // 写入侧就用 `TrashMeta` 这个类型：schema 改了却忘了改字段表，tsc 当场就红。
        const meta = {
            version: TRASH_META_VERSION,
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
        };
        await fsp.writeFile(join(target, META_FILE), JSON.stringify(meta, null, 2), "utf8");
        return steps;
    });
}
/**
 * 读一条回收站元数据（字段表与版本约定见文件头）。
 *
 * 三种结果：
 *   - 文件不在 / 不是 JSON 对象 / JSON 坏了 → `null`。与"没有元数据"同义：恢复不了，
 *     但列表仍然要能显示它（`listTrash()` 会给它 `deletedAt: 0` / `restorable: false`）。
 *   - `version` 缺失（最早那一版写下的）或 ≤ 当前 → 原样返回，字段由调用方逐个校验。
 *   - `version` **比当前新** → 抛错。语义不可猜，宁可不恢复，也不能把一个会话按旧规则
 *     塞进错误的目录（错误信息会出现在批量操作的逐项失败里）。
 *
 * 迁移放哪：将来真的升到 v2 时，在这里加一段"把 v1 读成 v2 形状"的转换，
 * 然后再 `return`；`version` 的**当前**值只认 `TRASH_META_VERSION`。
 */
export async function readTrashMeta(dir) {
    let line;
    try {
        line = await fsp.readFile(join(dir, META_FILE), "utf8");
    }
    catch {
        return null;
    }
    let parsed;
    try {
        parsed = JSON.parse(line);
    }
    catch {
        return null;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
        return null;
    // 跨 JSON 边界的一次收窄（AGENTS.md §5 允许的那种）：上面已经证明它是个对象。
    const meta = parsed;
    // `version` 缺失 = 最早那版（插件还叫 `dsh-session-manager` 的时代）写下的，按 v1 处理。
    const written = typeof meta.version === "number" ? meta.version : TRASH_META_VERSION;
    if (written > TRASH_META_VERSION) {
        throw new Error(`这条回收站元数据是更新版本的插件写的（version ${written}，本插件只认到 ${TRASH_META_VERSION}）：先升级插件，再恢复`);
    }
    return meta;
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
        // 版本比插件新时这里会抛（原因进逐项失败），别的坏情况一律回 null。
        const meta = await readTrashMeta(source);
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
    return purgeEach(host, ids);
}
/**
 * 「清理 N 天前」：**按时间**批量永久删除。
 *
 * 只认回收站目录里的条目（`purgeEach()` 会再查一次 `existsSync`），并且必须先把
 * `deletedAt` 早于截止时间的条目挑出来 —— 挑的规则与预览共用
 * `retention.ts` 的 `isExpired()`，所以"预览到的那批"就是"真删的那批"。
 *
 * 为什么这里不做静默后台清理：这是**永久删除**，本插件唯一不可撤销的动作。它只能由用户
 * 在界面上点一次、看过预览、再过一道确认弹窗之后发生（客户端侧见配置页的保留策略一行）。
 */
export async function purgeOlderThan(host, days) {
    const cutoff = retentionCutoff(days);
    const rows = await host.listTrash();
    return purgeEach(host, rows.filter((row) => isExpired(row, cutoff)).map((row) => row.sessionId));
}
/**
 * 逐项永久删除的**唯一**实现（`purge` 与 `purge-older-than` 都走它）。
 *
 * 顺序不能改：先 `unarchiveSession` 再 `rm`（理由见上面的注释）。
 */
async function purgeEach(host, ids) {
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

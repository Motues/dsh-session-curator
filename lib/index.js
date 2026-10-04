/**
 * dsh-session-curator — host 半区。
 *
 * 提供三块能力：
 *   1. 会话软删除：先把会话**藏起来**（进 registry-global 的归档集合 —— DSH 里唯一能让它
 *      从侧边栏所有分组面消失的机制，否则它会以"未分组"的幽灵行留在那里），再把它从
 *      工作区记账里摘掉（`Workspace.detachSession`），最后把
 *      `<DSH_HOME>/sessions/<slug>/<sessionId>/` 整个搬到
 *      `<DSH_HOME>/storages/session-manager/trash/<sessionId>/`。可完整恢复。
 *      ⚠️ 目录名 `session-manager` 是**故意保留的旧名**（见下面 TRASH_SUBPATH 的注释）。
 *   2. 回收站管理：列出 / 恢复 / 永久删除。
 *   3. 归档会话管理：列出全部归档会话（标题、目录、体积），支持批量取消归档、置顶，
 *      以及直接删除。归档/取消归档/置顶全部走官方 `ctx.workspaceRegistry`。
 *
 * 对客户端暴露一组挂在共享 `/api` 通道下的精确 Fetch 路由（
 * `ctx.connection.fetch.register`）：信任检查与会话鉴权由 Connection 的 `/api`
 * 前缀路由先做完，所以插件自己不需要任何鉴权代码。
 */
import { promises as fsp, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const name = "dsh-session-curator";
// `connection` 承载 HTTP 面；`webServer` 是硬依赖（Connection 只在 webServer 存在时
// 才挂载 `/api` 通道，没有它插件就不可达）；`workspaceRegistry` 是归档/置顶/记账的来源。
export const inject = ["connection", "webServer", "workspaceRegistry"];

// ── DSH home 解析 ────────────────────────────────────────────────────────
// 这里刻意**不 import** `@deepseek-ai/dsh-home-paths`：那个包只在 DSH 自己的
// node_modules 里，而插件可能以 junction/symlink 形式挂在 profile 下 —— 此时 Node 会
// 按 realpath 解析裸标识符，从插件源码目录向上找不到它，插件就加载不了。语义与那个包
// 一致（`$DSH_HOME` 优先，否则 `~/.dsh`），几行就够，换来的是"插件放哪都能跑"。
function resolveDshHome() {
    const configured = process.env.DSH_HOME;
    if (typeof configured === "string" && configured.trim() !== "") {
        const expanded = configured.trim();
        if (expanded === "~") return homedir();
        if (expanded.startsWith("~/") || expanded.startsWith("~\\")) return resolve(join(homedir(), expanded.slice(2)));
        return resolve(expanded);
    }
    return resolve(join(homedir(), ".dsh"));
}

function dshHomePath(...segments) {
    return join(resolveDshHome(), ...segments);
}

/** DSH 的共享 API 通道：唯一带 Host/Origin 信任栅栏与浏览器会话鉴权的 HTTP 面。 */
const API_CHANNEL = "/api";
/** 频道下属于本插件的路径前缀（`/api/session-curator/<endpoint>`）。 */
const ROUTE_PREFIX = "session-curator";
/** 端点只读 / 只写，一律 POST（Connection 的精确路由按方法集合匹配）。 */
const ROUTE_METHODS = ["POST"];
/**
 * 回收站根目录：`<DSH_HOME>/storages/session-manager/trash`。
 *
 * 这里的 `session-manager` 是**故意不改的旧名**：插件从 `dsh-session-manager` 改名成
 * `dsh-session-curator` 时，回收站里可能还躺着用户已经删掉的会话（本机就有一个）——
 * 改路径会把它们变成孤儿。数据目录用历史名、其余 id 用新名，是权衡后的结果。
 */
const TRASH_SUBPATH = ["storages", "session-manager", "trash"];
const META_FILE = "__trash.json";
const PROJ_FILE = "__projcache.json";

// ── 版本与更新检查 ───────────────────────────────────────────────────────
/**
 * 本地版本：`lib/index.js` 的上一级就是包根（无论插件是装在 `node_modules` 里还是被
 * junction 指过来，`import.meta.url` 都指向真实文件），所以直接读自己的 manifest。
 */
const LOCAL_VERSION = readLocalVersion();

function readLocalVersion() {
    try {
        const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
        return typeof manifest.version === "string" && manifest.version !== "" ? manifest.version : null;
    } catch {
        return null;
    }
}

/**
 * 更新检查：问 npm registry 的 `latest` 标签。
 *
 * 为什么放在**宿主**而不是客户端直接 fetch：客户端那侧要过 CORS / 可能的 CSP 和桌面端网络
 * 策略，宿主本来就是普通 Node，顺便还能做超时与缓存。只读 GET，没有任何副作用。
 */
const UPDATE_REGISTRY = "https://registry.npmjs.org";
/** 10 分钟内复用上次结果：打开配置页不该每次都打 registry。 */
const UPDATE_TTL_MS = 10 * 60 * 1000;
const UPDATE_TIMEOUT_MS = 5000;
let updateCache = null;

/**
 * 宽松 semver 比较：只按数字段比，带 prerelease 后缀的算更低
 * （`0.1.1` > `0.1.1-rc.1`，`0.2.0` > `0.1.9`）。够判断"有没有新版"，不引依赖。
 * 导出是为了让 `scripts/smoke.mjs` 直接单测它（浏览器里用不到）。
 */
export function compareVersions(left, right) {
    const parse = (value) => {
        const [core, ...rest] = String(value).replace(/^v/, "").split("-");
        return { parts: core.split(".").map((part) => Number.parseInt(part, 10) || 0), prerelease: rest.length > 0 };
    };
    const a = parse(left);
    const b = parse(right);
    for (let index = 0; index < Math.max(a.parts.length, b.parts.length); index += 1) {
        const difference = (a.parts[index] ?? 0) - (b.parts[index] ?? 0);
        if (difference !== 0) return difference > 0 ? 1 : -1;
    }
    if (a.prerelease === b.prerelease) return 0;
    return a.prerelease ? -1 : 1;
}

async function checkForUpdate(force) {
    const now = Date.now();
    if (force !== true && updateCache !== null && now - updateCache.at < UPDATE_TTL_MS) return updateCache.value;
    const base = { current: LOCAL_VERSION, latest: null, outdated: false, checkedAt: now };
    let value;
    try {
        const response = await fetch(`${UPDATE_REGISTRY}/${name}/latest`, {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        const latest = typeof body?.version === "string" && body.version !== "" ? body.version : null;
        if (latest === null) throw new Error("registry 没有返回 version 字段");
        value = {
            ...base,
            latest,
            outdated: LOCAL_VERSION !== null && compareVersions(latest, LOCAL_VERSION) > 0,
            checkedAt: Date.now()
        };
    } catch (error) {
        // 离线 / 超时 / 代理不通都走这里：界面照常显示版本号，只是没有更新提示。
        value = { ...base, error: messageOf(error) };
    }
    updateCache = { at: Date.now(), value };
    return value;
}

// ── 文件系统小工具 ───────────────────────────────────────────────────────
function trashRoot() {
    return dshHomePath(...TRASH_SUBPATH);
}

function sessionsRoot() {
    return dshHomePath("sessions");
}

function projCacheFile(sessionId) {
    return dshHomePath("storages", "session_projcache", "sessions", `${sessionId}.json`);
}

function messageOf(error) {
    if (error instanceof Error) return error.message;
    return String(error);
}

/** 跨卷 rename 会抛 EXDEV，退回 copy + rm。 */
async function moveDir(from, to) {
    await fsp.mkdir(dirname(to), { recursive: true });
    try {
        await fsp.rename(from, to);
        return;
    } catch (error) {
        if (error?.code !== "EXDEV") throw error;
    }
    await fsp.cp(from, to, { recursive: true, force: true });
    await fsp.rm(from, { recursive: true, force: true });
}

// ── 会话管理器 ───────────────────────────────────────────────────────────
class SessionManager {
    constructor(ctx) {
        this.ctx = ctx;
    }

    get registry() {
        return this.ctx.workspaceRegistry;
    }

    // ── 只读投影 ─────────────────────────────────────────────────────────
    /** <DSH_HOME>/sessions/<slug>/<sessionId> → { dir, slug } 索引。 */
    async scanSessionDirs() {
        const root = sessionsRoot();
        const map = new Map();
        let slugs;
        try {
            slugs = await fsp.readdir(root, { withFileTypes: true });
        } catch {
            return map;
        }
        for (const slug of slugs) {
            if (!slug.isDirectory()) continue;
            let ids;
            try {
                ids = await fsp.readdir(join(root, slug.name), { withFileTypes: true });
            } catch {
                continue;
            }
            for (const id of ids) {
                if (!id.isDirectory()) continue;
                if (!map.has(id.name)) map.set(id.name, { dir: join(root, slug.name, id.name), slug: slug.name });
            }
        }
        return map;
    }

    /** 投影缓存里的会话元数据（标题 / cwd / 创建时间）。缺文件时返回空字段。 */
    async readProjection(sessionId) {
        try {
            const parsed = JSON.parse(await fsp.readFile(projCacheFile(sessionId), "utf8"));
            const rows = parsed?.record?.rows;
            const identity = parsed?.record?.identity;
            const title = rows?.title?.val;
            return {
                title: typeof title === "string" && title !== "" ? title : null,
                cwd: typeof identity?.cwd === "string" ? identity.cwd : null,
                createdAt: typeof identity?.createdAt === "number" ? identity.createdAt : null
            };
        } catch {
            return { title: null, cwd: null, createdAt: null };
        }
    }

    /** 只统计顶层文件：会话目录里就是那几份日志。 */
    async dirStats(dir) {
        let bytes = 0;
        let files = 0;
        let entries;
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
            return { bytes: 0, files: 0 };
        }
        for (const entry of entries) {
            if (!entry.isFile()) continue;
            try {
                const stat = await fsp.stat(join(dir, entry.name));
                bytes += stat.size;
                files += 1;
            } catch {
                // 竞态：文件刚好消失，忽略
            }
        }
        return { bytes, files };
    }

    findWorkspaceOf(sessionId) {
        for (const workspace of this.registry.list()) {
            const ids = workspace.sessionIds;
            if (Array.isArray(ids) && ids.includes(sessionId)) return workspace;
        }
        return undefined;
    }

    async describeSession(sessionId, dirs) {
        const info = dirs.get(sessionId);
        const projection = await this.readProjection(sessionId);
        const workspace = this.findWorkspaceOf(sessionId);
        const stats = info ? await this.dirStats(info.dir) : { bytes: 0, files: 0 };
        return {
            sessionId,
            title: projection.title ?? (workspace ? workspace.title : null) ?? sessionId,
            cwd: projection.cwd ?? (workspace ? workspace.path : null),
            createdAt: projection.createdAt ?? null,
            workspaceId: workspace ? String(workspace.id) : null,
            workspaceTitle: workspace ? workspace.title : null,
            slug: info ? info.slug : null,
            onDisk: Boolean(info),
            bytes: stats.bytes,
            files: stats.files
        };
    }

    async listTrash() {
        const root = trashRoot();
        let entries;
        try {
            entries = await fsp.readdir(root, { withFileTypes: true });
        } catch {
            return [];
        }
        const rows = [];
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const dir = join(root, entry.name);
            let meta = null;
            try {
                meta = JSON.parse(await fsp.readFile(join(dir, META_FILE), "utf8"));
            } catch {
                meta = null;
            }
            const stats = await this.dirStats(dir);
            rows.push({
                sessionId: entry.name,
                title: typeof meta?.title === "string" && meta.title !== "" ? meta.title : entry.name,
                cwd: typeof meta?.cwd === "string" ? meta.cwd : null,
                slug: typeof meta?.slug === "string" ? meta.slug : null,
                // 与 describeSession 对齐：客户端按"原来的工作区文件夹"分组要用到这两个字段。
                workspaceId: typeof meta?.workspaceId === "string" ? meta.workspaceId : null,
                workspaceTitle: typeof meta?.workspaceTitle === "string" ? meta.workspaceTitle : null,
                deletedAt: typeof meta?.deletedAt === "number" ? meta.deletedAt : 0,
                bytes: stats.bytes,
                files: stats.files,
                restorable: typeof meta?.slug === "string" && meta.slug !== ""
            });
        }
        rows.sort((left, right) => right.deletedAt - left.deletedAt);
        return rows;
    }

    /** 当前归档 / 置顶 / 回收站的完整快照，附带目录位置。 */
    async buildSnapshot() {
        const registry = this.registry;
        const dirs = await this.scanSessionDirs();
        const trashed = await this.listTrash();
        // 回收站条目**只**归回收站页签。删除时我们故意让 id 留在归档集合里（那是 DSH
        // 唯一"从所有分组面消失"的机制，见 trash()），所以这里必须把交集滤掉：
        // 否则同一个会话会同时出现在"已归档"和"回收站"，而"已归档"那条还是没有目录的幽灵行。
        const inTrash = new Set(trashed.map((row) => row.sessionId));
        const archived = [];
        for (const sessionId of registry.archivedSessionIds) {
            // 顺带把"目录已经不在了"的 id 也滤掉：`archivedSessionIds` 是**只增不减**的记账
            //（DSH 自己的注释：目录没了的条目照样留在集合里），而 DSH 的侧边栏只从会话清单里
            // 取行 —— 这种 id 在它那边本来就不显示。列出来只会得到一条 0 B、点不动的幽灵行。
            if (inTrash.has(sessionId) || !dirs.has(sessionId)) continue;
            archived.push(await this.describeSession(sessionId, dirs));
        }
        const pinned = [];
        for (const sessionId of registry.pinnedSessionIds) {
            if (inTrash.has(sessionId) || !dirs.has(sessionId)) continue;
            pinned.push(await this.describeSession(sessionId, dirs));
        }
        let archivedBytes = 0;
        for (const row of archived) archivedBytes += row.bytes;
        let trashBytes = 0;
        for (const row of trashed) trashBytes += row.bytes;
        return {
            dshHome: dshHomePath(),
            version: LOCAL_VERSION,
            trashDir: trashRoot(),
            sessionsDir: sessionsRoot(),
            archived,
            pinned,
            trashed,
            totals: {
                archived: archived.length,
                archivedBytes,
                pinned: pinned.length,
                trashed: trashed.length,
                trashBytes
            }
        };
    }

    // ── 变更操作 ─────────────────────────────────────────────────────────
    snapshot() {
        return this.buildSnapshot();
    }

    /** 逐个执行，单项失败只记录在 results 里，不影响其余项。 */
    async each(ids, action) {
        const results = [];
        for (const sessionId of ids) {
            try {
                const extra = await action(sessionId);
                results.push({ sessionId, ok: true, ...(extra ? { steps: extra } : {}) });
            } catch (error) {
                results.push({ sessionId, ok: false, reason: messageOf(error) });
            }
        }
        return { results, ...(await this.buildSnapshot()) };
    }

    /** `stopActivity` 为 true 时先停掉会话正在跑的工作再归档。 */
    archive(ids, stopActivity) {
        return this.each(ids, (sessionId) => this.registry.archiveSession(sessionId, { stopActivity: Boolean(stopActivity) }));
    }

    unarchive(ids) {
        return this.each(ids, (sessionId) => this.registry.unarchiveSession(sessionId));
    }

    pin(ids) {
        return this.each(ids, (sessionId) => this.registry.pinSession(sessionId));
    }

    unpin(ids) {
        return this.each(ids, (sessionId) => this.registry.unpinSession(sessionId));
    }

    /** 正在跑的会话不允许删除，与官方归档同一条活动判据。 */
    async sessionActivity(sessionId) {
        try {
            const activity = await this.ctx.waterfall("workspace/session-activity", { sessionId }, () => Promise.resolve([]));
            return Array.isArray(activity) ? activity : [];
        } catch {
            return [];
        }
    }

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
    async trash(ids) {
        await fsp.mkdir(trashRoot(), { recursive: true });
        const dirs = await this.scanSessionDirs();
        return this.each(ids, async (sessionId) => {
            const steps = [];
            if (sessionId === process.env.DSH_SESSION_ID) {
                throw new Error("这是当前正在使用的会话，不能删除");
            }
            const activity = await this.sessionActivity(sessionId);
            if (activity.length > 0) throw new Error("会话正在运行，请先停止它");
            const info = dirs.get(sessionId);
            if (!info) throw new Error("找不到会话日志目录（可能已被删除）");

            // 必须**趁目录还在**归档：`archiveSession` 要先通过 `sessionKnown()`
            //（live 会话 / 头部索引 / 持久化清单），搬走之后三者都查不到了。
            const wasArchived = this.registry.archivedSessionIds.includes(sessionId);
            if (!wasArchived) {
                try {
                    await this.registry.archiveSession(sessionId);
                    steps.push("archive");
                } catch (error) {
                    // 藏不住不该阻止删除：会话可能继续留在侧边栏，但数据照样进回收站。
                    steps.push(`archive-failed:${messageOf(error)}`);
                }
            }
            // 置顶的会话也要先取消置顶：否则它的 id 还留在 pinnedSessionIds 里，
            // 搬进回收站之后会同时出现在"已置顶"和"回收站"两个页签。
            if (this.registry.pinnedSessionIds.includes(sessionId)) {
                await this.registry.unpinSession(sessionId);
                steps.push("unpin");
            }
            const workspace = this.findWorkspaceOf(sessionId);
            if (workspace) {
                try {
                    await workspace.detachSession(sessionId);
                    steps.push("detach");
                } catch (error) {
                    steps.push(`detach-failed:${messageOf(error)}`);
                }
            }
            const projection = await this.readProjection(sessionId);

            const target = join(trashRoot(), sessionId);
            await fsp.rm(target, { recursive: true, force: true });
            await moveDir(info.dir, target);
            steps.push("move");

            const cached = projCacheFile(sessionId);
            if (existsSync(cached)) {
                try {
                    await fsp.rename(cached, join(target, PROJ_FILE));
                    steps.push("projcache");
                } catch {
                    // 缓存搬不动不影响会话本身
                }
            }
            await fsp.writeFile(
                join(target, META_FILE),
                JSON.stringify(
                    {
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
                    },
                    null,
                    2
                ),
                "utf8"
            );
            return steps;
        });
    }

    /**
     * 从回收站恢复；尽力把会话重新挂回原工作区，并把归档状态还原成删除前的样子。
     *
     * `trash()` 会把会话塞进归档集合（藏起来），所以这里必须配对处理：
     *   - 删除前**已经归档**（`wasArchived: true`）→ 保持归档，它就回到"已归档"页签；
     *   - 其余（含老版本写下的、没有这个字段的条目）→ 取消归档，恢复成普通会话。
     * 不还原的话，恢复出来的会话会莫名其妙地"还在已归档里"。
     */
    async restore(ids) {
        const dirs = await this.scanSessionDirs();
        return this.each(ids, async (sessionId) => {
            const steps = [];
            const source = join(trashRoot(), sessionId);
            if (!existsSync(source)) throw new Error("回收站里没有这个会话");
            let meta = null;
            try {
                meta = JSON.parse(await fsp.readFile(join(source, META_FILE), "utf8"));
            } catch {
                meta = null;
            }
            if (typeof meta?.slug !== "string" || meta.slug === "") {
                throw new Error("缺少回收站元数据，无法确定原目录");
            }
            if (dirs.has(sessionId)) throw new Error("目标会话目录已存在，请先处理同名会话");

            const target = join(sessionsRoot(), meta.slug, sessionId);
            await moveDir(source, target);
            steps.push("move");

            const cached = join(target, PROJ_FILE);
            if (existsSync(cached)) {
                try {
                    await fsp.rename(cached, projCacheFile(sessionId));
                    steps.push("projcache");
                } catch {
                    // 同上，非关键
                }
            }
            try {
                await fsp.rm(join(target, META_FILE), { force: true });
            } catch {
                // 元数据残留无害
            }

            // 归档状态先还原，再挂回工作区：attachSession 要读得到会话头（目录已经回来了）。
            if (meta.wasArchived !== true && this.registry.archivedSessionIds.includes(sessionId)) {
                await this.registry.unarchiveSession(sessionId);
                steps.push("unarchive");
            }

            if (typeof meta.cwd === "string" && meta.cwd !== "") {
                try {
                    const workspace = await this.registry.resolveByPath(meta.cwd);
                    if (workspace) {
                        await workspace.attachSession(sessionId);
                        steps.push("attach");
                    }
                } catch {
                    // 索引要等下次启动才会收录这个会话，挂靠失败不影响恢复
                }
            }
            return steps;
        });
    }

    /**
     * 永久删除（不可恢复）。
     *
     * 先取消归档：`trash()` 为了让会话从侧边栏消失而把它放进了归档集合，永久删除之后
     * 再没人会去动这条 id —— 留在集合里就是一条**永久幽灵**（DSH 自身会一直以为它归档着，
     * 界面上又找不到它）。
     */
    async purge(ids) {
        return this.each(ids, async (sessionId) => {
            const target = join(trashRoot(), sessionId);
            if (!existsSync(target)) throw new Error("回收站里没有这个会话");
            const steps = [];
            if (this.registry.archivedSessionIds.includes(sessionId)) {
                await this.registry.unarchiveSession(sessionId);
                steps.push("unarchive");
            }
            await fsp.rm(target, { recursive: true, force: true });
            steps.push("purge");
            return steps;
        });
    }

    /** 更新检查：只读，结果在模块级缓存（见 checkForUpdate）。 */
    checkUpdate(force) {
        return checkForUpdate(force);
    }
}

// ── 传输 / 分发 ──────────────────────────────────────────────────────────
/**
 * 为什么**不用** `ctx.connection.rpc.handle()`（踩过的坑，改回去之前先读）：
 *
 * 它内部把路由交给 `owner.effect(() => owner.webServer.register(route))`，而那个
 * `owner` 是 `this.ctx` —— **Connection 服务自己的 ctx**，不是读服务的插件 ctx。
 * cordis 的服务调用会带 shadow（`Context[symbols.shadow]` 指向提供者作用域），所以
 * 服务解析从"提供者的 fiber"开始；Connection 自己的 inject 只有 `["credentials"]`，
 * 于是必然抛：
 *
 *     cannot get property "webServer" without inject
 *     （@deepseek-ai/dsh-client-connection/lib/index.js:656）
 *
 * 结果：插件 fiber 直接变 `failed`、一条路由都没挂上，客户端每个 POST 落到 SPA 静态
 * 兜底，由 `@deepseek-ai/dsh-host-frontend-static` 对非 GET/HEAD 回 **HTTP 405** ——
 * 就是 `transport failure for /session-manager/trash: HTTP 405`。
 * 注意：**在插件自己的 inject 里加 `webServer` 修不了它**，因为报错的那个 ctx 不是插件的。
 *
 * 改走同样由 Connection 公布的 `ctx.connection.fetch.register()`：精确 Fetch 路由挂在
 * 共享 `/api` 前缀下，`admit()`（Host/Origin/`sec-fetch-site` + 浏览器会话 cookie）与
 * 请求体上限都仍由 Connection 的 `/api` 前缀路由先执行，插件依旧零鉴权代码。
 */

/** 一个频道（`/api/session-curator`）：精确路由表按完整 pathname 命中，所以每个端点一条。 */
const ENDPOINTS = {
    snapshot: (manager) => manager.snapshot(),
    archive: (manager, payload) => manager.archive(payload.ids, payload.stopActivity),
    unarchive: (manager, payload) => manager.unarchive(payload.ids),
    pin: (manager, payload) => manager.pin(payload.ids),
    unpin: (manager, payload) => manager.unpin(payload.ids),
    trash: (manager, payload) => manager.trash(payload.ids),
    restore: (manager, payload) => manager.restore(payload.ids),
    purge: (manager, payload) => manager.purge(payload.ids),
    "check-update": (manager, payload) => manager.checkUpdate(payload.force === true)
};

/** 只接受字符串数组；其余一律忽略，避免把宿主路径当 id 传来的越权尝试。 */
function idsOf(payload) {
    return Array.isArray(payload.ids) ? payload.ids.filter((value) => typeof value === "string" && value !== "") : [];
}

/**
 * 一个端点处理器。返回 Connection 的固定信封：处理器自身的业务失败走
 * `{ok:false, error}`，端点内部的逐项失败则留在 `value.results` 里。
 */
async function handle(manager, endpoint, payload) {
    const run = ENDPOINTS[endpoint];
    if (run === undefined) {
        return { ok: false, error: { code: "session-curator/unknown-endpoint", message: `unknown endpoint ${endpoint}`, details: {} } };
    }
    const safe = payload !== null && typeof payload === "object" ? payload : {};
    try {
        return { ok: true, value: await run(manager, { ...safe, ids: idsOf(safe) }) };
    } catch (error) {
        return { ok: false, error: { code: "session-curator/error", message: messageOf(error), details: {} } };
    }
}

/** `{type:'server-response', rpcId, result}` —— 与 Connection 自己回的信封逐字一致。 */
function envelope(rpcId, result) {
    return Response.json({ type: "server-response", rpcId, result });
}

function badRequest(rpcId, message) {
    // 与 Connection 的 `invalidEnvelopeResponse` 一致：坏信封也回 200 + 错误信封，
    // 这样客户端读到的是人话，而不是一个传输层异常。
    return envelope(rpcId ?? "invalid-request", {
        ok: false,
        error: { code: "session-curator/bad-request", message, details: {} }
    });
}

/** `/api` 已在前面做完信任与鉴权，这里只校验信封、分发、回包。 */
async function respond(manager, endpoint, request) {
    let body;
    try {
        body = await request.json();
    } catch {
        return badRequest(null, "body is not JSON");
    }
    const rpcId = body !== null && typeof body === "object" && typeof body.rpcId === "string" ? body.rpcId : null;
    if (rpcId === null || body.type !== "client-request" || typeof body.method !== "string") {
        return badRequest(rpcId, "invalid client-request message");
    }
    const target = `${ROUTE_PREFIX}/${endpoint}`;
    if (body.method !== target) {
        return badRequest(rpcId, `method ${JSON.stringify(body.method)} does not match endpoint ${JSON.stringify(target)}`);
    }
    return envelope(rpcId, await handle(manager, endpoint, body.payload));
}

export function apply(ctx) {
    const manager = new SessionManager(ctx);
    // 只知道"精确路由登记处"这一个面；命名避开全局 fetch。
    const fetchRoutes = ctx.connection.fetch;
    for (const endpoint of Object.keys(ENDPOINTS)) {
        const route = {
            path: `${API_CHANNEL}/${ROUTE_PREFIX}/${endpoint}`,
            methods: ROUTE_METHODS,
            requestBody: "buffered",
            fetch: (request) => respond(manager, endpoint, request)
        };
        // 注册挂在**插件自己的 fiber** 上（`registerFetchRoute` 用的是调用方的
        // `owner.effect`），所以卸载插件时路由会一起摘掉。
        ctx.effect(() => fetchRoutes.register(route), `dsh-session-curator: ${route.path}`);
    }
}

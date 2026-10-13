/**
 * DSH home 解析与插件用到的全部路径。
 *
 * 这里刻意**不 import** `@deepseek-ai/dsh-home-paths`：那个包只在 DSH 自己的
 * node_modules 里，而插件可能以 junction/symlink 形式挂在 profile 下 —— 此时 Node 会
 * 按 realpath 解析裸标识符，从插件源码目录向上找不到它，插件就加载不了。语义与那个包
 * 一致（`$DSH_HOME` 优先，否则 `~/.dsh`），几行就够，换来的是"插件放哪都能跑"。
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";
export function resolveDshHome() {
    const configured = process.env.DSH_HOME;
    if (typeof configured === "string" && configured.trim() !== "") {
        const expanded = configured.trim();
        if (expanded === "~")
            return homedir();
        if (expanded.startsWith("~/") || expanded.startsWith("~\\"))
            return resolve(join(homedir(), expanded.slice(2)));
        return resolve(expanded);
    }
    return resolve(join(homedir(), ".dsh"));
}
/** 每次都重新解析：`smoke.mjs` 会在同一进程里换掉 `DSH_HOME` 来用临时 home。 */
export function dshHomePath(...segments) {
    return join(resolveDshHome(), ...segments);
}
/**
 * 回收站根目录：`<DSH_HOME>/storages/session-manager/trash`。
 *
 * 这里的 `session-manager` 是**故意不改的旧名**：插件从 `dsh-session-manager` 改名成
 * `dsh-session-curator` 时，回收站里可能还躺着用户已经删掉的会话（本机就有一个）——
 * 改路径会把它们变成孤儿。数据目录用历史名、其余 id 用新名，是权衡后的结果。
 */
export const TRASH_SUBPATH = ["storages", "session-manager", "trash"];
/** 回收站条目的元数据：原 slug / cwd / 标题 / 删除时间 / 删除前是否已归档。 */
export const META_FILE = "__trash.json";
/** 从投影缓存搬进来的那份文件（恢复时要搬回原位）。 */
export const PROJ_FILE = "__projcache.json";
export function trashRoot() {
    return dshHomePath(...TRASH_SUBPATH);
}
export function sessionsRoot() {
    return dshHomePath("sessions");
}
export function projCacheFile(sessionId) {
    return dshHomePath("storages", "session_projcache", "sessions", `${sessionId}.json`);
}

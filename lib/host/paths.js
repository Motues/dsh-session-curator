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
 * 历史遗留：本插件 0.2.0 之前把"软删除"的会话搬到
 * `<DSH_HOME>/storages/session-manager/trash`（目录名 `session-manager` 是更早的包名）。
 * 回收站功能已在 0.3.0 移除，删除改成物理删除，所以插件**不再读写**那个目录：
 * 里面可能还有用户当年软删除的会话，插件不主动迁移也不删除它们；需要时人工把
 * `trash/<sessionId>/` 搬回 `sessions/<slug>/<sessionId>/` 即可。
 */
export function sessionsRoot() {
    return dshHomePath("sessions");
}
export function projCacheFile(sessionId) {
    return dshHomePath("storages", "session_projcache", "sessions", `${sessionId}.json`);
}

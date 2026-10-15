/**
 * dsh-session-curator — host 半区入口。
 *
 * 提供三块能力：
 *   1. 会话删除：**物理删除**（不可恢复）—— 先清掉归档 / 置顶 / 工作区三处记账，再删掉
 *      `<DSH_HOME>/sessions/<slug>/<sessionId>/` 与它的投影缓存。想留退路的用户走归档：
 *      归档同样能让会话从侧边栏消失，而且随时能找回来。
 *   2. 归档会话管理：列出全部归档会话（标题、目录、体积），支持批量取消归档、置顶、删除。
 *   3. 置顶会话管理：同一套列表与动作；归档 / 取消归档 / 置顶全部走官方 `ctx.workspaceRegistry`。
 *      另有三个辅助端点：磁盘占用视图（只读）、复制路径 / 在资源管理器中显示、更新检查。
 *
 * 对客户端暴露一组挂在共享 `/api` 通道下的精确 Fetch 路由（
 * `ctx.connection.fetch.register`）：信任检查与会话鉴权由 Connection 的 `/api`
 * 前缀路由先做完，所以插件自己不需要任何鉴权代码。
 *
 * 源码在 `src/`（TypeScript），`lib/` 是构建产物（`pnpm run build`），DSH 加载的是后者。
 */
import { SessionManager } from "./host/session-manager.js";
import { registerRoutes } from "./host/routes.js";
import { PLUGIN_NAME } from "./host/manifest.js";
/** 插件名（DSH 的插件 id，同时也是 npm 包名）。 */
export const name = PLUGIN_NAME;
// `connection` 承载 HTTP 面；`webServer` 是硬依赖（Connection 只在 webServer 存在时
// 才挂载 `/api` 通道，没有它插件就不可达）；`workspaceRegistry` 是归档/置顶/记账的来源。
export const inject = ["connection", "webServer", "workspaceRegistry"];
export function apply(ctx) {
    const manager = new SessionManager(ctx);
    registerRoutes(ctx, manager);
}
// 纯函数 / 纯工具，给 `scripts/smoke.mjs` 直接单测（插件运行时用不到）。
export { compareVersions } from "./host/update.js";
export { dirStats, forgetDirStats } from "./host/fs-utils.js";
// `open` 的路径校验单独导出：自检要直接断言那道判据，不必真的去调系统 shell。
export { insideRoot } from "./host/open.js";

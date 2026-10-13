/**
 * 版本号与插件名：都从**自己的 manifest** 读。
 *
 * 路径按编译后的位置算：本文件编译成 `lib/host/manifest.js`，所以包根是它的上两级
 * （无论插件是装在 `node_modules` 里还是被 junction 指过来，`import.meta.url` 都指向
 * 真实文件）。名字用字面量而不是读 manifest：DSH 拿它当插件 id，一旦 manifest 读失败
 * 也必须还是对的；版本号读不到就回 `null`（界面上显示成 "—"），不影响加载。
 */
import { readFileSync } from "node:fs";
/** 插件名 == DSH 的插件 id == npm 包名。 */
export const PLUGIN_NAME = "dsh-session-curator";
function readLocalVersion() {
    try {
        const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
        return typeof manifest?.version === "string" && manifest.version !== "" ? manifest.version : null;
    }
    catch {
        return null;
    }
}
/** 本地版本（`package.json` 的 `version`）。 */
export const LOCAL_VERSION = readLocalVersion();

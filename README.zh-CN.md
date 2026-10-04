# dsh-session-curator

[English](README.md) | **中文**

给 DSH（DeepSeek Harness）补上**删除会话**与**归档会话管理**的插件。

官方 Host 服务只有 `archiveSession` / `unarchiveSession` / `pinSession` / `unpinSession`，
没有任何删除会话的 API，所以这个插件自己做文件级操作，并把"删除"做成**可完整恢复的软删除**。

## 能力

| 位置 | 内容 |
| --- | --- |
| 会话行 `⋯` 菜单（`session-curator.delete`，order 500） | **删除会话** → 确认后移入回收站 |
| 设置 → **会话管理**（section id 借 `archived-sessions`，order 45） | 三个页签：**已归档 / 已置顶 / 回收站**，默认按**原来的工作区文件夹**分组，支持逐行与批量操作 |
| 全框浮层（`session-curator.dialog`，order 60） | 删除 / 永久删除的确认弹窗（永久删除需勾选"我明白这无法撤销"） |

设置页每行右侧只有一个 `⋯` 菜单：已归档 = 取消归档 / 置顶 / 移入回收站，回收站 = 恢复 / 永久删除；
文件夹那一行的右侧小按钮一次勾选整个工作区。行内显示标题、体积与文件数、创建（或删除）时间。

## 安装

```powershell
# 1) 从 npm 装（最稳）
plugin_manager  install_bundle  target: dsh-session-curator
#    或：dsh plugin add dsh-session-curator

# 2) 从 GitHub 装
plugin_manager  install_bundle  target: github:Motues/dsh-session-curator
```

手动装（离线 / 压缩包）：

```powershell
$src = "解压出来的 dsh-session-curator 目录"
$dst = "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-session-curator"
Remove-Item $dst -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item $src $dst -Recurse -Force
# 再把 "dsh-session-curator" 追加进 profile package.json 的 dsh.profile.bundles，然后重启 DSH
```

> ⚠️ **声明了 bundle 但磁盘上缺包会让整个启动崩掉**（boot loader 在第一个解析不到的 bundle
> 名字上直接失败，桌面窗口根本不开）。卸载时必须**同时**删掉 `node_modules` 里的目录和
> `dsh.profile.bundles` 里的那一行。

插件是"免构建"的：`lib/index.js` 是普通 ESM 宿主插件，`lib/client.js` 是手写的
`window.__ModuleLoader__.load(...)` 束，**零 npm 依赖**，装进去就能用。

## 安全模型

- **软删除**：会话目录整体搬到 `<DSH_HOME>/storages/session-manager/trash/<sessionId>/`，
  并写入 `__trash.json`（原 slug、原 cwd、标题、删除时间）与原来的投影缓存 `__projcache.json`。
  恢复时按 slug 搬回 `<DSH_HOME>/sessions/<slug>/<sessionId>/`，并尽力用
  `registry.resolveByPath(cwd)` + `attachSession` 把会话挂回原工作区。
- **回收站目录故意沿用旧名 `session-manager`**：里面已有真实数据（真实删除过的会话），
  改路径会把它们变成孤儿。代码里带 ⚠️ 注释；请勿"顺手改名"。
- **记账一致**：删除时调 `Workspace.detachSession(sessionId)`；归档中的先 `unarchiveSession`、
  **置顶中的先 `unpinSession`**（否则 id 留在 `pinnedSessionIds` 里，会同时出现在"已置顶"和
  "回收站"两个页签），所以恢复后能回到原位。
- **不用 `<DSH_HOME>/sessions-trash`**：那个名字有被会话扫描器以 `sessions*` 形态误收的风险。
- **拒绝删除正在运行的会话**：走与官方归档同一条活动判据
  `ctx.waterfall("workspace/session-activity", …)`；另用 `DSH_SESSION_ID` 拦住"删除当前会话"。
- **永久删除只对回收站条目开放**，且需显式勾选确认。

## 实现上不得不这么做的几点（改之前先读）

1. **零裸标识符导入。** `$DSH_HOME` → 否则 `~/.dsh` 的解析在 `lib/index.js` 里内联实现，
   刻意不 `import '@deepseek-ai/dsh-home-paths'`：那个包只存在于 DSH 自己的 `node_modules`，
   而插件常以 junction / symlink 出现在 profile 下，此时 Node 按 **realpath** 解析裸标识符会找不到，
   直接 `Cannot find package …`，插件加载不了。零导入后"放哪都能跑"。
2. **不用 `ctx.connection.rpc.handle()`，改用 `ctx.connection.fetch.register()`。** 踩得最狠的坑：
   `rpc.handle()` 内部 `owner.effect(...)` 的 owner 是 **Connection 服务自己的 ctx**（它的 inject
   只有 `["credentials"]`），必然抛 `cannot get property "webServer" without inject`；结果插件 fiber
   `failed`、一条路由都没挂上，客户端每个 POST 落到 SPA 静态兜底，被回 **HTTP 405** ——
   也就是当年那条 `transport failure for /session-manager/trash: HTTP 405`（真实报错原文，保留不改）。
   在插件自己的 inject 里加 `webServer` **修不了**（报错的 ctx 不是插件的）。
   现在每个端点在共享 `/api` 通道下注册一条**精确 Fetch 路由** `/api/session-curator/<endpoint>`：
   Host/Origin/`sec-fetch-site` 信任检查、浏览器会话 cookie 鉴权和请求体上限仍由 Connection 的
   `/api` 前缀路由先执行，插件依旧零鉴权代码；而路由注册挂在**插件自己的 fiber** 上，卸载即摘掉。
3. **客户端不依赖任何 Cordis 服务（但优先用官方的）。** 优先
   `ctx.get('connection').rpc.call('/api', 'session-curator/<endpoint>', payload)`；拿不到时退回手写
   `fetch`，逐字复刻 Connection 的线协议。坏信封一律回 **200 + 错误信封**，客户端读到的是人话而不是
   传输层异常。**信任栅栏与会话鉴权始终在宿主侧生效。**
4. **`shell.overlay` 是无 owner props 的 frame-wide 浮层**，是全局确认弹窗的正确选址。
5. **菜单行是 `MenuItemButton` + `onSelect`**（不是 `onClick`），且"关不关菜单是 owner 的决定"，
   所以动作里要自己调 `useMenuOpenState()` 拿到的 `setOpen(false)`。

## 设置页导航图标为什么是"借"的

设置外壳的 `navIcon(id)` 是**按 section id 查表**，表里只有 `account` / `models` /
`agent-presets` / `plugins` / `archived-sessions`，其余回落默认齿轮。表里唯一没人用的
`archived-sessions` 语义刚好贴合本插件，所以借用了它，并且**先查槽位账本**：一旦 DSH 自己注册了
`archived-sessions`，插件会自动退回自己的 id（齿轮图标）。不借的话，把 `lib/client.js` 里
`apply()` 的 `id: sectionIdFor(ctx)` 改成 `id: SECTION_ID` 即可。

## 热更新的边界（实测）

- **客户端半区能热更新**：`dsh-client-hmr` 按 mtime/size 算 revision，改 `lib/client.js` 后刷新页面即可。
- **宿主半区不能热更新**：Node 的 ESM 模块缓存**按 URL 缓存**，改 `lib/index.js` **必须重启 DSH**。
- `cordis.patch.yml` 故意保持纯 `- insert:` 形状，因为 dshmarket 的热挂载只接受这种形状。

## HTTP API

共享 `/api` 通道，全部 `POST` + `requestBody: 'buffered'`，路由为 `/api/session-curator/<endpoint>`：

| endpoint | payload | 返回 |
| --- | --- | --- |
| `snapshot` | `{}` | `{ dshHome, trashDir, sessionsDir, archived[], pinned[], trashed[], totals{} }` |
| `archive` | `{ ids, stopActivity }` | `{ results[], ...snapshot }` |
| `unarchive` / `pin` / `unpin` | `{ ids }` | `{ results[], ...snapshot }` |
| `trash` | `{ ids }` | `{ results[], ...snapshot }` |
| `restore` | `{ ids }` | `{ results[], ...snapshot }` |
| `purge` | `{ ids }` | `{ results[], ...snapshot }` |

请求体是 Connection 的线协议信封
`{ type:'client-request', rpcId, method:'session-curator/<endpoint>', payload }`；
`method` 与路由不符或信封坏掉时回 **200 + 错误信封**（错误码 `session-curator/*`），不抛传输异常。
`results[]` 是逐项 `{ sessionId, ok }` 或 `{ sessionId, ok:false, reason }`，单项失败不影响其余项。
`ids` 只接受字符串数组，其余按空数组处理。

> 排障：命令行裸探 `/api/*` 一律 401（信任栅栏先于路由匹配），**分辨不出**路由是否存在；
> 路由在不在只能在已登录的页面里问（README 英文版的"Troubleshooting"一节有控制台片段）。

## 自检（不需要 DSH 在跑）

```powershell
npm test                       # = 下面三条按顺序跑
node scripts/smoke.mjs         # 领域逻辑 + 线协议（假 ctx + 真 Request + 真文件系统）
node scripts/activation.mjs    # 宿主半区激活（真 cordis，从 app.asar 抽出）+ manifest 元数据
node scripts/client.mjs        # 客户端半区：分组纯逻辑 + 迷你 React 渲染设置面板
```

本机实测：`client.mjs` **59/59**、`smoke.mjs` **14/14**、`activation.mjs` **17/17**。
`activation.mjs` 找不到 `app.asar` 时打印 SKIP 退出，可用 `$env:DSH_APP_ASAR` 指定。

## 目录结构

```
dsh-session-curator/
├── package.json          # dsh.bundle.patch / dsh.client / icon / locale exports
├── cordis.patch.yml      # 纯 - insert 形状，可被 dshmarket 热挂载
├── icon.svg              # 插件插画（36 网格、自带着色，卡片用 <img> 渲染）
├── locale/{zh,en}.json   # 卡片标题 / 描述
├── lib/index.js          # 宿主半区：文件级软删除 + 归档管理 + /api 精确 Fetch 路由
├── lib/client.js         # 客户端半区：菜单项 + 确认弹窗 + 设置面板
└── scripts/*.mjs         # 三个自检
```

## 名字的历史

原名 `dsh-session-manager`，在 npm 上已被占用（lesterq 的 0.6.2，同赛道且功能更多；
`dsh-session-hub` / `dsh-sessions` / `dsh-session-trash` / `dsh-session-organizer` 也都已被占），
因此正式发布前改名为 **`dsh-session-curator`**：包名、`cordis.patch.yml` 的 `id`/`name`、
RPC 路由前缀、错误码、locale NS、客户端模块 id、slot id 全部用新名。

两处**故意保留旧名**：回收站目录 `<DSH_HOME>/storages/session-manager/trash`（有真实数据），
以及历史报错原文 `transport failure for /session-manager/trash: HTTP 405`（改了就不真实了）。

## 兼容性

```json
"engines": { "node": ">=20", "dsh": ">=0.2.0-rc.2 <0.2.1-0" }
```

只在实测过的宿主版本上声明兼容；peer 只列真绑定到的接口面，且**全部 `optional: true`**
（这些 `@deepseek-ai/*` 由运行时注入、从不发 npm，不标 optional 会让 pnpm 去 registry 找它们并 404）。
只在 Windows 上实测过，所以没写 `os` 限制。

## License

[MIT](LICENSE)

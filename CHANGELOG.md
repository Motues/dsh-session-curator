# 更新日志

> 格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)（`新增` = Added、`变更` = Changed、
> `移除` = Removed、`修复` = Fixed、`内部` = 只有贡献者感知的改动），版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。
>
> 每一条都写**用户能感知的变化**；纯内部的事情（构建、自检、CI、发布流程）收在各自的 `内部` 小节里。
> `scripts/release.mjs` 会按 `## [<版本>]` 这个标题格式取出对应小节，作为 GitHub Release 的正文 ——
> 发版时把 `Unreleased` 改成 `## [X.Y.Z] - YYYY-MM-DD` 再提交即可。

## [Unreleased]

### 内部

- **删除 CI**（`.github/workflows/ci.yml`）：发布前自己本地检查即可。原来那道"`lib/` 必须和
  `src/` 同步"的闸（CI 的第 4 步 `git diff --exit-code -- lib/`）挪到**发布前**：新增
  `scripts/lib-sync.mjs` 与 `pnpm run check:lib`，`prepublishOnly` 变成
  `node scripts/lib-sync.mjs && pnpm test` —— 改了 `src/` 忘了 `pnpm run build` 就发不出去。
  随之失去的自动检查：lockfile 与 `package.json` 是否一致（原来靠 `pnpm install --frozen-lockfile`）。
- 修掉一条只在 Linux 上挂的自检断言（`scripts/smoke.mjs` 的路径守卫，写死了 Windows 反斜杠，
  曾让 v0.2.0 那次 CI 跑成 `73/74`）；只动 `scripts/`，已发布的 0.2.0 内容不受影响。

## [0.2.0] - 2026-10-14

### 新增

- **侧边栏会话行 hover 卡片**补一节属于本插件的磁盘事实：体积 / 文件数 / 原目录 / 是否在回收站（宿主新增
  `describe` 端点，30 秒 TTL 缓存 + 并发去重）。
- **行内「移入回收站」按钮**：会话行 hover 时直接删，不必点开 `⋯` 再点一次；形状与官方归档 / 置顶按钮一致
  （16×16 朴素按钮、透明底，只换前景色）。
- **删除后的「撤销」提示**：软删除成功给 5 秒撤销机会，撤销走 `restore`；失败只把原因写在同一条提示里。
- `⋯` 菜单新增**复制路径** / **在资源管理器中显示**（新增 `open` 端点；路径**只能**由宿主算，客户端不传路径）。
- 会话面板新增**搜索框**与**时间过滤**（全部 / 最近 7 天），只影响显示 —— 计数、勾选与批量动作仍按整个页签算。
- 分组标题新增**「整个工作区」菜单**：一次归档 / 移入回收站的范围**跨三个页签**；工作区里有正在跑的会话时危险项禁用。
- **「运行中」胶囊**：宿主用官方 `workspace/session-activity` 判定，快照里给出 `activeSessionIds`，正在跑的会话
  在列表与工作区动作里都**预先禁用**危险项（不用等点下去才回一句"请先停止它"）。
- 新增**磁盘占用页签**（`usage` 端点，只读）：整机聚合 + 按工作区横条 + 「最占地方的会话」/「最久没打开的会话」
  两个榜单，榜单每行可直接归档；页签自带只重拉这一份数据的刷新按钮。
- **回收站保留策略**：保留天数下拉（7 / 30 / 90 天，或 1–3650 的自定义值）+ 「将删除 N 个会话 · X MB」预览
  （`trash-stats`）+ 「清理 N 天前」（`purge-older-than`）。**永不自动执行**：每次都要先看预览、再过一道
  需要勾"我明白这无法撤销"的确认弹窗。

### 变更

- 会话面板从 3 个页签扩成 **5 个**：已归档 / 已置顶 / 回收站 / 磁盘占用 / 配置。
- 配置页的**排序**从分段控件改成**下拉**（5 档：原顺序 / 标题 / 体积 / 创建时间 / 删除时间）；下拉的选中
  对勾由 `Menu` 画在**行尾**，与 DSH 自己的菜单一致。
- 「已归档」页签每行 `⋯` 菜单的第三项：原来的"永久删除"走的是 `purge`，而归档会话不在回收站 ——
  点下去**只会报"回收站里没有这个会话"**；现在改成真正可用的「移入回收站」（`trash`，随时能恢复）。
- 端点从 9 条涨到 **14 条**（新增 `describe` / `trash-stats` / `purge-older-than` / `usage` / `open`）。
- 包管理器从 npm 换成 **pnpm 11**：`pnpm-lock.yaml` 与 `pnpm-workspace.yaml` 进 git，`package-lock.json` 删除；
  贡献者命令相应改成 `pnpm install` / `pnpm run build`。

### 修复

- 磁盘占用榜单上**已归档**的会话右侧按钮仍然是「归档」—— 归档集合是幂等的，再点一次既不报错也不改变任何东西，
  只能被当成"点了没反应"；现在改成「取消归档」，并在动作完成后**重拉一次占用视图**（`usage` 不在快照里，
  不重拉那行的状态胶囊还是旧的）。
- 每次进设置页都会先空白、闪一下"读取中…"才出现会话：设置外壳每次进来都是**重新挂载**，快照从 `null` 起步。
  现在有一份模块级缓存（`src/client/snapshot.ts`），首帧直接画上一份，后台照常刷新；变更端点的回包也顺手写进缓存。
- 下拉的选中对勾画在文字**前面**（`MenuItemButton` 的 `icon` 位置固定），与 DSH 其它菜单不一致 —— 改到行尾。

### 内部

- 新增 **CI**（`.github/workflows/ci.yml`）：`pnpm install --frozen-lockfile` → `pnpm run check` → `pnpm test`
  → `git diff --exit-code -- lib/`。最后一道是"改了 `src/` 忘了重新构建 `lib/`"这个**静默事故**唯一的自动闸
  （构建是确定性的：同输入同字节）。runner 上没有 DSH，`activation.mjs` 会打印 SKIP —— 那一项只在真机上有效。
- `scripts/smoke.mjs` 在 `<DSH_HOME>/storages/workspace.json` **不存在**时降级成空表（CI runner / 没装过 DSH
  的机器），别的错误照旧抛；本仓库的断言不依赖真实数据。
- 引入 **Prettier**（`pnpm run format` / `format:check`，后者纳入 `pnpm run check`）：Tab 缩进、双引号、
  无尾逗号、`printWidth` 140、忽略 `lib/` 与 `*.md`。
- 新增 `CHANGELOG.md` 与 `scripts/release.mjs`（校验干净树 + 跑自检 + 比对 registry 上的 shasum → 打 tag
  并推送 → 用 `GITHUB_TOKEN` 调 REST 建 Release）。发布包不再带上 `scripts/`（`files` 白名单收细）。
- `__trash.json` 补上正式 schema 说明与 `version` 迁移约定（`src/host/trash.ts` 头部注释）。

## [0.1.2] - 2026-10-13

### 变更

- 源码转成 **TypeScript 多文件**（`src/`，宿主半区 `tsc`、客户端半区 esbuild 打回单文件），构建产物 `lib/`
  提交进仓库 —— 安装方仍然免构建、零运行时依赖。
- 新增配置项**分组默认状态**（展开 / 折叠）：没手动点过的文件夹跟随它，手动点过的保留手动状态。

### 修复

- 分组标题上的路径一长，右侧「全选」按钮会被挤窄、文字折成两行；现在按钮完全不参与收缩，路径自己截断。

## [0.1.1] - 2026-10-04

### 新增

- 设置页新增**会话管理**面板与**配置页**（默认页签 / 按工作区分组 / 侧边栏显示已归档 / 行内显示体积与文件数）。

### 修复

- 软删除不再在侧边栏「未分组」里留下幽灵行：删之前先归档（DSH 里唯一能让会话从所有分组面消失的机制），
  恢复时按 `__trash.json` 里的 `wasArchived` 照原样还原。

## [0.1.0] - 2026-10-04

### 新增

- 首个版本：会话行 `⋯` 菜单里的**删除会话**（软删除到回收站）+ 设置页的**已归档 / 已置顶 / 回收站**三个页签，
  按会话原来的工作区文件夹分组，支持恢复与永久删除；永久删除需要勾"我明白这无法撤销"。
- 确认弹窗（`shell.overlay`）与按会话原始目录归组的分组栏。

[Unreleased]: https://github.com/Motues/dsh-session-curator/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Motues/dsh-session-curator/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/Motues/dsh-session-curator/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Motues/dsh-session-curator/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Motues/dsh-session-curator/releases/tag/v0.1.0

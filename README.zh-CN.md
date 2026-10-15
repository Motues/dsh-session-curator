# dsh-session-curator

[English](README.md) | **中文**

给 DSH（DeepSeek Harness）补上**删除会话**与**归档会话管理**的插件。

DSH 能归档和置顶会话，却没有删除会话的 API。这个插件自己做文件级操作，删除是**真正的物理删除**：会话目录连同投影缓存一起从磁盘移除。如果想以后还能找回，请改用**归档** —— 归档同样能让会话从侧边栏消失，而且随时可以恢复。

## 能力

| 位置 | 内容 |
| --- | --- |
| 会话行 `⋯` 菜单 | **删除会话** —— 确认后从磁盘永久删除 |
| 设置 → **会话管理** | 两个页签：**已归档 / 已置顶**，按会话原来的工作区文件夹分组，支持逐行与批量操作 |
| 设置 → **会话管理** → **配置** | 基础设置（默认页签 / 分组 / **侧边栏是否显示已归档** / 行内信息 / 排序）、当前版本号，以及 npm 上有新版本时的升级提示与命令 |
| 确认弹窗 | 物理删除：写明"不可恢复"并提示改用「归档」，需要勾选"我明白这无法撤销" |
| 磁盘占用页签 | 只读的占用合计 + 最占地方 / 最久没打开的榜单，榜单每行可直接归档 |

删除不可逆，且绝不会碰正在运行、或当前正在使用的会话。想留退路就用归档。

## 安装

```powershell
# desktop profile
dsh plugin --profile desktop add dsh-session-curator

# web profile
dsh plugin --profile web add dsh-session-curator
```

从 GitHub 装（不走 npm）：

```powershell
dsh plugin --profile desktop add github:Motues/dsh-session-curator
```

这条命令在那个 profile 目录里跑 pnpm，并把这个包同时记进 `dependencies` 和 `dsh.profile.bundles`。宿主半区需要重启 DSH 生效，客户端半区刷新页面即可。

发布出去的包零运行时依赖、安装方无需构建：`lib/` 就是普通 ESM JavaScript（`lib/index.js` 宿主半区，`lib/client.js` 客户端束）。源码是 `src/` 下的 TypeScript：贡献者 `pnpm install` 一次，再用`pnpm run build`（宿主半区走 tsc、客户端束走 esbuild）重新生成 `lib/`。

## 许可

[MIT](LICENSE)

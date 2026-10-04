# dsh-session-curator

[English](README.md) | **中文**

给 DSH（DeepSeek Harness）补上**删除会话**与**归档会话管理**的插件。

DSH 能归档和置顶会话，却没有删除会话的 API。这个插件自己做文件级操作，并把"删除"做成
**可完整恢复的软删除**：会话目录连同元数据一起移入回收站，恢复时能回到原来的工作区。

## 能力

| 位置 | 内容 |
| --- | --- |
| 会话行 `⋯` 菜单 | **删除会话** —— 确认后移入回收站 |
| 设置 → **会话管理** | 三个页签：**已归档 / 已置顶 / 回收站**，按会话原来的工作区文件夹分组，支持逐行与批量操作 |
| 设置 → **会话管理** → **配置** | 基础设置（默认页签 / 分组 / **侧边栏是否显示已归档** / 行内信息 / 排序）、当前版本号，以及 npm 上有新版本时的升级提示与命令 |
| 确认弹窗 | 删除与永久删除（永久删除需要勾选"我明白这无法撤销"） |

删除始终可逆：回收站里的每条记录都保留原来的工作区文件夹、标题和删除时间；正在运行的会话
不会被删除。

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

这条命令在那个 profile 目录里跑 pnpm，并把这个包同时记进 `dependencies` 和
`dsh.profile.bundles`。宿主半区需要重启 DSH 生效，客户端半区刷新页面即可。

插件免构建、零 npm 依赖：`lib/index.js` 是普通 ESM 宿主插件，`lib/client.js` 是手写的客户端束。

## 许可

[MIT](LICENSE)

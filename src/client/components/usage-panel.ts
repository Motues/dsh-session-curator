/**
 * 磁盘占用视图（独立页签里的一块，只读）。
 *
 * 数据来自 `usage` 端点：宿主扫一遍 `<DSH_HOME>/sessions`，回**聚合 + 两个榜单**。
 * 为什么不在这个组件里从快照算：快照只有"已归档 / 已置顶"两个集合，正在用的
 * 普通会话根本不在里面 —— 而"哪些会话最占地方"恰恰要问全部。
 *
 * 这一块也是"建议归档"的入口：榜单上的每一行都能直接点「归档」归档掉。
 * 正在跑的会话不给点（归档会先停掉它的工作）。
 *
 * 已经归档的行给的是**「取消归档」**而不是「归档」：归档集合是幂等的，再点一次「归档」
 * 既不报错也不改变任何东西 —— 点了没反应只能被当成插件坏了。取消归档是无害动作，
 * 所以正在跑的归档会话也给点（与「已归档」页签里那一项同样不禁用）。
 */
import * as React from "react";
import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import { formatBytes, formatTime } from "../format.js";
import { text, type TFn } from "../i18n.js";
import { S } from "../styles.js";
import type { Usage, UsageRow } from "../../shared/protocol.js";

export interface UsagePanelProps {
	t: TFn;
	usage: Usage | null;
	loading: boolean;
	error: string | null;
	busy: boolean;
	/** 点某一行的「归档」：交给面板去打 `archive`（与列表里的动作同一个端点）。 */
	onArchive(sessionId: string): void;
	/** 点某一行的「取消归档」：已归档的行不能还摆着「归档」（同一个 `unarchive` 端点）。 */
	onUnarchive(sessionId: string): void;
}

/**
 * 一行榜单：标题 + 体积/时间 + 状态胶囊 + 动作按钮。
 *
 * 刻意写成**普通函数**而不是 React 组件：它只在 `UsagePanel` 里被调用一次，写成组件会多一层
 * 元素嵌套 —— 而自检用的迷你渲染器**不递归组件**（只 `draw` 最外层），多一层就断言不到
 * 里面的文字（`scripts/client.mjs` 的"usage view lists …"那条就是这么发现的）。
 */
function usageRow(
	t: TFn,
	row: UsageRow,
	busy: boolean,
	onArchive: (sessionId: string) => void,
	onUnarchive: (sessionId: string) => void
): React.ReactElement {
	const badges: { key: string; label: string; style: unknown }[] = [];
	if (row.archived) badges.push({ key: "archived", label: t("usageArchived"), style: S.badge });
	else if (row.pinned) badges.push({ key: "pinned", label: t("usagePinned"), style: S.badge });
	// 「运行中」用业务蓝（与列表行里那个胶囊同一个 token）：它是"活着"，不是危险。
	if (row.active) badges.push({ key: "running", label: t("running"), style: S.badgeRunning });
	/**
	 * 右边的动作：两种可能 —— 取消归档 / 归档（正在跑的不给按钮：归档会先停掉它的工作）。
	 */
	const action = row.archived
		? { label: t("usageUnarchive"), run: () => onUnarchive(row.sessionId) }
		: row.active
			? null
			: { label: t("usageArchive"), run: () => onArchive(row.sessionId) };
	const when = formatTime(row.createdAt);
	return React.createElement(
		"div",
		{ key: row.sessionId, style: S.usageRow },
		React.createElement(
			"div",
			{ style: S.itemMain },
			React.createElement(
				"div",
				{ style: S.itemTitleRow },
				React.createElement("div", { style: S.itemTitle, title: row.title }, row.title),
				badges.map((badge) => React.createElement("span", { key: badge.key, style: badge.style }, badge.label))
			),
			React.createElement(
				"div",
				{ style: S.itemMeta, title: row.cwd || "" },
				[formatBytes(row.bytes), text(t, "files", { n: row.files }), row.workspaceTitle ?? row.cwd ?? t("noProject"), when]
					.filter((part) => part !== "")
					.join(" · ")
			)
		),
		React.createElement(
			"div",
			{ style: S.itemActions },
			action === null
				? null
				: React.createElement(
						Button,
						{
							size: "sm",
							variant: "outline",
							disabled: busy,
							onClick: action.run
						},
						action.label
					)
		)
	);
}

export function UsagePanel(props: UsagePanelProps): React.ReactElement {
	const t = props.t;
	const usage = props.usage;
	/** 横条图的基准：最大的那个工作区占满，其余按比例 —— 不这样归一，几 KB 的组会看不见。 */
	const maxBytes = usage === null || usage.groups.length === 0 ? 0 : Math.max(...usage.groups.map((group) => group.bytes), 1);

	return React.createElement(
		"div",
		{ style: S.card },
		React.createElement(
			"div",
			{ style: { ...S.configRow, borderTop: "none" } },
			React.createElement(
				"div",
				{ style: S.configMain },
				React.createElement("span", { style: S.configLabel }, t("usageTitle")),
				React.createElement(
					"span",
					{ style: S.configHint },
					props.loading
						? t("usageLoading")
						: usage === null
							? (props.error ?? "")
							: text(t, "usageTotal", {
									n: usage.totalSessions,
									size: formatBytes(usage.totalBytes)
								})
				)
			)
		),
		usage === null || usage.totalSessions === 0
			? React.createElement("div", { style: S.empty }, props.loading ? t("usageLoading") : t("usageNoData"))
			: React.createElement(
					"div",
					{ style: S.usageBody },
					// 按工作区：横条 + 名字 + 体积 / 条数。
					React.createElement("span", { style: S.usageHeading }, t("usageByWorkspace")),
					usage.groups.map((group) =>
						React.createElement(
							"div",
							{ key: group.key, style: S.usageBarRow },
							React.createElement(
								"span",
								{ style: S.usageBarTrack },
								React.createElement("span", {
									style: {
										...S.usageBarFill,
										// 占比：按最大组归一，所以最小的组也看得见（下限 2%）。
										width: `${Math.max(2, Math.round((group.bytes / maxBytes) * 100))}%`
									}
								})
							),
							React.createElement(
								"span",
								{ style: S.usageBarName, title: group.key },
								group.title === "" ? t("noProject") : group.title
							),
							React.createElement(
								"span",
								{ style: S.usageBarMeta },
								`${formatBytes(group.bytes)} · ${text(t, "sessions", { n: group.count })}`
							)
						)
					),
					React.createElement("span", { style: S.usageHeading }, t("usageLargest")),
					usage.largest.map((row) => usageRow(t, row, props.busy, props.onArchive, props.onUnarchive)),
					React.createElement("span", { style: S.usageHeading }, t("usageOldest")),
					usage.oldest.map((row) => usageRow(t, row, props.busy, props.onArchive, props.onUnarchive))
				)
	);
}

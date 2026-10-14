/**
 * 侧边栏会话行的 hover 卡片里属于本插件的那一节（`sidebar.session.row.hover` 槽位）。
 *
 * DSH 的卡片自己已经有标题 / 相对时间 / 运行状态，这里只补它没有的**磁盘事实**：
 * 体积、文件数、原目录，以及"这条现在在归档 / 回收站里"。
 *
 * 数据走 `detail.ts` 的缓存（`describe` 端点）—— 这个组件每次划过都会被挂载一次，
 * 拿不到就什么都不画：卡片少一节，总比在每一行（含"新会话"占位行）挂一句"读取失败"好。
 */
import * as React from "react";
import { describeSession } from "../detail.js";
import { formatBytes, formatTime } from "../format.js";
import { text, type TFn } from "../i18n.js";
import { S } from "../styles.js";
import type { SessionDetail } from "../../shared/protocol.js";

export interface SessionHoverProps {
	sessionId: string;
	t: TFn;
}

export function SessionHover(props: SessionHoverProps): React.ReactElement | null {
	const t = props.t;
	const [detail, setDetail] = React.useState<SessionDetail | null>(null);

	React.useEffect(() => {
		let live = true;
		describeSession(props.sessionId).then(
			(value) => {
				if (live) setDetail(value);
			},
			() => {
				// 读不到就**什么都不画**：hover 卡片是环境信息，不是错误面。这条槽位对每一行
				// 都会挂载（包括侧边栏那个"新会话"占位行，它没有会话目录），在这里写一句
				// "读取失败"只会变成人见人问的噪音。
			}
		);
		// 卡片每次划过都是新挂载；卸载后回来的响应不许再写状态。
		return () => {
			live = false;
		};
	}, [props.sessionId]);

	if (detail === null) return null;

	const badges: { key: string; label: string; danger: boolean }[] = [];
	if (detail.trashed) badges.push({ key: "trashed", label: t("hoverTrashed"), danger: true });
	if (detail.archived) badges.push({ key: "archived", label: t("hoverArchived"), danger: false });
	if (detail.pinned) badges.push({ key: "pinned", label: t("hoverPinned"), danger: false });

	const lines: React.ReactElement[] = [
		React.createElement(
			"div",
			{ key: "stats", style: S.hoverLine },
			React.createElement("span", { style: S.hoverMeta }, text(t, "hoverStats", { size: formatBytes(detail.bytes), n: detail.files }))
		)
	];
	if (detail.cwd) {
		lines.push(
			React.createElement(
				"div",
				{ key: "cwd", style: S.hoverLine },
				React.createElement("span", { style: S.hoverLabel }, t("hoverCwd")),
				React.createElement("span", { style: S.hoverPath, title: detail.cwd }, detail.cwd)
			)
		);
	}
	if (detail.trashed && detail.deletedAt) {
		lines.push(
			React.createElement(
				"div",
				{ key: "deletedAt", style: S.hoverLine },
				React.createElement("span", { style: S.hoverLabel }, t("hoverDeleted")),
				React.createElement("span", { style: S.hoverMeta }, formatTime(detail.deletedAt))
			)
		);
	}
	if (badges.length > 0) {
		lines.push(
			React.createElement(
				"div",
				{ key: "badges", style: S.hoverBadges },
				badges.map((badge) =>
					React.createElement(
						"span",
						{
							key: badge.key,
							style: badge.danger ? S.hoverBadgeDanger : S.hoverBadge
						},
						badge.label
					)
				)
			)
		);
	}

	return React.createElement("div", { style: S.hoverBlock }, lines);
}

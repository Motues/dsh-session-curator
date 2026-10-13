/**
 * 一个工作区分组的标题行：左边（箭头 + 文件夹图标 + 名字）折叠 / 展开，
 * 右边一个小按钮选整组。
 *
 * 箭头与文件夹图标都用 DSH 自带图标（跟侧边栏的项目行同款，展开 = 打开的文件夹）；
 * 折叠状态由面板算好传进来（默认折叠 / 展开与手动覆盖的规则见 `groups.ts`）。
 */
import * as React from "react";
import {
	Button,
	IconChevronDownOutlineRegular,
	IconChevronRightOutlineRegular,
	IconFolderCloseRegular,
	IconFolderOpenRegular
} from "@deepseek-ai/dsh-client-ui-primitives";
import { formatBytes } from "../format.js";
import { text, type TFn } from "../i18n.js";
import { S } from "../styles.js";
import type { SessionGroup } from "../groups.js";

export interface GroupHeaderProps {
	group: SessionGroup;
	t: TFn;
	/** 卡片里的第一个节点不要上边框（卡片自己有）。 */
	first?: boolean;
	busy?: boolean;
	/** 已选中的会话 id（判断这一组是不是整组都选中了）。 */
	selected: string[];
	collapsed: boolean;
	onToggleCollapse(): void;
	onToggleGroup(): void;
}

export function GroupHeader(props: GroupHeaderProps): React.ReactElement {
	const group = props.group;
	const t = props.t;
	const total = group.rows.length;
	const allSelected = total > 0 && group.rows.every((row) => props.selected.includes(row.sessionId));
	const action = allSelected ? t("clearShort") : t("selectAllShort");
	return React.createElement(
		"div",
		{ style: props.first ? { ...S.groupHead, borderTop: "none" } : S.groupHead },
		React.createElement(
			"button",
			{
				type: "button",
				style: S.groupToggle,
				title: props.collapsed ? t("expand") : t("collapse"),
				onClick: () => props.onToggleCollapse()
			},
			React.createElement("span", { style: S.groupCaret }, props.collapsed
				? React.createElement(IconChevronRightOutlineRegular, { size: 12 })
				: React.createElement(IconChevronDownOutlineRegular, { size: 12 })),
			React.createElement("span", { style: S.groupIcon }, props.collapsed
				? React.createElement(IconFolderCloseRegular, { size: 14 })
				: React.createElement(IconFolderOpenRegular, { size: 14 })),
			React.createElement("span", { style: S.groupTitle, title: group.cwd || group.title }, group.title),
			React.createElement("span", { style: S.groupMeta }, text(t, "sessions", { n: total })),
			group.bytes > 0 ? React.createElement("span", { style: S.groupMeta }, formatBytes(group.bytes)) : null,
			group.cwd !== null ? React.createElement("span", { style: { ...S.groupPath, ...S.mono }, title: group.cwd }, group.cwd) : null
		),
		React.createElement(Button, {
			size: "sm",
			variant: "ghost",
			disabled: props.busy,
			// 长路径不许把这个按钮挤窄（否则中文标签折行），见 styles.ts 的 groupAction。
			style: S.groupAction,
			title: `${group.title} — ${allSelected ? t("clearGroup") : t("selectGroup")}`,
			onClick: () => props.onToggleGroup()
		}, action)
	);
}

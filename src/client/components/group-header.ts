/**
 * 一个工作区分组的标题行：左边（箭头 + 文件夹图标 + 名字）折叠 / 展开，
 * 右边两个按钮 —— 整组勾选，以及**跨页签的「整个工作区」动作**。
 *
 * 箭头与文件夹图标都用 DSH 自带图标（跟侧边栏的项目行同款，展开 = 打开的文件夹）；
 * 折叠状态由面板算好传进来（默认折叠 / 展开与手动覆盖的规则见 `groups.ts`）。
 *
 * 「整个工作区」那一个菜单是这个槽位唯一**跨页签**的入口：当前页签里只显示这个工作区的
 * 一部分会话（归档 / 置顶 / 回收站各一页），而"把这个项目整个收拾掉"要一次覆盖三边 ——
 * 目标集合由面板算好（见 `groups.ts` 的 `workspaceSummaries`），这里只画菜单。
 */
import * as React from "react";
import {
	Button,
	IconArchiveOutlineRegular,
	IconChevronDownOutlineRegular,
	IconChevronRightOutlineRegular,
	IconEllipsisOutlineRegular,
	IconFolderCloseRegular,
	IconFolderOpenRegular,
	IconTrashOutlineRegular,
	Menu
} from "@deepseek-ai/dsh-client-ui-primitives";
import { formatBytes } from "../format.js";
import { text, type TFn } from "../i18n.js";
import { S } from "../styles.js";
import type { SessionGroup, WorkspaceSummary } from "../groups.js";

/** 「整个工作区」菜单的一项。 */
export interface WorkspaceAction {
	id: string;
	label: string;
	icon?: unknown;
	danger?: boolean;
	disabled?: boolean;
}

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
	/** 跨页签的工作区动作；分组没开 / 拿不到工作区归属时为空数组（那就只画勾选按钮）。 */
	workspaceActions?: WorkspaceAction[];
	workspaceMenuOpen?: boolean;
	onToggleWorkspaceMenu?(): void;
	onCloseWorkspaceMenu?(): void;
	onRunWorkspaceAction?(id: string): void;
}

export function GroupHeader(props: GroupHeaderProps): React.ReactElement {
	const group = props.group;
	const t = props.t;
	const total = group.rows.length;
	const allSelected = total > 0 && group.rows.every((row) => props.selected.includes(row.sessionId));
	const action = allSelected ? t("clearShort") : t("selectAllShort");
	const workspaceActions = props.workspaceActions ?? [];
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
			React.createElement(
				"span",
				{ style: S.groupCaret },
				props.collapsed
					? React.createElement(IconChevronRightOutlineRegular, { size: 12 })
					: React.createElement(IconChevronDownOutlineRegular, { size: 12 })
			),
			React.createElement(
				"span",
				{ style: S.groupIcon },
				props.collapsed
					? React.createElement(IconFolderCloseRegular, { size: 14 })
					: React.createElement(IconFolderOpenRegular, { size: 14 })
			),
			React.createElement("span", { style: S.groupTitle, title: group.cwd || group.title }, group.title),
			React.createElement("span", { style: S.groupMeta }, text(t, "sessions", { n: total })),
			group.bytes > 0 ? React.createElement("span", { style: S.groupMeta }, formatBytes(group.bytes)) : null,
			group.cwd !== null ? React.createElement("span", { style: { ...S.groupPath, ...S.mono }, title: group.cwd }, group.cwd) : null
		),
		// 工作区动作：先勾选（本页签），再「⋯」（跨页签）。两个都不参与 flex 收缩，
		// 长路径挤的只能是左边的折叠按钮（见 styles.ts 的 groupAction）。
		React.createElement(
			Button,
			{
				size: "sm",
				variant: "ghost",
				disabled: props.busy,
				style: S.groupAction,
				title: `${group.title} — ${allSelected ? t("clearGroup") : t("selectGroup")}`,
				onClick: () => props.onToggleGroup()
			},
			action
		),
		workspaceActions.length === 0
			? null
			: React.createElement(Menu, {
					open: props.workspaceMenuOpen === true,
					portal: true,
					side: "bottom",
					align: "end",
					closeOnPointerLeave: true,
					items: workspaceActions,
					onSelect: (id: string) => props.onRunWorkspaceAction?.(id),
					onClose: () => props.onCloseWorkspaceMenu?.(),
					anchor: React.createElement(Button, {
						size: "sm",
						variant: "ghost",
						disabled: props.busy,
						style: S.rowMenuButton,
						icon: React.createElement(IconEllipsisOutlineRegular, {}),
						"aria-label": `${group.title} — ${t("workspaceActions")}`,
						onClick: () => props.onToggleWorkspaceMenu?.()
					})
				})
	);
}

/** 「整个工作区」菜单的两项（图标与危险色与单行菜单保持一致）。 */
export function workspaceActionsOf(t: TFn, summary: WorkspaceSummary): WorkspaceAction[] {
	return [
		{
			id: "archive",
			label: t("archiveWorkspace"),
			icon: React.createElement(IconArchiveOutlineRegular, { size: 14 }),
			// 全都归档过了就没什么可归档的；有会话正在跑时也不给点（归档会先停掉它的工作）。
			disabled: summary.archivableIds.length === 0 || summary.activeIds.length > 0
		},
		{
			id: "trash",
			label: t("trashWorkspace"),
			icon: React.createElement(IconTrashOutlineRegular, { size: 14 }),
			danger: true,
			disabled: summary.trashableIds.length === 0 || summary.activeIds.length > 0
		}
	];
}

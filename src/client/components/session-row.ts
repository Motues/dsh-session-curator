/**
 * 一行会话。
 *
 * 分组开着时 `showCwd` 为 false —— 文件夹已经写在组标题上，行里不必再重复一遍；
 * 平铺时才把它显示回来。
 *
 * 右侧原来并排 2–3 个文字按钮（"看着有点乱"），现在统一成**一个「⋯」菜单**
 * （`Menu` + `IconEllipsisOutlineRegular`，与侧边栏会话行的 ⋯ 完全同一套写法）：
 * 每行的形状一致，动作收进菜单，危险项用 `danger` 标红。
 *
 * 正在跑的会话在标题后面挂一个「运行中」小胶囊：那是宿主用官方
 * `workspace/session-activity` 判定的事实。界面拿它**预先**说明危险动作为什么点不动
 *（菜单项由面板置 `disabled`），而不是等用户点下去再回一句"会话正在运行"。
 */
import * as React from "react";
import { Button, IconEllipsisOutlineRegular, Menu } from "@deepseek-ai/dsh-client-ui-primitives";
import { formatBytes, formatTime } from "../format.js";
import { text, type TFn } from "../i18n.js";
import { S } from "../styles.js";
import type { PanelRow } from "../../shared/protocol.js";

/** 一行的「⋯」菜单：内容与动作由面板按页签给（见 settings-panel 的 `rowMenu`）。 */
export interface RowMenu {
	items: unknown[];
	run(id: string): void;
}

export interface SessionRowProps {
	row: PanelRow;
	t: TFn;
	/** 卡片里的第一个节点不要上边框（卡片自己有）。 */
	first?: boolean;
	busy?: boolean;
	/** 平铺时才显示文件夹（分组时它已经在组标题上了）。 */
	showCwd?: boolean;
	showMeta?: boolean;
	/** 回收站里显示删除时间，归档 / 置顶里显示创建时间。 */
	showDeletedAt?: boolean;
	checked: boolean;
	onToggle(): void;
	menu: RowMenu;
	menuOpen: boolean;
	onToggleMenu(): void;
	onCloseMenu(): void;
}

export function SessionRow(props: SessionRowProps): React.ReactElement {
	const row = props.row;
	const t = props.t;
	const meta: string[] = [];
	if (props.showCwd) meta.push(row.cwd ? row.cwd : t("noProject"));
	// 体积 / 文件数可以在配置页关掉（默认开）；文件夹那一段不受影响。
	if (props.showMeta !== false) {
		if (row.bytes) meta.push(formatBytes(row.bytes));
		if (row.files) meta.push(text(t, "files", { n: row.files }));
	}
	const time = props.showDeletedAt ? formatTime(row.deletedAt) : formatTime(row.createdAt);
	if (time !== "") meta.push(time);

	const menu = props.menu;
	const running = row.active === true;
	return React.createElement(
		"div",
		{ style: props.first ? { ...S.item, borderTop: "none" } : S.item },
		React.createElement("input", {
			type: "checkbox",
			checked: props.checked,
			disabled: props.busy,
			"aria-label": row.title,
			onChange: () => props.onToggle()
		}),
		React.createElement(
			"div",
			{ style: S.itemMain },
			React.createElement(
				"div",
				{ style: S.itemTitleRow },
				React.createElement("div", { style: S.itemTitle, title: row.title }, row.title),
				// 胶囊：`flex: 0 0 auto`，所以长标题只会挤标题那一段（它有 minWidth: 0 + 省略号）。
				running ? React.createElement("span", { style: S.badgeRunning, title: t("runningHint") }, t("running")) : null
			),
			React.createElement("div", { style: S.itemMeta, title: row.cwd || "" }, meta.join(" · "))
		),
		React.createElement(
			"div",
			{ style: S.itemActions },
			React.createElement(Menu, {
				open: props.menuOpen,
				portal: true,
				side: "bottom",
				align: "end",
				closeOnPointerLeave: true,
				items: menu.items,
				onSelect: (id: string) => menu.run(id),
				onClose: () => props.onCloseMenu(),
				anchor: React.createElement(Button, {
					size: "sm",
					variant: "ghost",
					disabled: props.busy,
					style: S.rowMenuButton,
					icon: React.createElement(IconEllipsisOutlineRegular, {}),
					"aria-label": `${row.title} — ${t("rowActions")}`,
					onClick: (event: { stopPropagation(): void }) => {
						event.stopPropagation();
						props.onToggleMenu();
					}
				})
			})
		)
	);
}

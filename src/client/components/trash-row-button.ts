/**
 * 侧边栏会话行 hover 时那个「移入回收站」按钮（`sidebar.workspaces.session.row.action`）。
 *
 * 形状刻意做成**官方同款**：ui-workspace 在这个槽位里的按钮是朴素 `<button>`（16×16、
 * `border-radius: var(--dsw-radius-xs)`、透明底、无边框；hover **只换前景色**，没有底色）。
 * 所以这里不用 primitives 的 `Button` —— ghost 变体会多出一块 hover 底色，混在同一条
 * 20px 高的 `rowActions` 里一眼就不一样了。
 *
 * 颜色走危险色（`state-error-primary`），hover 压深一档。
 *
 * 为什么 hover 只能靠 `useState`：本插件的样式一律内联（见 `styles.ts` 的说明），内联样式
 * 表达不了伪类；为这一个 16px 按钮引一套 `<style>` 注入不划算，代价只是划过时重渲染它自己。
 */
import * as React from "react";
import { IconTrashOutlineRegular, Tooltip } from "@deepseek-ai/dsh-client-ui-primitives";
import { requestTrash } from "../dialog.js";
import { S } from "../styles.js";
import type { TFn } from "../i18n.js";

export interface TrashRowButtonProps {
	sessionId: string;
	displayTitle?: string;
	t: TFn;
}

export function TrashRowButton(props: TrashRowButtonProps): React.ReactElement {
	const [hovered, setHovered] = React.useState<boolean>(false);
	// 标题只进 `aria-label`：可见的说明由 Tooltip 给。
	const title = props.displayTitle || props.sessionId;
	const label = props.t("moveToTrash");
	return React.createElement(Tooltip, {
		label,
		side: "bottom",
		align: "end",
		delayMs: 500,
		children: React.createElement(
			"button",
			{
				type: "button",
				style: hovered ? S.rowIconButtonHover : S.rowIconButton,
				"aria-label": `${title} — ${label}`,
				onPointerEnter: () => setHovered(true),
				onPointerLeave: () => setHovered(false),
				onClick: () => requestTrash([props.sessionId], title)
			},
			React.createElement(IconTrashOutlineRegular, { size: 14 })
		)
	});
}

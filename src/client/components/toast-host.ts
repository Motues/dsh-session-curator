/**
 * 「撤销」提示的渲染宿主（`shell.overlay` 槽位）。
 *
 * 形状照 `@deepseek-ai/dsh-client-ui-workspace` 的 `RowActionToast`：
 * 一条提示 + 行内动作（`Toast` 的 `actions` 把动作画成正文里的一段蓝色文字），
 * 5 秒后淡出并 `onDone` 卸载。失败时换文案、撤掉按钮 —— 同一条提示，不再有可点的东西。
 */
import * as React from "react";
import { IconWarningOutlineRegular, Toast } from "@deepseek-ai/dsh-client-ui-primitives";
import { text, type TFn } from "../i18n.js";
import { useStore } from "../stores.js";
import { dismissToast, toastStore, undoTrash } from "../toast.js";

export interface ToastHostProps {
	t: TFn;
}

/** 停留时长：够看清一句话并点一下「撤销」。 */
const HOLD_MS = 5_000;

export function ToastHost(props: ToastHostProps): React.ReactElement | null {
	const t = props.t;
	const notice = useStore(toastStore);
	if (notice === null) return null;
	if (notice.error !== null) {
		return React.createElement(
			Toast,
			{
				text: text(t, "toastUndoFailed", { reason: notice.error }),
				icon: React.createElement(IconWarningOutlineRegular, {}),
				onDone: dismissToast
			},
			`session-curator-toast-${notice.seq}`
		);
	}
	// 纯信息提示（`showNotice`：复制路径 / 定位的结果）：没有 id 就没有可撤销的东西，
	// 所以不画动作，也不走"删除成功"那句文案。
	if (notice.ids.length === 0) {
		return React.createElement(
			Toast,
			{
				text: notice.title,
				holdMs: HOLD_MS,
				onDone: dismissToast
			},
			`session-curator-toast-${notice.seq}`
		);
	}
	const many = notice.ids.length > 1;
	return React.createElement(
		Toast,
		{
			text: many ? text(t, "toastTrashedMany", { n: notice.ids.length }) : text(t, "toastTrashed", { title: notice.title }),
			tone: "success",
			holdMs: HOLD_MS,
			actions: [{ label: t("toastUndo"), onClick: () => void undoTrash() }],
			onDone: dismissToast
		},
		`session-curator-toast-${notice.seq}`
	);
}

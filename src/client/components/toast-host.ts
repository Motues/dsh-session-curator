/**
 * 一次性提示的渲染宿主（`shell.overlay` 槽位）。
 *
 * 形状照 `@deepseek-ai/dsh-client-ui-workspace` 的 `RowActionToast`：
 * 一条提示 + `holdMs` 之后淡出并 `onDone` 卸载。**没有动作按钮** —— 现在只有纯信息提示
 *（复制路径 / 定位的结果），删除是物理删除、没有可撤销的东西。
 */
import * as React from "react";
import { Toast } from "@deepseek-ai/dsh-client-ui-primitives";
import { useStore } from "../stores.js";
import { dismissToast, toastStore } from "../toast.js";
import type { TFn } from "../i18n.js";

export interface ToastHostProps {
	t: TFn;
}

/** 停留时长：够看清一句话。 */
const HOLD_MS = 5_000;

export function ToastHost(props: ToastHostProps): React.ReactElement | null {
	const notice = useStore(toastStore);
	if (notice === null) return null;
	return React.createElement(
		Toast,
		{
			text: notice.message,
			holdMs: HOLD_MS,
			onDone: dismissToast
		},
		`session-curator-toast-${notice.seq}`
	);
}

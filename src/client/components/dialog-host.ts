/**
 * 全局确认弹窗宿主（挂在 `shell.overlay` 上，菜单项与设置面板共用）。
 *
 * 只有一种请求：**物理删除**。所以这个文件比回收站时代薄很多 —— 没有"可撤销 / 不可撤销"
 * 的分支，永远要勾"我明白这无法撤销"，正文里明确提示想留退路就改用归档。
 *
 * 钩子全部写在"没有请求就返回 null"**之前**：条件渲染会让 hook 调用顺序不稳定。
 */
import * as React from "react";
import { Button, Modal } from "@deepseek-ai/dsh-client-ui-primitives";
import { call, firstFailure } from "../api.js";
import { dialogStore, mutationStore } from "../dialog.js";
import { text, type TFn } from "../i18n.js";
import { reportError } from "../runtime.js";
import { rememberSnapshot } from "../snapshot.js";
import { useStore } from "../stores.js";
import { S } from "../styles.js";
import type { MutationResult } from "../../shared/protocol.js";

export interface DialogHostProps {
	t: TFn;
}

export function DialogHost(props: DialogHostProps): React.ReactElement | null {
	const t = props.t;
	const request = useStore(dialogStore);
	const [busy, setBusy] = React.useState<boolean>(false);
	const [ack, setAck] = React.useState<boolean>(false);
	const [error, setError] = React.useState<string | null>(null);

	// 每次新请求都重置勾选与错误（hooks 先于条件渲染，保持调用顺序稳定）。
	const requestKey = request === null ? "" : `${request.kind}:${request.ids.join(",")}:${request.title}`;
	React.useEffect(() => {
		setAck(false);
		setError(null);
	}, [requestKey]);

	if (request === null) return null;

	const many = request.ids.length > 1;
	const title = t("confirmDeleteTitle");
	const body = many
		? text(t, "confirmDeleteManyBody", { n: request.ids.length })
		: text(t, "confirmDeleteBody", { title: request.title });

	const close = (): void => {
		if (busy) return;
		dialogStore.set(null);
	};

	const confirm = async (): Promise<void> => {
		setBusy(true);
		try {
			const value = await call<MutationResult>("delete", { ids: request.ids });
			const failure = firstFailure(value.results);
			if (failure === null) {
				dialogStore.set(null);
				// 变更回包**本身就是一份新快照**（`MutationResult extends Snapshot`）：
				// 也写进模块级缓存，否则"面板没挂载时从侧边栏删掉的那条"会在下次
				// 进设置页的第一帧里闪一下（见 `snapshot.ts`）。
				rememberSnapshot(value);
				mutationStore.set(mutationStore.get() + 1);
			} else {
				setError(failure);
			}
		} catch (thrown) {
			setError(reportError(thrown));
		} finally {
			setBusy(false);
		}
	};

	return React.createElement(
		Modal,
		{
			open: true,
			onClose: close,
			title,
			closeLabel: t("close"),
			description: body,
			footer: React.createElement(
				"div",
				{ style: S.rowLine },
				React.createElement(Button, { size: "md", variant: "ghost", disabled: busy, onClick: close }, t("cancel")),
				React.createElement(
					Button,
					{
						size: "md",
						variant: "primary",
						disabled: busy || !ack,
						onClick: () => void confirm()
					},
					t("confirmDeleteAction")
				)
			)
		},
		React.createElement(
			"div",
			{ style: S.column },
			React.createElement(
				"label",
				{ style: S.ack },
				React.createElement("input", {
					type: "checkbox",
					checked: ack,
					disabled: busy,
					onChange: (event: { target: { checked: boolean } }) => setAck(Boolean(event.target.checked))
				}),
				t("ackDelete")
			),
			error ? React.createElement("div", { style: S.error }, error) : null
		)
	);
}

/**
 * 全局确认弹窗宿主（挂在 `shell.overlay` 上，菜单项与设置面板共用）。
 *
 * 钩子全部写在"没有请求就返回 null"**之前**：条件渲染会让 hook 调用顺序不稳定。
 */
import * as React from "react";
import { Button, Modal } from "@deepseek-ai/dsh-client-ui-primitives";
import { call, firstFailure } from "../api.js";
import { dialogStore, mutationStore } from "../dialog.js";
import { formatBytes } from "../format.js";
import { text, type TFn } from "../i18n.js";
import { reportError } from "../runtime.js";
import { rememberSnapshot } from "../snapshot.js";
import { useStore } from "../stores.js";
import { S } from "../styles.js";
import { showTrashUndo } from "../toast.js";
import type { Endpoint, MutationResult } from "../../shared/protocol.js";

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
	const requestKey = request === null ? "" : `${request.kind}:${request.ids.join(",")}:${request.title}:${request.days ?? ""}`;
	React.useEffect(() => {
		setAck(false);
		setError(null);
	}, [requestKey]);

	if (request === null) return null;

	// 三条路都是"不可撤销或难以撤销"的动作，但文案与把关强度不同：
	//   trash     → 软删除，可撤销，只需一次确认；
	//   purge     → 对选中的具体条目永久删除，要勾"我明白"；
	//   purge-old → 按时间批量永久删除，同样要勾，而且先把预览到的条数写进正文。
	const purgeOld = request.kind === "purge-old";
	const purge = request.kind === "purge" || purgeOld;
	const many = request.ids.length > 1;
	const days = request.days ?? 0;
	const title = purgeOld ? t("confirmPurgeOldTitle") : purge ? t("confirmPurgeTitle") : t("confirmTrashTitle");
	const body = purgeOld
		? text(t, "confirmPurgeOldBody", { n: request.count ?? 0, days, size: formatBytes(request.bytes ?? 0) })
		: purge
			? many
				? text(t, "confirmPurgeManyBody", { n: request.ids.length })
				: text(t, "confirmPurgeBody", { title: request.title })
			: text(t, "confirmTrashBody", { title: request.title });

	const close = (): void => {
		if (busy) return;
		dialogStore.set(null);
	};

	const confirm = async (): Promise<void> => {
		setBusy(true);
		try {
			// `purge-old` 不带 ids：目标集合由宿主按 `days` 现算（与预览同一套规则）。
			const endpoint: Endpoint = purgeOld ? "purge-older-than" : purge ? "purge" : "trash";
			const value = await call<MutationResult>(endpoint, purgeOld ? { days } : { ids: request.ids });
			const failure = firstFailure(value.results);
			if (failure === null) {
				dialogStore.set(null);
				// 变更回包**本身就是一份新快照**（`MutationResult extends Snapshot`）：
				// 也写进模块级缓存，否则"面板没挂载时从侧边栏删掉的那条"会在下次
				// 进设置页的第一帧里闪一下（见 `snapshot.ts`）。
				rememberSnapshot(value);
				mutationStore.set(mutationStore.get() + 1);
				// 软删除是可恢复的，但用户不该为此自己跑去设置页：成功后给 5 秒撤销机会
				//（永久删除没有撤销，所以只在 trash 这条路上弹）。
				if (!purge) showTrashUndo(request.ids, request.title);
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
						disabled: busy || (purge && !ack),
						onClick: () => void confirm()
					},
					purge ? t("confirmPurgeAction") : t("confirmTrashAction")
				)
			)
		},
		purge
			? React.createElement(
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
						purgeOld ? t("ackPurgeOld") : t("ackPurge")
					),
					error ? React.createElement("div", { style: S.error }, error) : null
				)
			: error
				? React.createElement("div", { style: S.error }, error)
				: null
	);
}

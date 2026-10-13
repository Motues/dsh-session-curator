/**
 * 更新检查的客户端状态机：`idle → checking → done | failed`。
 * 真正的网络请求在宿主（见 `src/host/update.ts`：只读 GET + 10 分钟缓存 + 5s 超时）。
 */
import { call } from "./api.js";
import { createStore } from "./stores.js";
import { reportError } from "./runtime.js";
import type { UpdateInfo } from "../shared/protocol.js";

export interface UpdateState {
	state: "idle" | "checking" | "done" | "failed";
	value: UpdateInfo | null;
	error: string | null;
}

export const updateStore = createStore<UpdateState>({ state: "idle", value: null, error: null });

export async function checkUpdate(force?: boolean): Promise<void> {
	updateStore.set({ state: "checking", value: updateStore.get().value, error: null });
	try {
		const value = await call<UpdateInfo>("check-update", force === true ? { force: true } : {});
		updateStore.set({ state: "done", value, error: null });
	} catch (error) {
		updateStore.set({ state: "failed", value: updateStore.get().value, error: reportError(error) });
	}
}

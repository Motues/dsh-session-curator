/**
 * 极小的模块级 store（本插件不依赖任何状态管理服务）。
 *
 * 组件用 `useStore()` 订阅；`useStore` 只用到 `useState` + `useEffect`，
 * 这也是 `scripts/client.mjs` 的迷你 React 桩支持的那两个 hook。
 */
import * as React from "react";

export interface Store<T> {
	get(): T;
	set(next: T): void;
	subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
	let value = initial;
	const listeners = new Set<() => void>();
	return {
		get: () => value,
		set: (next: T) => {
			value = next;
			for (const listener of listeners) listener();
		},
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
	};
}

export function useStore<T>(store: Store<T>): T {
	const [value, setValue] = React.useState<T>(store.get);
	React.useEffect(() => store.subscribe(() => setValue(store.get())), [store]);
	return value;
}

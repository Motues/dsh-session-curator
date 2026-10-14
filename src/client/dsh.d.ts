/**
 * DSH 运行时注入的那两个模块 —— **只有类型**。
 *
 * 为什么不装 `@types/react` 之类的包：`@deepseek-ai/*` 从不发 npm（由 DSH 运行时注入，
 * 本机也拿不到），根本装不了；而 React 我们只用到五个 API。声明 20 行比引一整套类型更
 * 贴近事实 —— 声明里多写一个并不存在的导出，代价是运行时才炸。
 */
declare module "react" {
	export interface ReactElement {
		type: unknown;
		props: Record<string, unknown>;
		children?: unknown[];
	}
	export function createElement(type: unknown, props?: unknown, ...children: unknown[]): ReactElement;
	export function useState<T>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void];
	export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
	export function useCallback<T>(callback: T, deps: readonly unknown[]): T;
	export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
}

declare module "@deepseek-ai/dsh-client-ui-primitives" {
	// 名字与 DSH 的真实导出逐一核对过（`scripts/client.mjs` 的桩也用同一份名单）；
	// 类型一律 unknown：它们只作为 createElement 的第一个参数用，写细了反而要维护。
	export const Button: unknown;
	export const Input: unknown;
	export const Menu: unknown;
	export const MenuItemButton: unknown;
	export const Modal: unknown;
	export const SegmentedControl: unknown;
	export const Switch: unknown;
	export const Toast: unknown;
	export const Tooltip: unknown;
	export const IconArchiveOutlineRegular: unknown;
	export const IconCheckOutlineRegular: unknown;
	export const IconChevronDownOutlineRegular: unknown;
	export const IconChevronRightOutlineRegular: unknown;
	export const IconChevronsUpDownOutlineRegular: unknown;
	export const IconCopyOutlineRegular: unknown;
	export const IconEllipsisOutlineRegular: unknown;
	export const IconFolderCloseRegular: unknown;
	export const IconFolderOpenRegular: unknown;
	export const IconPinOutlineRegular: unknown;
	export const IconRefreshOutlineRegular: unknown;
	export const IconSearchOutlineRegular: unknown;
	export const IconTrashOutlineRegular: unknown;
	export const IconUnarchiveOutlineRegular: unknown;
	export const IconWarningOutlineRegular: unknown;
}

/**
 * 下拉选择（配置页的排序 / 保留天数用它）。
 *
 * 为什么不是 `SegmentedControl`：档位一多（排序 5 档、天数还要留自定义）那排滑块就挤不下了，
 * 而且它本质是 tablist —— 语义上也不像"从一列里挑一个"。
 *
 * 为什么不是 primitives 里的某个 Select：**没有**。`Selector` 只是 `SegmentedControl` 的实现，
 * `NumberField` / `TextField` 是设置表单的解析器（`settingsNumberField` 之类），都不是控件。
 * DSH 自己"从一列里挑一个"用的就是 `Menu`（见 `@deepseek-ai/dsh-client-ui-primitives` 的
 * `Menu` 文档：`items` / `children` 二选一），所以这里照同一套写。
 *
 * 选中标记走**数据行**（`items` + `selectedId`）而不是 `children` + `MenuItemButton`：
 * 官方菜单的选中态（figma `.Menu_cell`）是**行尾**的对勾 —— `Menu` 只在数据行上画它
 * （`Menu.module.css` 的 `.check { flex: none }` 跟在 `.itemLabel { flex: 1 }` 后面）。
 * `MenuItemButton` 只接一个 `icon`，位置固定在文字**前面**，用它打勾就是我们这次要修掉的
 * "对勾在字左边"（与 DSH 自己的菜单长得也不一样）。
 *
 * 展开状态是**受控**的（`open` + `onToggle`），组件自己不用 `useState` —— 与
 * `GroupHeader` / `SessionRow` 同一个理由：`scripts/client.mjs` 的迷你渲染器按**下标**存
 * hook 槽位，而组件只有在渲染循环里被调用时下标才对得上。自检要 `draw` 出这个下拉看里面的行，
 * 自带 hook 的话那次 `draw` 会把槽位顺序搅乱。
 */
import * as React from "react";
import { Button, IconChevronsUpDownOutlineRegular, Menu } from "@deepseek-ai/dsh-client-ui-primitives";
import { S } from "../styles.js";

/** 一个档位。`value` 允许是数字（保留天数就是数字档）。 */
export interface DropdownOption<T extends string | number> {
	value: T;
	label: string;
	disabled?: boolean;
}

export interface DropdownProps<T extends string | number> {
	/** 每个下拉自己的 id：数据行的 id 用它拼（自检也按它找行）。 */
	id: string;
	value: T;
	options: readonly DropdownOption<T>[];
	onChange(value: T): void;
	/** 无障碍名字（`Menu` 自己不吃 `label`，所以挂在锚点按钮的 `aria-label` 上）。 */
	label: string;
	/** 锚点上显示的文字；不传就用当前档位的 label。 */
	display?: string;
	disabled?: boolean;
	/** 列表对齐（默认 `end`：右侧的配置控件下面，靠右不越界）。 */
	align?: "start" | "end";
	/** 列表是否展开（受控，见文件头）。 */
	open: boolean;
	onToggle(open: boolean): void;
}

export function Dropdown<T extends string | number>(props: DropdownProps<T>): React.ReactElement {
	const current = props.options.find((option) => option.value === props.value);
	const display = props.display ?? (current === undefined ? String(props.value) : current.label);
	/**
	 * 数据行的 id：`Menu` 的 `items[].id` / `selectedId` 都是字符串，数字档位（保留天数）
	 * 在这里过一道，取值时再按同一个函数反查 —— 拼法与反查只有这一份。
	 */
	const optionId = (value: T): string => `${props.id}-${String(value)}`;
	return React.createElement(Menu, {
		open: props.open,
		portal: true,
		side: "bottom",
		align: props.align ?? "end",
		items: props.options.map((option) => ({
			id: optionId(option.value),
			label: option.label,
			disabled: option.disabled === true
		})),
		// 命中当前档位时由 `Menu` 在行**尾**画对勾 —— 这是数据行选中态的唯一来源。
		selectedId: optionId(props.value),
		onSelect: (id: string) => {
			// 选完就关：下拉不是常驻面板，与行内「⋯」菜单那种"点外面才关"的用法不同。
			props.onToggle(false);
			const picked = props.options.find((option) => optionId(option.value) === id);
			if (picked !== undefined && picked.value !== props.value) props.onChange(picked.value);
		},
		onClose: () => props.onToggle(false),
		className: S.dropdownAnchor,
		anchor: React.createElement(
			Button,
			{
				size: "sm",
				variant: "outline",
				disabled: props.disabled === true,
				style: S.dropdownButton,
				"aria-label": props.label,
				"aria-haspopup": "menu",
				"aria-expanded": props.open,
				icon: React.createElement(IconChevronsUpDownOutlineRegular, { size: 14 }),
				onClick: () => props.onToggle(!props.open)
			},
			display
		)
	});
}

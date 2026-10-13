/**
 * 内联样式（全部走主题 token，不依赖 styles 服务）。
 * 图标只吃 `size` / `className`，不接 `style`：颜色靠外层 span 的 currentColor 传下去。
 */
export const S = {
	column: { display: "flex", flexDirection: "column", gap: "10px", padding: "4px 0", minWidth: 0 },
	rowLine: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
	tabBar: { display: "flex", alignItems: "center", gap: "6px" },
	card: {
		border: "1px solid var(--dsw-alias-border-l1)",
		borderRadius: "10px",
		overflow: "hidden"
	},
	list: { display: "flex", flexDirection: "column" },
	item: {
		display: "flex",
		alignItems: "center",
		gap: "10px",
		padding: "8px 10px",
		borderTop: "1px solid var(--dsw-alias-border-l1)"
	},
	itemMain: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: "1 1 auto" },
	itemTitle: {
		color: "var(--dsw-alias-label-primary)",
		fontSize: "13px",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap"
	},
	itemMeta: {
		color: "var(--dsw-alias-label-secondary)",
		fontSize: "11px",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap"
	},
	itemActions: { display: "flex", alignItems: "center", gap: "6px", flex: "0 0 auto" },
	/**
	 * 「⋯」触发器：图标按钮，弱化成次要前景色（跟侧边栏行的图标按钮一致）。
	 * `flex: 0 0 auto` 防"长标题挤坏按钮"：行内标题再长也只能挤 `itemMain`
	 *（那边有 minWidth: 0 + 省略号），别让收缩落到这个按钮上。
	 */
	rowMenuButton: { color: "var(--dsw-alias-label-secondary)", padding: "0 6px", flex: "0 0 auto" },
	/**
	 * 文件夹那一行的底色。**不能用 `--dsw-alias-bg-layer-*`**：浅色主题里
	 * base / layer-1 / layer-2 / layer-3 都指向同一个颜色（`neutral-bluish-00`），
	 * 铺上去等于没铺（这就是之前"看不出区别"的原因）。
	 * `interactive-bg-active` 是带 alpha 的叠加色（#2631481a，约 10%），
	 * 深浅主题都有效；比行 hover 用的 `interactive-bg-hover`（约 6%）略重一点，
	 * 这样"文件夹条"和"鼠标划过的会话行"不会糊在一起。
	 */
	groupHead: {
		display: "flex",
		alignItems: "center",
		gap: "10px",
		padding: "6px 10px",
		background: "var(--dsw-alias-interactive-bg-active)",
		borderTop: "1px solid var(--dsw-alias-border-l1)"
	},
	groupToggle: {
		display: "flex",
		alignItems: "center",
		gap: "8px",
		minWidth: 0,
		flex: "1 1 auto",
		background: "transparent",
		border: "none",
		padding: 0,
		margin: 0,
		color: "inherit",
		font: "inherit",
		textAlign: "left",
		cursor: "pointer"
	},
	groupCaret: { color: "var(--dsw-alias-label-tertiary)", flex: "0 0 auto", display: "flex", alignItems: "center" },
	groupIcon: { color: "var(--dsw-alias-label-secondary)", flex: "0 0 auto", display: "flex", alignItems: "center" },
	groupTitle: {
		color: "var(--dsw-alias-label-primary)",
		fontSize: "12px",
		fontWeight: 600,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		flex: "0 1 auto"
	},
	groupMeta: { color: "var(--dsw-alias-label-tertiary)", fontSize: "11px", flex: "0 0 auto" },
	/**
	 * 分组标题右侧的「全选 / 取消」。
	 *
	 * 为什么必须写这两条：路径一长，`groupHead` 这行必然溢出，浏览器按 flex 基准**按比例**
	 * 分配收缩量 —— 右侧按钮也会被挤窄。而 DSH 的 `Button` 是 `display: inline-flex`
	 * 且**没有 `white-space: nowrap`**，窄到一定程度「全选」两个字就在按钮里折成两行。
	 * 让它完全不参与收缩（`0 0 auto`）、再兜一条 `nowrap`，收缩就只剩左边的折叠按钮承担：
	 * 标题 / 路径各自 `minWidth: 0` + 省略号，该截断的地方截断。
	 */
	groupAction: { flex: "0 0 auto", whiteSpace: "nowrap" },
	groupPath: {
		color: "var(--dsw-alias-label-tertiary)",
		fontSize: "11px",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		minWidth: 0,
		flex: "0 1 auto"
	},
	empty: { color: "var(--dsw-alias-label-secondary)", fontSize: "12px", padding: "14px 10px", textAlign: "center" },
	error: { color: "var(--dsw-alias-state-error-primary)", fontSize: "12px" },
	footer: { color: "var(--dsw-alias-label-secondary)", fontSize: "11px", display: "flex", gap: "10px", flexWrap: "wrap" },
	mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
	ack: { display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--dsw-alias-label-primary)" },
	/** 顶部条：页签在左，动作靠 `marginInlineStart: auto` 推到右边。 */
	header: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
	headerActions: { display: "flex", alignItems: "center", gap: "8px", marginInlineStart: "auto" },
	/** 配置页的一行：左边标签 + 说明，右边控件。 */
	configRow: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: "12px",
		padding: "10px 12px",
		borderTop: "1px solid var(--dsw-alias-border-l1)"
	},
	configMain: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
	configLabel: { color: "var(--dsw-alias-label-primary)", fontSize: "13px" },
	configHint: { color: "var(--dsw-alias-label-tertiary)", fontSize: "11px" },
	configControl: { display: "flex", alignItems: "center", gap: "8px", flex: "0 0 auto" },
	configFoot: {
		display: "flex",
		alignItems: "center",
		gap: "8px",
		flexWrap: "wrap",
		padding: "10px 12px",
		borderTop: "1px solid var(--dsw-alias-border-l1)"
	},
	/** 版本号：浅色小字。 */
	version: { color: "var(--dsw-alias-label-tertiary)", fontSize: "11px" },
	/**
	 * 升级提示块。底色用带 alpha 的 `interactive-bg-active` —— 浅色主题里
	 * base / layer-1 / layer-2 / layer-3 是同一个颜色，铺上去等于没铺。
	 */
	updateBox: {
		display: "flex",
		flexDirection: "column",
		gap: "6px",
		padding: "10px 12px",
		borderTop: "1px solid var(--dsw-alias-border-l1)",
		background: "var(--dsw-alias-interactive-bg-active)"
	},
	updateTitle: { color: "var(--dsw-alias-label-primary)", fontSize: "12px", fontWeight: 600 },
	updateSteps: { color: "var(--dsw-alias-label-secondary)", fontSize: "11px", display: "flex", flexDirection: "column", gap: "4px" },
	code: {
		display: "block",
		fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
		fontSize: "11px",
		color: "var(--dsw-alias-label-primary)",
		background: "var(--dsw-alias-interactive-bg-active)",
		borderRadius: "6px",
		padding: "6px 8px",
		overflowX: "auto",
		whiteSpace: "pre"
	},
	link: { color: "var(--dsw-alias-label-primary)", fontSize: "11px" }
};

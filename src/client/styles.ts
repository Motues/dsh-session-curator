/**
 * 内联样式（全部走主题 token，不依赖 styles 服务）。
 * 图标只吃 `size` / `className`，不接 `style`：颜色靠外层 span 的 currentColor 传下去。
 */

/**
 * 侧边栏会话行 hover 按钮的形状（两种状态共用）。
 *
 * 逐条对齐 ui-workspace 自己那个槽位里的 `iconButton`：16×16、`var(--dsw-radius-xs)`、
 * 透明底、无边框、`flex: none`、`cursor: pointer` —— 官方 hover **只换前景色**、没有底色，
 * 所以这里也不给任何别的 background（`scripts/client.mjs` 对两种状态都断言了 transparent）。
 */
const ROW_ICON_BUTTON = {
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	width: "16px",
	height: "16px",
	padding: 0,
	margin: 0,
	border: "none",
	background: "transparent",
	borderRadius: "var(--dsw-radius-xs)",
	cursor: "pointer",
	flex: "none"
};

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
	/**
	 * 标题那一行：标题 + 状态胶囊（「运行中」）。
	 *
	 * 胶囊 `flex: 0 0 auto`、标题 `minWidth: 0` + 省略号 —— 长标题只挤自己那一段，
	 * 不会把胶囊压成两行（与分组标题那次"长路径挤坏按钮"同一条教训，见 groupAction）。
	 */
	itemTitleRow: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0 },
	itemTitle: {
		color: "var(--dsw-alias-label-primary)",
		fontSize: "13px",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		minWidth: 0
	},
	itemMeta: {
		color: "var(--dsw-alias-label-secondary)",
		fontSize: "11px",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap"
	},
	/** 状态胶囊：与 hover 卡片那几个同款（带 alpha 的叠加色，深浅主题都有效）。 */
	badge: {
		color: "var(--dsw-alias-label-secondary)",
		fontSize: "10px",
		lineHeight: "16px",
		padding: "0 6px",
		borderRadius: "8px",
		background: "var(--dsw-alias-interactive-bg-active)",
		flex: "0 0 auto"
	},
	/** 「运行中」：同款胶囊，但用业务蓝表示"它是活的"，不是危险。 */
	badgeRunning: {
		color: "var(--dsw-alias-state-business-primary)",
		fontSize: "10px",
		lineHeight: "16px",
		padding: "0 6px",
		borderRadius: "8px",
		background: "var(--dsw-alias-interactive-bg-active)",
		flex: "0 0 auto"
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
	/**
	 * 数据页签上的过滤工具条：搜索框在左、时间档在右。
	 *
	 * `flexWrap` 是必需的：设置页本身可能很窄（侧边栏展开时尤其），搜索框的
	 * `minWidth` 兜住它不被压成一条线，挤不下时时间档换行，而不是把输入框挤没。
	 */
	filterBar: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
	/** 搜索框自己撑开剩余宽度；给个下限，窄屏下也不至于只剩图标。 */
	searchInput: { flex: "1 1 auto", minWidth: "160px" },
	/** 把时间档推到右边（搜索框与它之间那段空白）。 */
	filterSpacer: { flex: "1 1 auto" },
	// ── 磁盘占用视图（配置页里的一块） ─────────────────────────────────────
	usageBody: { display: "flex", flexDirection: "column", padding: "0 12px 12px", gap: "2px" },
	usageHeading: {
		color: "var(--dsw-alias-label-tertiary)",
		fontSize: "11px",
		marginTop: "8px",
		marginBottom: "2px"
	},
	/** 一条工作区横条：轨道 + 名字 + 数字。名字可以很长，所以它自己省略。 */
	usageBarRow: { display: "flex", alignItems: "center", gap: "8px", minWidth: 0 },
	usageBarTrack: {
		width: "70px",
		height: "6px",
		borderRadius: "3px",
		background: "var(--dsw-alias-interactive-bg-active)",
		flex: "0 0 auto",
		overflow: "hidden"
	},
	usageBarFill: { display: "block", height: "100%", background: "var(--dsw-alias-state-business-primary)" },
	usageBarName: {
		color: "var(--dsw-alias-label-primary)",
		fontSize: "12px",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		minWidth: 0,
		flex: "1 1 auto"
	},
	usageBarMeta: { color: "var(--dsw-alias-label-secondary)", fontSize: "11px", flex: "0 0 auto" },
	/** 榜单里的一行：与列表行同一套几何，只是没有勾选框。 */
	usageRow: { display: "flex", alignItems: "center", gap: "10px", padding: "6px 0", minWidth: 0 },
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
	/** 下拉锚点：文字 + 双向箭头图标，别被挤窄（长标签在按钮里折行是这个仓库踩过的坑）。 */
	dropdownAnchor: { flex: "0 0 auto" },
	dropdownButton: { flex: "0 0 auto", whiteSpace: "nowrap" },
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
	link: { color: "var(--dsw-alias-label-primary)", fontSize: "11px" },
	/**
	 * 会话行 hover 卡片里我们那一节。卡片自己的 `hoverContent` 已经是纵向 flex 且有间距，
	 * 这里只补一点点上边距，不加分隔线 —— 上面那行是官方画的相对时间。
	 */
	hoverBlock: { display: "flex", flexDirection: "column", gap: "3px", marginTop: "2px", minWidth: 0 },
	hoverLine: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0 },
	hoverLabel: { color: "var(--dsw-alias-label-tertiary)", fontSize: "11px", flex: "0 0 auto" },
	hoverMeta: { color: "var(--dsw-alias-label-secondary)", fontSize: "11px", flex: "0 0 auto" },
	/** 原目录可能很长：让它自己省略，别把卡片撑宽。 */
	hoverPath: {
		color: "var(--dsw-alias-label-secondary)",
		fontSize: "11px",
		fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		minWidth: 0,
		flex: "0 1 auto"
	},
	hoverBadges: { display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" },
	/** 状态胶囊：底色用带 alpha 的 `interactive-bg-active`（浅色主题里 layer 系列是同一个颜色）。 */
	hoverBadge: {
		color: "var(--dsw-alias-label-secondary)",
		fontSize: "10px",
		lineHeight: "16px",
		padding: "0 6px",
		borderRadius: "8px",
		background: "var(--dsw-alias-interactive-bg-active)",
		flex: "0 0 auto"
	},
	/**
	 * 侧边栏会话行 hover 时那个「删除会话」图标按钮（见
	 * `components/delete-row-button.ts`）：16×16 的朴素按钮，**两种状态都没有底色**，
	 * 只有前景色变深一档。
	 *
	 * `color-mix` 是 DSH 自己的产物里就在用的写法（例如 ui-deliverables 的
	 * `color-mix(in srgb, var(--dsw-alias-interactive-bg-hover) 50%, transparent)`）。
	 * 为什么不换 `state-error-secondary`：那个 token 在浅色主题里是 red-400，比 primary
	 * （red-600）**更浅**，方向正好相反。
	 */
	rowIconButton: { ...ROW_ICON_BUTTON, color: "var(--dsw-alias-state-error-primary)" },
	rowIconButtonHover: { ...ROW_ICON_BUTTON, color: "color-mix(in srgb, var(--dsw-alias-state-error-primary) 78%, #000)" }
};

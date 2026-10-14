/**
 * 宿主半区自检 —— 不需要 DSH，也不需要浏览器。
 *
 * 做法：用从真实 `<DSH_HOME>/storages/workspace.json` 读出的工作区/归档/置顶集合搭一个
 * 假 `workspaceRegistry`，再用假 `ctx` 调 `apply(ctx)`，然后**用真实 `Request` 走一遍
 * 插件注册的精确 Fetch 路由**（`/api/session-curator/<endpoint>`），信封、分发、
 * 入参归一化一起测。那个文件**不存在**时降级成空表（CI runner 就是这种情况，见
 * `readWorkspaceTable()`）—— 断言不依赖真实数据，所以两条路都该通过。
 *
 * 假 ctx 只提供 `connection.fetch.register`：**故意不给 `rpc`，也不给 `webServer`**，
 * 因为那正是出过事故的路径 —— `connection.rpc.handle()` 内部拿的是 Connection 自己的
 * ctx 去做 `owner.webServer.register(...)`，会抛
 * `cannot get property "webServer" without inject`，插件 fiber 变 `failed`、
 * 一条路由都挂不上，客户端每个 POST 落到 SPA 静态兜底，被回 **HTTP 405**
 * （`transport failure for /session-manager/trash: HTTP 405`）。
 * 谁把实现改回 `rpc.handle`，这里就会当场崩掉。
 *
 * `snapshot` 会真实读取 `<DSH_HOME>`（会话目录、投影缓存、回收站），所以这条路径上的
 * 扫描、标题/cwd 投影、体积统计、错误信封与入参归一化都会被覆盖。
 *
 * 最后一段换到**临时 DSH_HOME**，用一个按 `dsh-workspace` 真实语义最小化实现的假 registry
 * 真跑一遍 `trash` / `restore` / `purge`，断言的是"删除之后会话必须从侧边栏消失、且只能
 * 出现在回收站页签"：那正是"移入回收站后侧边栏未分组里还在、归档页签里也还在"的回归测试
 * （判定规则逐字照抄 `dsh-client-ui-workspace` 的 `groupByWorkspace()`）。
 *
 * 用法：`node scripts/smoke.mjs`（可用 `DSH_HOME` 指定别的 home）。
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { apply, compareVersions, dirStats, forgetDirStats, inject, insideRoot, isExpired, name, retentionCutoff } from "../lib/index.js";

function dshHome() {
	const configured = process.env.DSH_HOME;
	if (typeof configured === "string" && configured.trim() !== "") return resolve(configured.trim());
	return resolve(join(homedir(), ".dsh"));
}

const home = dshHome();
const workspaceFile = join(home, "storages", "workspace.json");

/**
 * 读真实 `workspace.json`；**只有**"文件不存在"才降级成空表。
 *
 * 为什么要有这条降级：CI runner（以及任何没装过 DSH 的机器）上 `<DSH_HOME>` 根本不存在，
 * 直接 `readFile` 会让 `pnpm test` 以 ENOENT 崩掉 —— 而本脚本的断言并不依赖真实数据
 *（它依赖的是"宿主真的去读了一遍 sessions 根"这件事本身）。实测空表时 71 条全过。
 * 别的错（JSON 坏了 / 权限）必须照旧抛出去，别把真问题一起吞掉。
 */
async function readWorkspaceTable() {
	try {
		return JSON.parse(await readFile(workspaceFile, "utf8"));
	} catch (error) {
		if (error && error.code === "ENOENT") return { tables: {}, global: {} };
		throw error;
	}
}

const raw = await readWorkspaceTable();
const tables = (raw.tables && raw.tables.workspaces) || {};
const workspaces = Object.entries(tables).map(([id, row]) => ({
	id,
	path: row.path,
	title: row.title,
	sessionIds: Array.isArray(row.sessionIds) ? row.sessionIds : []
}));

const registry = {
	archivedSessionIds: (raw.global && raw.global.archivedSessionIds) || [],
	pinnedSessionIds: (raw.global && raw.global.pinnedSessionIds) || [],
	list: () => workspaces,
	resolveByPath: async (path) => workspaces.find((workspace) => workspace.path === path)
};

// ── 假 ctx：只有 Connection 公布的 Fetch 注册面 ───────────────────────────
const CHANNEL_PATH = "/api/session-curator";
const METHOD_PREFIX = "session-curator";
const EXPECTED_ENDPOINTS = [
	"snapshot",
	"describe",
	"archive",
	"unarchive",
	"pin",
	"unpin",
	"trash",
	"restore",
	"purge",
	"trash-stats",
	"purge-older-than",
	"usage",
	"open",
	"check-update"
];

const routes = new Map();
const disposers = [];
const ctx = {
	connection: {
		fetch: {
			register: (route) => {
				if (routes.has(route.path)) throw new Error(`duplicate route ${route.path}`);
				routes.set(route.path, route);
				const dispose = () => routes.delete(route.path);
				disposers.push(dispose);
				return dispose;
			}
		}
	},
	workspaceRegistry: registry,
	effect: (callback) => {
		const dispose = callback();
		if (typeof dispose === "function") disposers.push(dispose);
		return dispose;
	},
	waterfall: async () => [],
	logger: { warn: (message) => console.log("   [warn]", message) }
};

const checks = [];
function check(label, condition, detail) {
	checks.push({ label, ok: Boolean(condition), detail });
	console.log(`${condition ? "  ok  " : " FAIL "} ${label}${detail === undefined ? "" : `  — ${detail}`}`);
}

console.log(`plugin: ${name}  inject: ${inject.join(" + ")}`);
console.log(`home:   ${home}`);
console.log(
	`workspace.json: ${workspaces.length} workspaces, ${registry.archivedSessionIds.length} archived, ${registry.pinnedSessionIds.length} pinned\n`
);

apply(ctx);

// ── 路由形状 ─────────────────────────────────────────────────────────────
check(
	"registers one exact /api route per endpoint",
	routes.size === EXPECTED_ENDPOINTS.length && EXPECTED_ENDPOINTS.every((endpoint) => routes.has(`${CHANNEL_PATH}/${endpoint}`)),
	[...routes.keys()].join(", ")
);
check(
	"every route is POST + buffered under the shared /api channel",
	[...routes.values()].every((route) => route.methods.length === 1 && route.methods[0] === "POST" && route.requestBody === "buffered"),
	[...routes.values()].map((route) => `${route.path} [${route.methods.join("|")}] ${route.requestBody}`).join(", ")
);

// ── 线协议：真 Request 进、真信封出（/api 前缀路由已做完信任与鉴权） ──────
function invokerFor(routes) {
	return async function invoke(endpoint, payload, overrides) {
		const route = routes.get(`${CHANNEL_PATH}/${endpoint}`);
		if (route === undefined) throw new Error(`route not registered: ${CHANNEL_PATH}/${endpoint}`);
		const rpcId = `smoke-${endpoint}-${Math.random().toString(16).slice(2)}`;
		const request = new Request(`http://127.0.0.1${CHANNEL_PATH}/${endpoint}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				type: "client-request",
				rpcId,
				method: `${METHOD_PREFIX}/${endpoint}`,
				payload: payload || {},
				...(overrides || {})
			})
		});
		const envelope = await (await route.fetch(request)).json();
		if (envelope.type !== "server-response") throw new Error(`bad envelope type for ${endpoint}`);
		if (envelope.rpcId !== rpcId) throw new Error(`rpcId mismatch for ${endpoint}`);
		return envelope.result;
	};
}

const invoke = invokerFor(routes);

const snapshot = await invoke("snapshot", {});
check("snapshot succeeds", snapshot.ok, snapshot.ok ? undefined : JSON.stringify(snapshot.error));
if (!snapshot.ok) process.exit(1);

const value = snapshot.value;
check(
	"snapshot shape",
	["dshHome", "version", "trashDir", "sessionsDir", "archived", "pinned", "trashed", "totals"].every((key) => key in value)
);
check(
	"snapshot reports the package version (config page shows it as v…)",
	value.version === JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version,
	String(value.version)
);
check(
	"trash lives under storages/session-manager",
	value.trashDir.replace(/\\/g, "/").endsWith("/storages/session-manager/trash"),
	value.trashDir
);
const trashedIds = new Set(value.trashed.map((row) => row.sessionId));
// 期望集合 = 归档集合 ∩ 磁盘上真实存在 ∖ 回收站：`archivedSessionIds` 是只增不减的记账，
// 目录已经不在（或被我们搬进回收站）的 id 不该再出现在"已归档"页签里。
const onDiskIds = new Set();
for (const slug of await readdir(join(home, "sessions"), { withFileTypes: true }).catch(() => [])) {
	if (!slug.isDirectory()) continue;
	for (const entry of await readdir(join(home, "sessions", slug.name), { withFileTypes: true }).catch(() => [])) {
		if (entry.isDirectory()) onDiskIds.add(entry.name);
	}
}
const expectedArchived = registry.archivedSessionIds.filter((id) => onDiskIds.has(id) && !trashedIds.has(id));
check(
	"archived rows are exactly the archived ids still on disk, minus the trash",
	value.archived.length === expectedArchived.length && value.archived.every((row) => expectedArchived.includes(row.sessionId)),
	`${value.archived.length} rows (expected ${expectedArchived.length}), ${value.totals.archivedBytes} B`
);
// 回归：回收站条目**只**归回收站页签。删除时 id 会故意留在归档集合里（那是 DSH 唯一
// "从所有分组面消失"的机制），所以这里必须有过滤，否则同一会话会同时出现在两个页签，
// 而"已归档"那条还是 `onDisk:false` 的幽灵行（本机真实数据踩过 5 次）。
check(
	"no trashed session is also listed as archived",
	value.archived.every((row) => !trashedIds.has(row.sessionId)),
	value.archived
		.filter((row) => trashedIds.has(row.sessionId))
		.map((row) => row.sessionId)
		.join(", ") || undefined
);
check(
	"every archived row resolved its on-disk directory",
	value.archived.every((row) => row.onDisk),
	value.archived
		.filter((row) => !row.onDisk)
		.map((row) => row.sessionId)
		.join(", ") || undefined
);
check(
	"every archived row has a non-empty title",
	value.archived.every((row) => typeof row.title === "string" && row.title !== "")
);

console.log("\n  archived rows:");
for (const row of value.archived) {
	console.log(`   - ${row.title}`);
	console.log(`     ${row.sessionId}  ws=${row.workspaceTitle ?? "-"}  ${row.files} file(s)  ${row.bytes} B  slug=${row.slug}`);
}
console.log("");

// ── 坏信封：一律 200 + 错误信封（跟 Connection 自己一致） ────────────────
const mismatched = await invoke("snapshot", {}, { method: "session-curator/restore" });
check(
	"method mismatch is rejected inside the envelope",
	mismatched.ok === false && mismatched.error.code === "session-curator/bad-request",
	JSON.stringify(mismatched.error)
);

const route = routes.get(`${CHANNEL_PATH}/snapshot`);
const brokenEnvelope = await (
	await route.fetch(
		new Request(`http://127.0.0.1${CHANNEL_PATH}/snapshot`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{not json"
		})
	)
).json();
check(
	"non-JSON body answers a bad-request envelope instead of throwing",
	brokenEnvelope.rpcId === "invalid-request" &&
		brokenEnvelope.result.ok === false &&
		brokenEnvelope.result.error.code === "session-curator/bad-request",
	JSON.stringify(brokenEnvelope)
);

// ── 逐项语义 ─────────────────────────────────────────────────────────────
const missing = await invoke("purge", { ids: ["session-does-not-exist"] });
check(
	"missing trash entry reports a per-item failure",
	missing.ok === true && missing.value.results.length === 1 && missing.value.results[0].ok === false,
	JSON.stringify(missing.value.results)
);

const malformed = await invoke("unarchive", { ids: "not-an-array" });
check("malformed ids normalize to an empty list", malformed.value.results.length === 0);

const noIds = await invoke("restore", {});
check("missing ids is not an error", noIds.ok === true && noIds.value.results.length === 0);

// ── 版本比较：决定配置页要不要弹"有新版本" ──────────────────────────────
// 直接单测纯函数，不打网络（`check-update` 端点本身由上面的路由形状覆盖）。
check(
	"a higher patch counts as an upgrade",
	compareVersions("0.1.1", "0.1.0") === 1 && compareVersions("0.2.0", "0.1.9") === 1,
	`${compareVersions("0.1.1", "0.1.0")}, ${compareVersions("0.2.0", "0.1.9")}`
);
check("the same version counts as current", compareVersions("0.1.0", "0.1.0") === 0 && compareVersions("v0.1.0", "0.1.0") === 0);
check(
	"a prerelease ranks below its release",
	compareVersions("0.1.0-rc.1", "0.1.0") === -1 && compareVersions("0.1.0", "0.1.0-rc.1") === 1
);
check("a lower version never looks like an upgrade", compareVersions("0.0.9", "0.1.0") === -1);

// ── 保留策略的判据（纯函数）：预览与真删共用同一份规则 ────────────────────
const DAY_MS = 24 * 60 * 60 * 1000;
const nowish = Date.now();
check(
	"the cutoff is `now - days` and never degenerates into `now`",
	Math.abs(nowish - 30 * DAY_MS - retentionCutoff(30)) < 5000 &&
		retentionCutoff(0) < nowish - 0.9 * DAY_MS &&
		retentionCutoff(Number.NaN) < nowish - 0.9 * DAY_MS &&
		retentionCutoff(1e9) > nowish - 3651 * DAY_MS,
	`30d=${new Date(retentionCutoff(30)).toISOString()} 0d=${new Date(retentionCutoff(0)).toISOString()}`
);
// `isExpired(row, cutoff)` 是**纯**判定：截止时间由调用方算好传进来（预览与真删各自
// `retentionCutoff(days)` 一次），所以这里的边界值可以贴着 cutoff 构造，不会有抖动。
const cutoff = retentionCutoff(30);
const trashRow = (sessionId, deletedAt, restorable) => ({ sessionId, deletedAt, restorable });
check(
	"only entries with a deletion time, a restore slug and an age past the cutoff count as expired",
	isExpired(trashRow("old", cutoff - DAY_MS, true), cutoff) === true &&
		isExpired(trashRow("fresh", cutoff + DAY_MS, true), cutoff) === false &&
		isExpired(trashRow("no-time", 0, true), cutoff) === false &&
		isExpired(trashRow("no-slug", cutoff - DAY_MS, false), cutoff) === false,
	`old=${isExpired(trashRow("old", cutoff - DAY_MS, true), cutoff)} fresh=${isExpired(trashRow("fresh", cutoff + DAY_MS, true), cutoff)} noTime=${isExpired(trashRow("no-time", 0, true), cutoff)} noSlug=${isExpired(trashRow("no-slug", cutoff - DAY_MS, false), cutoff)}`
);

// ── 性能：体积统计按目录 mtime 缓存（同一次快照内重复访问不再遍历） ───────
// `dirStats()` 只吃一个绝对路径，所以这一段**不需要**换 DSH_HOME。
const statsHome = await mkdtemp(join(tmpdir(), "dsh-curator-stats-"));
try {
	const dir = join(statsHome, "sessions", "--C-Data-Cache--", "session-cache");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "session.jsonl"), "0123456789", "utf8");
	forgetDirStats();
	const firstStats = await dirStats(dir);
	const secondStats = await dirStats(dir);
	check(
		"dirStats reports the top-level file count and bytes",
		firstStats.bytes === 10 && firstStats.files === 1,
		JSON.stringify(firstStats)
	);
	check(
		"a second read of an unchanged directory answers from the cache",
		secondStats.bytes === 10 && secondStats.files === 1,
		JSON.stringify(secondStats)
	);
	// 新增一个文件 → 缓存必须失效，重新统计（否则体积会永远停在旧值）。
	// Windows 上目录 mtime 的落盘是**异步**的：`writeFile` 一返回就 `stat` 可能还是旧值，
	// 所以这里等它真的动一下再断言，免得测成"文件系统快不快"。
	await writeFile(join(dir, "extra.jsonl"), "01234", "utf8");
	const baseMtime = (await stat(dir)).mtimeMs;
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if ((await stat(dir)).mtimeMs !== baseMtime) break;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	const grown = await dirStats(dir);
	check("adding a file invalidates the cached size", grown.bytes === 15 && grown.files === 2, JSON.stringify(grown));
	// 缓存是**按目录**记的：另一个目录不能读到上面那份结果。
	const other = join(statsHome, "sessions", "--C-Data-Cache--", "session-other");
	await mkdir(other, { recursive: true });
	await writeFile(join(other, "a.jsonl"), "123", "utf8");
	const otherStats = await dirStats(other);
	check("the cache is keyed per directory", otherStats.bytes === 3 && otherStats.files === 1, JSON.stringify(otherStats));
	// 目录整个不在时仍然是"0 文件 0 字节"，而不是抛错（快照里到处都在用它）。
	const missing = await dirStats(join(statsHome, "nope"));
	check("a missing directory answers zeroes instead of throwing", missing.bytes === 0 && missing.files === 0, JSON.stringify(missing));
} finally {
	await rm(statsHome, { recursive: true, force: true });
}

// ── 软删除语义：会话要被"藏起来"，而且只出现在回收站页签 ─────────────────
// 这一段用**临时 DSH_HOME**（插件每次解析 home 都读 process.env.DSH_HOME），
// 所以可以真实地搬目录、恢复、永久删除，绝不碰真实数据。
console.log("\n── 软删除语义（临时 DSH_HOME） ──");
const realHome = process.env.DSH_HOME;
const tempHome = await mkdtemp(join(tmpdir(), "dsh-curator-smoke-"));
const SLUG = "--C-Data-Smoke--";
const SMOKE_CWD = "C:\\Data\\Smoke";
const ARCHIVED = "session-smoke-archived";
const ORDINARY = "session-smoke-ordinary";
const DOOMED = "session-smoke-doomed";

/**
 * 侧边栏归属判定 —— 逐字照抄 `@deepseek-ai/dsh-client-ui-workspace` 的
 * `groupByWorkspace()`：客户端 list 里认得、且不属于任何工作区、且**不在归档集合**里的会话，
 * 会被收进 **未分组**（locale key `group.ungrouped`）。那就是用户看到的那条幽灵行。
 */
function sidebarBucket(sessionId, clientList, workspaces, archived) {
	if (!clientList.includes(sessionId)) return "absent";
	// 顺序照抄真实实现：先 `sessionVisible()`（默认过滤里归档会话一律不渲染，**哪怕它
	// 还挂在某个工作区名下** —— 归档不动记账），再决定它落在哪个分组里。
	if (archived.includes(sessionId)) return "archived";
	if (workspaces.some((workspace) => workspace.sessionIds.includes(sessionId))) return "workspace";
	return "ungrouped";
}

function fakeWorkspace(id, path, sessionIds) {
	return {
		id,
		path,
		title: "Smoke",
		sessionIds: [...sessionIds],
		async attachSession(sessionId) {
			if (!this.sessionIds.includes(sessionId)) this.sessionIds.unshift(sessionId);
		},
		async detachSession(sessionId) {
			this.sessionIds = this.sessionIds.filter((value) => value !== sessionId);
		}
	};
}

function fakeRegistry(sessionIds) {
	return {
		workspaces: [fakeWorkspace("ws-smoke", SMOKE_CWD, sessionIds)],
		archivedSessionIds: [],
		pinnedSessionIds: [],
		list() {
			return this.workspaces;
		},
		async resolveByPath(path) {
			return this.workspaces.find((candidate) => candidate.path === path);
		},
		async archiveSession(sessionId) {
			if (!this.archivedSessionIds.includes(sessionId)) this.archivedSessionIds.push(sessionId);
			this.pinnedSessionIds = this.pinnedSessionIds.filter((value) => value !== sessionId);
		},
		async unarchiveSession(sessionId) {
			this.archivedSessionIds = this.archivedSessionIds.filter((value) => value !== sessionId);
		},
		async unpinSession(sessionId) {
			this.pinnedSessionIds = this.pinnedSessionIds.filter((value) => value !== sessionId);
		}
	};
}

/** 再挂一个插件实例（自己的路由表 + 自己的假 registry），路由仍走真实 Request。 */
function mount(registry) {
	const localRoutes = new Map();
	const localDisposers = [];
	apply({
		connection: {
			fetch: {
				register: (route) => {
					localRoutes.set(route.path, route);
					const dispose = () => localRoutes.delete(route.path);
					localDisposers.push(dispose);
					return dispose;
				}
			}
		},
		workspaceRegistry: registry,
		effect: (callback) => {
			const dispose = callback();
			if (typeof dispose === "function") localDisposers.push(dispose);
			return dispose;
		},
		waterfall: async () => [],
		logger: { warn: () => {} }
	});
	return { disposers: localDisposers, invoke: invokerFor(localRoutes) };
}

async function seedSession(sessionId, title) {
	await mkdir(join(tempHome, "sessions", SLUG, sessionId), { recursive: true });
	await writeFile(join(tempHome, "sessions", SLUG, sessionId, "session.jsonl"), "{}\n", "utf8");
	await mkdir(join(tempHome, "storages", "session_projcache", "sessions"), { recursive: true });
	await writeFile(
		join(tempHome, "storages", "session_projcache", "sessions", `${sessionId}.json`),
		JSON.stringify({ record: { rows: { title: { val: title } }, identity: { cwd: SMOKE_CWD, createdAt: 1 } } }),
		"utf8"
	);
}

const trashDirOf = (sessionId) => join(tempHome, "storages", "session-manager", "trash", sessionId);
const trashMetaOf = async (sessionId) => JSON.parse(await readFile(join(trashDirOf(sessionId), "__trash.json"), "utf8"));

try {
	process.env.DSH_HOME = tempHome;
	await seedSession(ARCHIVED, "已归档的会话");
	await seedSession(ORDINARY, "普通会话");
	await seedSession(DOOMED, "待永久删除");

	const registry2 = fakeRegistry([ARCHIVED, ORDINARY, DOOMED]);
	registry2.archivedSessionIds = [ARCHIVED];
	const plugin = mount(registry2);
	// 客户端那份会话列表是实时快照：我们把目录搬走，它也不会自己掉 —— 三条都还在。
	const clientList = [ARCHIVED, ORDINARY, DOOMED];
	const bucketOf = (sessionId) => sidebarBucket(sessionId, clientList, registry2.workspaces, registry2.archivedSessionIds);

	check("an archived session is hidden from the sidebar beforehand", bucketOf(ARCHIVED) === "archived", bucketOf(ARCHIVED));

	// ── describe（第十个端点）：单个会话的事实，侧边栏 hover 卡片的数据源 ──────
	const described = await plugin.invoke("describe", { ids: [ORDINARY] });
	check(
		"describe reports one on-disk session with its stats",
		described.ok === true &&
			described.value.sessionId === ORDINARY &&
			described.value.title === "普通会话" &&
			described.value.cwd === SMOKE_CWD &&
			described.value.slug === SLUG &&
			described.value.bytes > 0 &&
			described.value.files === 1 &&
			described.value.onDisk === true &&
			described.value.trashed === false &&
			described.value.deletedAt === null,
		JSON.stringify(described.value ?? described.error)
	);
	check(
		"describe carries the archive flag, so the hover card can say 已归档",
		(await plugin.invoke("describe", { ids: [ARCHIVED] })).value.archived === true &&
			described.value.archived === false &&
			described.value.pinned === false
	);
	// 多余的 id 直接忽略：hover 卡片一次只问一个，但线协议仍然是 ids 数组。
	check("describe only looks at the first id", (await plugin.invoke("describe", { ids: [ORDINARY, "session-nope"] })).ok === true);
	const unknownDetail = await plugin.invoke("describe", { ids: ["session-not-there"] });
	check(
		"describe rejects an unknown session inside the envelope (no 500)",
		unknownDetail.ok === false && unknownDetail.error.code === "session-curator/error",
		JSON.stringify(unknownDetail.error)
	);
	const noDetailId = await plugin.invoke("describe", {});
	check("describe without ids is an envelope error, not a crash", noDetailId.ok === false, JSON.stringify(noDetailId.error));

	const trashedArchived = await plugin.invoke("trash", { ids: [ARCHIVED] });
	const archivedSteps = trashedArchived.value.results[0]?.steps ?? [];
	check(
		"trashing an archived session succeeds",
		trashedArchived.value.results[0]?.ok === true,
		JSON.stringify(trashedArchived.value.results[0])
	);
	check("it is NOT unarchived on the way in (the old bug)", !archivedSteps.includes("unarchive"), `steps=[${archivedSteps.join(",")}]`);
	check(
		"it stays archived, so DSH keeps hiding it",
		registry2.archivedSessionIds.includes(ARCHIVED),
		`archived=[${registry2.archivedSessionIds.join(",")}]`
	);
	check("the sidebar does not gain an Ungrouped ghost row", bucketOf(ARCHIVED) === "archived", bucketOf(ARCHIVED));
	check(
		"its directory really moved into the trash",
		!existsSync(join(tempHome, "sessions", SLUG, ARCHIVED)) && existsSync(join(trashDirOf(ARCHIVED), "session.jsonl"))
	);
	check(
		"__trash.json records wasArchived: true",
		(await trashMetaOf(ARCHIVED)).wasArchived === true,
		JSON.stringify(await trashMetaOf(ARCHIVED))
	);
	check("snapshot.archived drops it (no phantom row)", !trashedArchived.value.archived.some((row) => row.sessionId === ARCHIVED));
	check(
		"snapshot.trashed lists it",
		trashedArchived.value.trashed.some((row) => row.sessionId === ARCHIVED)
	);

	await plugin.invoke("trash", { ids: [ORDINARY] });
	check(
		"an ordinary session is archived on the way in (otherwise it lands in Ungrouped)",
		registry2.archivedSessionIds.includes(ORDINARY) && bucketOf(ORDINARY) === "archived",
		`archived=[${registry2.archivedSessionIds.join(",")}] bucket=${bucketOf(ORDINARY)}`
	);
	check("__trash.json records wasArchived: false", (await trashMetaOf(ORDINARY)).wasArchived === false);

	// describe 对回收站条目的形状：状态、删除时间、能不能恢复 —— hover 卡片与
	// 设置面板的「恢复」禁用（`restorable`）用的都是这几个字段。
	const describedTrashed = await plugin.invoke("describe", { ids: [ORDINARY] });
	check(
		"describe reports a trashed session with its deletion time and restorable flag",
		describedTrashed.ok === true &&
			describedTrashed.value.trashed === true &&
			describedTrashed.value.onDisk === false &&
			describedTrashed.value.restorable === true &&
			describedTrashed.value.slug === SLUG &&
			typeof describedTrashed.value.deletedAt === "number" &&
			describedTrashed.value.deletedAt > 0,
		JSON.stringify(describedTrashed.value ?? describedTrashed.error)
	);

	const restoredOrdinary = await plugin.invoke("restore", { ids: [ORDINARY] });
	check(
		"restoring an ordinary session unarchives it again",
		!registry2.archivedSessionIds.includes(ORDINARY),
		JSON.stringify(restoredOrdinary.value.results[0])
	);
	check(
		"restoring re-attaches it to its original workspace",
		registry2.workspaces[0].sessionIds.includes(ORDINARY),
		registry2.workspaces[0].sessionIds.join(",")
	);

	await plugin.invoke("restore", { ids: [ARCHIVED] });
	check("restoring a previously archived session keeps it archived", registry2.archivedSessionIds.includes(ARCHIVED));
	check("and it is back on disk under its original slug", existsSync(join(tempHome, "sessions", SLUG, ARCHIVED)));
	check(
		"both restored sessions stay out of Ungrouped",
		[ARCHIVED, ORDINARY].every((id) => bucketOf(id) !== "ungrouped"),
		`${bucketOf(ARCHIVED)}, ${bucketOf(ORDINARY)}`
	);

	await plugin.invoke("trash", { ids: [DOOMED] });
	const purged = await plugin.invoke("purge", { ids: [DOOMED] });
	check(
		"purging drops the archive entry (no permanent ghost id)",
		!registry2.archivedSessionIds.includes(DOOMED),
		JSON.stringify(purged.value.results[0])
	);

	// ── 保留策略：预览（只读）与「清理 N 天前」（永久删除） ────────────────────
	const OLD = "session-smoke-old";
	const FRESH = "session-smoke-fresh";
	const CORRUPT = "session-smoke-corrupt";
	await seedSession(OLD, "很旧的会话");
	await seedSession(FRESH, "刚删的会话");
	await seedSession(CORRUPT, "缺元数据的旧会话");
	await plugin.invoke("trash", { ids: [OLD, FRESH, CORRUPT] });
	// 把删除时间改成"35 天前" / "1 天前"：`trash` 刚写下的都是 `Date.now()`。
	const metaPathOf = (sessionId) => join(trashDirOf(sessionId), "__trash.json");
	const agedMeta = JSON.parse(await readFile(metaPathOf(OLD), "utf8"));
	agedMeta.deletedAt = Date.now() - 35 * DAY_MS;
	await writeFile(metaPathOf(OLD), JSON.stringify(agedMeta), "utf8");
	const freshMeta = JSON.parse(await readFile(metaPathOf(FRESH), "utf8"));
	// 12 小时前：离任何一档（最小 1 天）都远，断言不会因为跑得慢而被边界吃掉。
	freshMeta.deletedAt = Date.now() - 12 * 60 * 60 * 1000;
	await writeFile(metaPathOf(FRESH), JSON.stringify(freshMeta), "utf8");
	// 老条目：没有 `__trash.json`（`listTrash()` 会给它 deletedAt: 0 / restorable: false）。
	await rm(metaPathOf(CORRUPT), { force: true });

	// 这条断言同时是"按目录 mtime 缓存"的回归：上一条 `purge` 已经把 DOOMED 的目录删掉，
	// 但 ARCHIVED / ORDINARY 等目录的内容一点没变 —— 缓存必须让它们照旧报出真实体积。
	const afterPurgeSnapshot = await plugin.invoke("snapshot", {});
	check(
		"a later snapshot still reports the real sizes of untouched directories (mtime cache)",
		afterPurgeSnapshot.value.archived.length > 0 && afterPurgeSnapshot.value.archived.every((row) => row.bytes > 0 && row.files === 1),
		JSON.stringify(afterPurgeSnapshot.value.archived.map((row) => `${row.sessionId}:${row.bytes}`))
	);
	// 连续两次快照：第二次应当整体命中缓存，结果必须**逐字一致**（含 totals）。
	const snapshotAgain = await plugin.invoke("snapshot", {});
	check(
		"two consecutive snapshots agree (bounded-concurrency + cache do not lose rows)",
		JSON.stringify(snapshotAgain.value) === JSON.stringify(afterPurgeSnapshot.value),
		`${afterPurgeSnapshot.value.archived.length} archived / ${afterPurgeSnapshot.value.trashed.length} trashed`
	);

	const stats = await plugin.invoke("trash-stats", { days: 30 });
	check(
		"trash-stats previews the cleanup without deleting anything",
		stats.ok === true &&
			stats.value.days === 30 &&
			stats.value.count === 1 &&
			stats.value.bytes > 0 &&
			stats.value.totalCount === 3 &&
			stats.value.totalBytes > stats.value.bytes &&
			stats.value.cutoff < Date.now(),
		JSON.stringify(stats.value)
	);
	check(
		"the preview only counts entries with a deletion time",
		stats.value.totalCount - stats.value.count === 2,
		`total=${stats.value.totalCount} expired=${stats.value.count}`
	);
	check(
		"nothing was removed by the preview",
		existsSync(trashDirOf(OLD)) && existsSync(trashDirOf(FRESH)) && existsSync(trashDirOf(CORRUPT))
	);

	const swept = await plugin.invoke("purge-older-than", { days: 30 });
	check(
		"purge-older-than removes exactly the previewed entry",
		swept.value.results.length === 1 && swept.value.results[0].sessionId === OLD && swept.value.results[0].ok === true,
		JSON.stringify(swept.value.results)
	);
	check("the old entry is gone from the trash", !existsSync(trashDirOf(OLD)));
	check(
		"the fresh and metadata-less entries are left alone",
		existsSync(trashDirOf(FRESH)) && existsSync(trashDirOf(CORRUPT)),
		`fresh=${existsSync(trashDirOf(FRESH))} corrupt=${existsSync(trashDirOf(CORRUPT))}`
	);
	check(
		"purge-older-than unarchives before deleting (no permanent ghost id)",
		!registry2.archivedSessionIds.includes(OLD),
		`archived=[${registry2.archivedSessionIds.join(",")}]`
	);
	// 缺字段 / 越界的 days 一律被归一化，绝不能变成"清空整个回收站"。
	const noDays = await plugin.invoke("trash-stats", {});
	const zeroDays = await plugin.invoke("purge-older-than", { days: 0 });
	check(
		"a missing or degenerate day count falls back instead of wiping the trash",
		noDays.value.days === 30 && noDays.value.count === 0 && zeroDays.value.results.length === 0 && existsSync(trashDirOf(FRESH)),
		`noDays=${noDays.value.days}/${noDays.value.count} zeroDays=${zeroDays.value.results.length}`
	);

	// ── 磁盘占用视图（只读，扫整个 sessions 根） ─────────────────────────────
	const usage = await plugin.invoke("usage", {});
	const usageValue = usage.value;
	// 此刻的账面：磁盘上 ARCHIVED + ORDINARY 两条；回收站里 FRESH + CORRUPT 两条
	//（OLD 刚被"清理 N 天前"带走、DOOMED 被永久删除）。
	check(
		"usage aggregates every session on disk plus the trash",
		usage.ok === true && usageValue.totalSessions === 4 && usageValue.onDiskSessions === 2 && usageValue.totalBytes > 0,
		JSON.stringify({ total: usageValue.totalSessions, onDisk: usageValue.onDiskSessions, bytes: usageValue.totalBytes })
	);
	check(
		"usage totals add up to the sum of its groups",
		usageValue.groups.reduce((sum, group) => sum + group.bytes, 0) === usageValue.totalBytes &&
			usageValue.groups.reduce((sum, group) => sum + group.count, 0) === usageValue.totalSessions,
		JSON.stringify(usageValue.groups)
	);
	// CORRUPT 没有 `__trash.json`（cwd 无从谈起），所以它落进"未知目录"那一组 ——
	// 与客户端列表分组的语义一致（`groups.ts` 的 `groupKeyOf`）。
	check(
		"usage groups by the original workspace folder and sorts by size",
		usageValue.groups.length === 2 &&
			usageValue.groups[0].title === "Smoke" &&
			usageValue.groups[0].count === 3 &&
			usageValue.groups[1].key === "unknown" &&
			usageValue.groups[1].count === 1 &&
			usageValue.groups[0].bytes >= usageValue.groups[1].bytes,
		JSON.stringify(usageValue.groups)
	);
	check(
		"the largest list is size-descending and capped",
		usageValue.largest.length > 0 &&
			usageValue.largest.length <= 5 &&
			usageValue.largest.every((row, index) => index === 0 || usageValue.largest[index - 1].bytes >= row.bytes) &&
			usageValue.largest.every((row) => row.bytes > 0),
		JSON.stringify(usageValue.largest.map((row) => `${row.sessionId}:${row.bytes}`))
	);
	check(
		"the oldest list is ascending by createdAt and flags trashed rows",
		usageValue.oldest.length > 0 &&
			usageValue.oldest[0].createdAt === 1 &&
			usageValue.oldest.some((row) => row.trashed === true && row.deletedAt !== null) &&
			usageValue.oldest.every((row) => row.archived === registry2.archivedSessionIds.includes(row.sessionId)),
		JSON.stringify(usageValue.oldest.map((row) => `${row.sessionId}:${row.createdAt}:${row.trashed}`))
	);

	// ── 复制路径 / 在资源管理器中显示 ───────────────────────────────────────
	const openPath = await plugin.invoke("open", { ids: [ARCHIVED], target: "path" });
	check(
		"open returns the on-disk session directory without touching the shell",
		openPath.ok === true &&
			openPath.value.sessionId === ARCHIVED &&
			openPath.value.revealed === false &&
			openPath.value.path.replace(/\\/g, "/").endsWith(`/sessions/${SLUG}/${ARCHIVED}`) &&
			existsSync(openPath.value.path),
		JSON.stringify(openPath.value ?? openPath.error)
	);
	// 回收站里的会话：目录搬到了回收站，`open` 也要找得到（"定位"对两个页签都成立）。
	const openTrashed = await plugin.invoke("open", { ids: [FRESH], target: "path" });
	check(
		"open also resolves a session sitting in the trash",
		openTrashed.ok === true && openTrashed.value.path === trashDirOf(FRESH),
		JSON.stringify(openTrashed.value ?? openTrashed.error)
	);
	const openMissing = await plugin.invoke("open", { ids: ["session-not-there"] });
	check(
		"open rejects an unknown session inside the envelope (no 500)",
		openMissing.ok === false && openMissing.error.code === "session-curator/error",
		JSON.stringify(openMissing.error)
	);
	// 路径校验：`open` 只吃 `sessionId`，路径由宿主自己拼；但 id 是个**非空字符串**就够了
	//（线协议不保证它不是一个相对路径），所以拼出来的结果必须再校验一次"落在允许的根下"。
	// 这里直接单测那道判据本身：`<root>` 相等、真子路径放行；兄弟目录（前缀相同但不带分隔符）
	// 与任何 `..` 逃逸一律拒绝。
	// **路径必须用 `join()` 拼**：判据比的是 `path.sep`，而 CI 跑在 Linux 上 —— 写死 `\\`
	// 的断言在那边必挂（2026-10-14 CI 首跑就是这条 `73/74`：`self=true child=false`）。
	const root = join(sep, "srv", "dsh", "sessions");
	const sibling = `${root}-evil`;
	const child = join(root, "--slug--", "session-1");
	check(
		"the path guard only admits the root itself and its real descendants",
		insideRoot(root, root) === true &&
			insideRoot(root, child) === true &&
			insideRoot(root, sibling) === false &&
			insideRoot(root, dirname(root)) === false &&
			insideRoot(root, join(sep, "nope")) === false,
		`self=${insideRoot(root, root)} child=${insideRoot(root, child)} sibling=${insideRoot(root, sibling)}`
	);
	// id 里带 `..` 时，拼出来的路径落在允许的根之外 —— 必须拒绝，而不是把它交给系统文件管理器。
	const escape = await plugin.invoke("open", { ids: ["../../../Windows"] });
	check(
		"open refuses a path that escapes the DSH session roots",
		escape.ok === false && escape.error.code === "session-curator/error",
		JSON.stringify(escape.error)
	);
	// 默认 target（缺字段 / 乱写）一律当只读的 "path"：绝不能让一个缺字段的请求去叫 shell。
	const defaultTarget = await plugin.invoke("open", { ids: [ARCHIVED], target: "nonsense" });
	check(
		"an unknown target degrades to the read-only path query",
		defaultTarget.ok === true && defaultTarget.value.revealed === false,
		JSON.stringify(defaultTarget.value ?? defaultTarget.error)
	);

	// ── `__trash.json` 的 schema 版本约定（字段表见 src/host/trash.ts 文件头） ────
	// 放在最后：上面那些断言都盯着"回收站里恰好几条 / 磁盘上恰好几条"的账面，
	// 这里再塞两条进去会把它们的数字挤歪。
	const NOVER = "session-smoke-noversion";
	const FUTURE = "session-smoke-future-meta";
	await seedSession(NOVER, "没有版本字段的老条目");
	await seedSession(FUTURE, "更新版本的插件写的条目");
	await plugin.invoke("trash", { ids: [NOVER, FUTURE] });
	const metaPath = (sessionId) => join(trashDirOf(sessionId), "__trash.json");

	// 缺 `version` = 最早那版（插件还叫 `dsh-session-manager` 的时代）写下的：必须照旧能恢复。
	const noVersionMeta = await trashMetaOf(NOVER);
	delete noVersionMeta.version;
	await writeFile(metaPath(NOVER), JSON.stringify(noVersionMeta), "utf8");
	const noVersionRestore = await plugin.invoke("restore", { ids: [NOVER] });
	check(
		"a trash entry without a version field (the oldest on-disk format) still restores",
		noVersionRestore.value.results[0]?.ok === true && existsSync(join(tempHome, "sessions", SLUG, NOVER)),
		JSON.stringify(noVersionRestore.value.results[0])
	);

	// 版本比插件新：语义不可猜 —— 拒绝，且**什么都不许动**（目录必须原地留在回收站里）。
	const futureMeta = await trashMetaOf(FUTURE);
	futureMeta.version = 99;
	await writeFile(metaPath(FUTURE), JSON.stringify(futureMeta), "utf8");
	const futureRestore = await plugin.invoke("restore", { ids: [FUTURE] });
	check(
		"a trash entry written by a newer schema version is refused, with the version in the reason",
		futureRestore.value.results[0]?.ok === false &&
			String(futureRestore.value.results[0]?.reason).includes("version 99") &&
			String(futureRestore.value.results[0]?.reason).includes("升级插件"),
		JSON.stringify(futureRestore.value.results[0])
	);
	check(
		"and refusing it leaves the trashed directory exactly where it was",
		existsSync(trashDirOf(FUTURE)) &&
			existsSync(join(trashDirOf(FUTURE), "session.jsonl")) &&
			!existsSync(join(tempHome, "sessions", SLUG, FUTURE)),
		`trash=${existsSync(trashDirOf(FUTURE))} sessions=${existsSync(join(tempHome, "sessions", SLUG, FUTURE))}`
	);

	for (const dispose of plugin.disposers.splice(0)) await dispose();
} finally {
	if (realHome === undefined) delete process.env.DSH_HOME;
	else process.env.DSH_HOME = realHome;
	await rm(tempHome, { recursive: true, force: true });
}

// ── 卸载：路由要跟着 fiber 一起摘掉 ──────────────────────────────────────
for (const dispose of disposers.splice(0)) await dispose();
check("unloading the plugin removes every route", routes.size === 0, [...routes.keys()].join(", ") || undefined);

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);

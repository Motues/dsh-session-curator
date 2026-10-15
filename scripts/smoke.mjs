/**
 * 宿主半区自检 —— 不需要 DSH，也不需要浏览器。
 *
 * 做法：用从真实 `<DSH_HOME>/storages/workspace.json` 读出的工作区/归档/置顶集合搭一个
 * 假 `workspaceRegistry`，再用假 `ctx` 调 `apply(ctx)`，然后**用真实 `Request` 走一遍
 * 插件注册的精确 Fetch 路由**（`/api/session-curator/<endpoint>`），信封、分发、
 * 入参归一化一起测。那个文件**不存在**时降级成空表（没装过 DSH 的机器就是这种情况，见
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
 * `snapshot` 会真实读取 `<DSH_HOME>`（会话目录、投影缓存），所以这条路径上的
 * 扫描、标题/cwd 投影、体积统计、错误信封与入参归一化都会被覆盖。
 *
 * 最后一段换到**临时 DSH_HOME**，用一个按 `dsh-workspace` 真实语义最小化实现的假 registry
 * 真跑一遍 `delete`（物理删除），断言的是"删除之后会话目录必须真的没了，而且归档 / 置顶 /
 * 工作区三处记账也必须清干净"——后者是"删掉之后 archivedSessionIds 里还留着 id、DSH 一直
 * 以为它归档着"那种永久幽灵的回归测试。
 *
 * 用法：`node scripts/smoke.mjs`（可用 `DSH_HOME` 指定别的 home）。
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { apply, compareVersions, dirStats, forgetDirStats, inject, insideRoot, name } from "../lib/index.js";

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
 * 为什么要有这条降级：没装过 DSH 的机器（例如一台干净的 Linux 机器）上 `<DSH_HOME>` 根本不存在，
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
const EXPECTED_ENDPOINTS = ["snapshot", "describe", "archive", "unarchive", "pin", "unpin", "delete", "usage", "open", "check-update"];

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
	["dshHome", "version", "sessionsDir", "archived", "pinned", "totals"].every((key) => key in value)
);
check(
	"snapshot reports the package version (config page shows it as v…)",
	value.version === JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version,
	String(value.version)
);
// 期望集合 = 归档集合 ∩ 磁盘上真实存在：`archivedSessionIds` 是只增不减的记账，
// 目录已经不在的 id 不该再出现在"已归档"页签里。
const onDiskIds = new Set();
for (const slug of await readdir(join(home, "sessions"), { withFileTypes: true }).catch(() => [])) {
	if (!slug.isDirectory()) continue;
	for (const entry of await readdir(join(home, "sessions", slug.name), { withFileTypes: true }).catch(() => [])) {
		if (entry.isDirectory()) onDiskIds.add(entry.name);
	}
}
const expectedArchived = registry.archivedSessionIds.filter((id) => onDiskIds.has(id));
check(
	"archived rows are exactly the archived ids still on disk",
	value.archived.length === expectedArchived.length && value.archived.every((row) => expectedArchived.includes(row.sessionId)),
	`${value.archived.length} rows (expected ${expectedArchived.length}), ${value.totals.archivedBytes} B`
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
const mismatched = await invoke("snapshot", {}, { method: "session-curator/delete" });
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
const missing = await invoke("delete", { ids: ["session-does-not-exist"] });
check(
	"deleting an unknown session reports a per-item failure",
	missing.ok === true && missing.value.results.length === 1 && missing.value.results[0].ok === false,
	JSON.stringify(missing.value.results)
);

const malformed = await invoke("unarchive", { ids: "not-an-array" });
check("malformed ids normalize to an empty list", malformed.value.results.length === 0);

const noIds = await invoke("delete", {});
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

// ── 物理删除语义：目录必须真的没了，三处记账必须清干净 ───────────────────
// 这一段用**临时 DSH_HOME**（插件每次解析 home 都读 process.env.DSH_HOME），
console.log("\n── 物理删除语义（临时 DSH_HOME） ──");
const realHome = process.env.DSH_HOME;
const realSessionId = process.env.DSH_SESSION_ID;
const tempHome = await mkdtemp(join(tmpdir(), "dsh-curator-smoke-"));
const SLUG = "--C-Data-Smoke--";
const SMOKE_CWD = "C:\\Data\\Smoke";
const ARCHIVED = "session-smoke-archived";
const ORDINARY = "session-smoke-ordinary";
const PINNED = "session-smoke-pinned";
const RUNNING = "session-smoke-running";
const CURRENT = "session-smoke-current";

/**
 * 侧边栏归属判定 —— 逐字照抄 `@deepseek-ai/dsh-client-ui-workspace` 的
 * `groupByWorkspace()`：客户端 list 里认得、且不属于任何工作区、且**不在归档集合**里的会话，
 * 会被收进 **未分组**（locale key `group.ungrouped`）。
 *
 * 物理删除之后这个判定只用来验证"记账清干净了"：目录已经删掉，而客户端那份 list 是旧快照
 * （插件拿不到它的写接口），所以这里只断言归档集合与工作区记账都不再包含它。
 */
function sidebarBucket(sessionId, clientList, workspaces, archived) {
	if (!clientList.includes(sessionId)) return "absent";
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

/**
 * 再挂一个插件实例（自己的路由表 + 自己的假 registry），路由仍走真实 Request。
 *
 * `activeIds` 里的会话在 `workspace/session-activity` 上被报成"正在跑"：删除端点必须
 * 逐项拒绝它（与官方归档同一条活动判据）。
 */
function mount(registry, activeIds = []) {
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
		waterfall: async (name, payload) => (activeIds.includes(payload.sessionId) ? [{ id: "run" }] : []),
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

const sessionDirOf = (sessionId) => join(tempHome, "sessions", SLUG, sessionId);
const projCacheOf = (sessionId) => join(tempHome, "storages", "session_projcache", "sessions", `${sessionId}.json`);

try {
	process.env.DSH_HOME = tempHome;
	await seedSession(ARCHIVED, "已归档的会话");
	await seedSession(ORDINARY, "普通会话");
	await seedSession(PINNED, "置顶的会话");
	await seedSession(RUNNING, "运行中的会话");
	await seedSession(CURRENT, "当前使用的会话");

	const registry2 = fakeRegistry([ARCHIVED, ORDINARY, PINNED, RUNNING, CURRENT]);
	registry2.archivedSessionIds = [ARCHIVED];
	registry2.pinnedSessionIds = [PINNED];
	const plugin = mount(registry2, [RUNNING]);
	// 客户端那份会话列表是实时快照：目录删了它也不会自己掉 —— 五条都还在（这就是下面
	// 只断言"记账里没有它"、而不断言"侧边栏里没有它"的原因）。
	const clientList = [ARCHIVED, ORDINARY, PINNED, RUNNING, CURRENT];
	const bucketOf = (sessionId) => sidebarBucket(sessionId, clientList, registry2.workspaces, registry2.archivedSessionIds);

	check("an archived session is hidden from the sidebar beforehand", bucketOf(ARCHIVED) === "archived", bucketOf(ARCHIVED));

	// ── describe：单个会话的事实，侧边栏 hover 卡片的数据源 ───────────────
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
			described.value.onDisk === true,
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

	// ── 删除一个"已归档"的会话：归档记账 + 工作区记账 + 目录 + 投影缓存都要清 ──
	const deletedArchived = await plugin.invoke("delete", { ids: [ARCHIVED] });
	const archivedSteps = deletedArchived.value.results[0]?.steps ?? [];
	check(
		"deleting an archived session succeeds",
		deletedArchived.value.results[0]?.ok === true,
		JSON.stringify(deletedArchived.value.results[0])
	);
	check("it is unarchived first (no permanent ghost id)", archivedSteps.includes("unarchive"), `steps=[${archivedSteps.join(",")}]`);
	check(
		"the archive bookkeeping drops the id",
		!registry2.archivedSessionIds.includes(ARCHIVED),
		`archived=[${registry2.archivedSessionIds.join(",")}]`
	);
	check("the archived session is no longer treated as hidden", bucketOf(ARCHIVED) !== "archived", bucketOf(ARCHIVED));
	check(
		"the workspace bookkeeping drops the id too",
		!registry2.workspaces[0].sessionIds.includes(ARCHIVED),
		registry2.workspaces[0].sessionIds.join(",")
	);
	check("its directory is really gone from disk", !existsSync(sessionDirOf(ARCHIVED)));
	check("its projection cache is gone too", !existsSync(projCacheOf(ARCHIVED)));
	check(
		"the snapshot no longer lists it anywhere",
		!deletedArchived.value.archived.some((row) => row.sessionId === ARCHIVED) &&
			!deletedArchived.value.pinned.some((row) => row.sessionId === ARCHIVED)
	);
	check("describing it afterwards fails like any unknown id", (await plugin.invoke("describe", { ids: [ARCHIVED] })).ok === false);

	// ── 删除一个置顶的普通会话：取消置顶 + 删目录 ─────────────────────────
	const deletedPinned = await plugin.invoke("delete", { ids: [PINNED] });
	const pinnedSteps = deletedPinned.value.results[0]?.steps ?? [];
	check(
		"deleting a pinned session succeeds and unpins it first",
		deletedPinned.value.results[0]?.ok === true && pinnedSteps.includes("unpin"),
		`steps=[${pinnedSteps.join(",")}]`
	);
	check("the pin bookkeeping drops the id", !registry2.pinnedSessionIds.includes(PINNED), registry2.pinnedSessionIds.join(","));
	check("the pinned session's directory is gone", !existsSync(sessionDirOf(PINNED)));

	// ── 当前正在使用的会话：拒绝删除（DSH_SESSION_ID） ────────────────────
	process.env.DSH_SESSION_ID = CURRENT;
	const deletedCurrent = await plugin.invoke("delete", { ids: [CURRENT] });
	check(
		"the session currently in use is refused",
		deletedCurrent.value.results[0]?.ok === false && String(deletedCurrent.value.results[0]?.reason).includes("当前正在使用"),
		JSON.stringify(deletedCurrent.value.results[0])
	);
	check("and its directory is left alone", existsSync(join(sessionDirOf(CURRENT), "session.jsonl")));
	delete process.env.DSH_SESSION_ID;
	if (realSessionId !== undefined) process.env.DSH_SESSION_ID = realSessionId;
	// 不再"正在使用"之后就能删掉：也顺带证明拒绝的依据就是那个环境变量。
	const deletedCurrentAgain = await plugin.invoke("delete", { ids: [CURRENT] });
	check("once it is no longer the current session it deletes normally", deletedCurrentAgain.value.results[0]?.ok === true);
	check("and then its directory is gone", !existsSync(sessionDirOf(CURRENT)));

	// ── 正在跑的会话：逐项拒绝，同一批里的其余项不受影响 ───────────────────
	const deletedRunning = await plugin.invoke("delete", { ids: [RUNNING, ORDINARY] });
	check(
		"a running session is refused item by item, without touching the rest",
		deletedRunning.value.results.length === 2 &&
			deletedRunning.value.results[0].ok === false &&
			String(deletedRunning.value.results[0].reason).includes("正在运行") &&
			deletedRunning.value.results[1].ok === true &&
			deletedRunning.value.results[1].sessionId === ORDINARY,
		JSON.stringify(deletedRunning.value.results)
	);
	check(
		"the running session's directory is left exactly where it was",
		existsSync(join(sessionDirOf(RUNNING), "session.jsonl")),
		`running=${existsSync(sessionDirOf(RUNNING))}`
	);
	check("the ordinary session in the same batch really went away", !existsSync(sessionDirOf(ORDINARY)));

	// 未知 id 一律是逐项失败，不是传输层异常。
	const missingId = await plugin.invoke("delete", { ids: ["session-not-there"] });
	check(
		"deleting an unknown session reports a per-item failure",
		missingId.value.results[0]?.ok === false && String(missingId.value.results[0]?.reason).includes("找不到"),
		JSON.stringify(missingId.value.results[0])
	);

	// ── 磁盘占用视图（只读，扫整个 sessions 根） ─────────────────────────
	const usage = await plugin.invoke("usage", {});
	const usageValue = usage.value;
	// 此刻的账面：只有 RUNNING 还在磁盘上（其余四条都删了）。
	check(
		"usage aggregates every session still on disk",
		usage.ok === true && usageValue.totalSessions === 1 && usageValue.totalBytes > 0,
		JSON.stringify({ total: usageValue.totalSessions, bytes: usageValue.totalBytes })
	);
	check(
		"usage totals add up to the sum of its groups",
		usageValue.groups.reduce((sum, group) => sum + group.bytes, 0) === usageValue.totalBytes &&
			usageValue.groups.reduce((sum, group) => sum + group.count, 0) === usageValue.totalSessions,
		JSON.stringify(usageValue.groups)
	);
	check(
		"the largest list carries the surviving session and its archived flag",
		usageValue.largest.length === 1 && usageValue.largest[0].sessionId === RUNNING && usageValue.largest[0].archived === false,
		JSON.stringify(usageValue.largest)
	);
	check(
		"a running session is flagged by the usage view",
		usageValue.oldest.some((row) => row.sessionId === RUNNING && row.active === true),
		JSON.stringify(usageValue.oldest.map((row) => `${row.sessionId}:${row.active}`))
	);

	// ── 复制路径 / 在资源管理器中显示 ───────────────────────────────────
	const openPath = await plugin.invoke("open", { ids: [RUNNING], target: "path" });
	check(
		"open returns the on-disk session directory without touching the shell",
		openPath.ok === true &&
			openPath.value.sessionId === RUNNING &&
			openPath.value.revealed === false &&
			openPath.value.path.replace(/\\/g, "/").endsWith(`/sessions/${SLUG}/${RUNNING}`) &&
			existsSync(openPath.value.path),
		JSON.stringify(openPath.value ?? openPath.error)
	);
	const openMissing = await plugin.invoke("open", { ids: ["session-not-there"] });
	check(
		"open rejects an unknown session inside the envelope (no 500)",
		openMissing.ok === false && openMissing.error.code === "session-curator/error",
		JSON.stringify(openMissing.error)
	);
	// 路径校验：`open` 只吃 `sessionId`，路径由宿主自己拼；但 id 是个**非空字符串**就够了
	//（线协议不保证它不是一个相对路径），所以拼出来的结果必须再校验一次"落在允许的根下"。
	// **路径必须用 `join()` 拼**：判据比的是 `path.sep`（2026-10-14 这条断言曾经写死 `\\`，
	// 于是在 Linux 上挂成 73/74 —— 判据本身没问题，是断言不可移植）。
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
	const defaultTarget = await plugin.invoke("open", { ids: [RUNNING], target: "nonsense" });
	check(
		"an unknown target degrades to the read-only path query",
		defaultTarget.ok === true && defaultTarget.value.revealed === false,
		JSON.stringify(defaultTarget.value ?? defaultTarget.error)
	);
	for (const dispose of plugin.disposers.splice(0)) await dispose();
} finally {
	if (realHome === undefined) delete process.env.DSH_HOME;
	else process.env.DSH_HOME = realHome;
	// `DSH_SESSION_ID` 是全局的：拒绝删除当前会话那一段会临时改它，异常路径也必须还原。
	if (realSessionId === undefined) delete process.env.DSH_SESSION_ID;
	else process.env.DSH_SESSION_ID = realSessionId;
	await rm(tempHome, { recursive: true, force: true });
}

// ── 卸载：路由要跟着 fiber 一起摘掉 ──────────────────────────────────────
for (const dispose of disposers.splice(0)) await dispose();
check("unloading the plugin removes every route", routes.size === 0, [...routes.keys()].join(", ") || undefined);

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);

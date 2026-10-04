/**
 * 宿主半区自检 —— 不需要 DSH，也不需要浏览器。
 *
 * 做法：用从真实 `<DSH_HOME>/storages/workspace.json` 读出的工作区/归档/置顶集合搭一个
 * 假 `workspaceRegistry`，再用假 `ctx` 调 `apply(ctx)`，然后**用真实 `Request` 走一遍
 * 插件注册的精确 Fetch 路由**（`/api/session-curator/<endpoint>`），信封、分发、
 * 入参归一化一起测。
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
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { apply, compareVersions, inject, name } from "../lib/index.js";

function dshHome() {
	const configured = process.env.DSH_HOME;
	if (typeof configured === "string" && configured.trim() !== "") return resolve(configured.trim());
	return resolve(join(homedir(), ".dsh"));
}

const home = dshHome();
const workspaceFile = join(home, "storages", "workspace.json");

const raw = JSON.parse(await readFile(workspaceFile, "utf8"));
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
const EXPECTED_ENDPOINTS = ["snapshot", "archive", "unarchive", "pin", "unpin", "trash", "restore", "purge", "check-update"];

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
console.log(`workspace.json: ${workspaces.length} workspaces, ${registry.archivedSessionIds.length} archived, ${registry.pinnedSessionIds.length} pinned\n`);

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
check("snapshot shape", ["dshHome", "version", "trashDir", "sessionsDir", "archived", "pinned", "trashed", "totals"].every((key) => key in value));
check("snapshot reports the package version (config page shows it as v…)", value.version === JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version, String(value.version));
check("trash lives under storages/session-manager", value.trashDir.replace(/\\/g, "/").endsWith("/storages/session-manager/trash"), value.trashDir);
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
	value.archived.filter((row) => trashedIds.has(row.sessionId)).map((row) => row.sessionId).join(", ") || undefined
);
check("every archived row resolved its on-disk directory", value.archived.every((row) => row.onDisk), value.archived.filter((row) => !row.onDisk).map((row) => row.sessionId).join(", ") || undefined);
check("every archived row has a non-empty title", value.archived.every((row) => typeof row.title === "string" && row.title !== ""));

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
const brokenEnvelope = await (await route.fetch(new Request(`http://127.0.0.1${CHANNEL_PATH}/snapshot`, {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: "{not json"
}))).json();
check(
	"non-JSON body answers a bad-request envelope instead of throwing",
	brokenEnvelope.rpcId === "invalid-request" && brokenEnvelope.result.ok === false && brokenEnvelope.result.error.code === "session-curator/bad-request",
	JSON.stringify(brokenEnvelope)
);

// ── 逐项语义 ─────────────────────────────────────────────────────────────
const missing = await invoke("purge", { ids: ["session-does-not-exist"] });
check("missing trash entry reports a per-item failure", missing.ok === true && missing.value.results.length === 1 && missing.value.results[0].ok === false, JSON.stringify(missing.value.results));

const malformed = await invoke("unarchive", { ids: "not-an-array" });
check("malformed ids normalize to an empty list", malformed.value.results.length === 0);

const noIds = await invoke("restore", {});
check("missing ids is not an error", noIds.ok === true && noIds.value.results.length === 0);

// ── 版本比较：决定配置页要不要弹"有新版本" ──────────────────────────────
// 直接单测纯函数，不打网络（`check-update` 端点本身由上面的路由形状覆盖）。
check("a higher patch counts as an upgrade", compareVersions("0.1.1", "0.1.0") === 1 && compareVersions("0.2.0", "0.1.9") === 1, `${compareVersions("0.1.1", "0.1.0")}, ${compareVersions("0.2.0", "0.1.9")}`);
check("the same version counts as current", compareVersions("0.1.0", "0.1.0") === 0 && compareVersions("v0.1.0", "0.1.0") === 0);
check("a prerelease ranks below its release", compareVersions("0.1.0-rc.1", "0.1.0") === -1 && compareVersions("0.1.0", "0.1.0-rc.1") === 1);
check("a lower version never looks like an upgrade", compareVersions("0.0.9", "0.1.0") === -1);

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

	const trashedArchived = await plugin.invoke("trash", { ids: [ARCHIVED] });
	const archivedSteps = trashedArchived.value.results[0]?.steps ?? [];
	check("trashing an archived session succeeds", trashedArchived.value.results[0]?.ok === true, JSON.stringify(trashedArchived.value.results[0]));
	check("it is NOT unarchived on the way in (the old bug)", !archivedSteps.includes("unarchive"), `steps=[${archivedSteps.join(",")}]`);
	check("it stays archived, so DSH keeps hiding it", registry2.archivedSessionIds.includes(ARCHIVED), `archived=[${registry2.archivedSessionIds.join(",")}]`);
	check("the sidebar does not gain an Ungrouped ghost row", bucketOf(ARCHIVED) === "archived", bucketOf(ARCHIVED));
	check("its directory really moved into the trash", !existsSync(join(tempHome, "sessions", SLUG, ARCHIVED)) && existsSync(join(trashDirOf(ARCHIVED), "session.jsonl")));
	check("__trash.json records wasArchived: true", (await trashMetaOf(ARCHIVED)).wasArchived === true, JSON.stringify(await trashMetaOf(ARCHIVED)));
	check("snapshot.archived drops it (no phantom row)", !trashedArchived.value.archived.some((row) => row.sessionId === ARCHIVED));
	check("snapshot.trashed lists it", trashedArchived.value.trashed.some((row) => row.sessionId === ARCHIVED));

	await plugin.invoke("trash", { ids: [ORDINARY] });
	check(
		"an ordinary session is archived on the way in (otherwise it lands in Ungrouped)",
		registry2.archivedSessionIds.includes(ORDINARY) && bucketOf(ORDINARY) === "archived",
		`archived=[${registry2.archivedSessionIds.join(",")}] bucket=${bucketOf(ORDINARY)}`
	);
	check("__trash.json records wasArchived: false", (await trashMetaOf(ORDINARY)).wasArchived === false);

	const restoredOrdinary = await plugin.invoke("restore", { ids: [ORDINARY] });
	check("restoring an ordinary session unarchives it again", !registry2.archivedSessionIds.includes(ORDINARY), JSON.stringify(restoredOrdinary.value.results[0]));
	check("restoring re-attaches it to its original workspace", registry2.workspaces[0].sessionIds.includes(ORDINARY), registry2.workspaces[0].sessionIds.join(","));

	await plugin.invoke("restore", { ids: [ARCHIVED] });
	check("restoring a previously archived session keeps it archived", registry2.archivedSessionIds.includes(ARCHIVED));
	check("and it is back on disk under its original slug", existsSync(join(tempHome, "sessions", SLUG, ARCHIVED)));
	check("both restored sessions stay out of Ungrouped", [ARCHIVED, ORDINARY].every((id) => bucketOf(id) !== "ungrouped"), `${bucketOf(ARCHIVED)}, ${bucketOf(ORDINARY)}`);

	await plugin.invoke("trash", { ids: [DOOMED] });
	const purged = await plugin.invoke("purge", { ids: [DOOMED] });
	check("purging drops the archive entry (no permanent ghost id)", !registry2.archivedSessionIds.includes(DOOMED), JSON.stringify(purged.value.results[0]));

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

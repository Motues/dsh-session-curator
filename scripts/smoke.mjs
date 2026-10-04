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
 * 用法：`node scripts/smoke.mjs`（可用 `DSH_HOME` 指定别的 home）。
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { apply, inject, name } from "../lib/index.js";

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
const EXPECTED_ENDPOINTS = ["snapshot", "archive", "unarchive", "pin", "unpin", "trash", "restore", "purge"];

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
async function invoke(endpoint, payload, overrides) {
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
}

const snapshot = await invoke("snapshot", {});
check("snapshot succeeds", snapshot.ok, snapshot.ok ? undefined : JSON.stringify(snapshot.error));
if (!snapshot.ok) process.exit(1);

const value = snapshot.value;
check("snapshot shape", ["dshHome", "trashDir", "sessionsDir", "archived", "pinned", "trashed", "totals"].every((key) => key in value));
check("trash lives under storages/session-manager", value.trashDir.replace(/\\/g, "/").endsWith("/storages/session-manager/trash"), value.trashDir);
check("archived count matches workspace.json", value.archived.length === registry.archivedSessionIds.length, `${value.archived.length} rows, ${value.totals.archivedBytes} B`);
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

// ── 卸载：路由要跟着 fiber 一起摘掉 ──────────────────────────────────────
for (const dispose of disposers.splice(0)) await dispose();
check("unloading the plugin removes every route", routes.size === 0, [...routes.keys()].join(", ") || undefined);

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);

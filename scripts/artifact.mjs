/**
 * 产物自检 —— 对 `lib/`（提交进仓库、DSH 真正加载的东西）做结构断言。
 *
 * 这四件事以前是"人工审计"（AGENTS.md §5 / §8.2 第 4、10 条），靠人记得看；现在由本脚本
 * 挂进 `pnpm test` 的链路，改坏了当场红：
 *
 *   1. **客户端束的 `require(...)` 恰好是白名单那两个模块**（`react` +
 *      `@deepseek-ai/dsh-client-ui-primitives`）。多一个 external = 浏览器里模块表没有它，
 *      运行时报"找不到模块"；少一个 = 某段代码被打进了包里（本插件永远不该发生）。
 *   2. **宿主半区零 `@deepseek-ai/*` 裸标识符**。插件常以 junction / symlink 挂在 profile
 *      下，Node 按 realpath 解析裸标识符会直接 `Cannot find package`，插件根本加载不了；
 *      客户端束里的 `require("@deepseek-ai/…")` 是**运行时注入的模块表**调用，不算裸导入，
 *      所以先把 `require(...)` 摘掉再查。
 *   3. **`lib/client.js` 必须是 classic script**：浏览器用
 *      `document.createElement("script")` + `el.src` 加载它，ESM 的 `import` / `export`
 *      会直接抛语法错误。判定方式是**真的编译一遍**（`new Function(source)`）——
 *      函数体里出现模块语法就是 SyntaxError，比正则靠谱。
 *   4. **loader 外壳与清单一致**：`window.__ModuleLoader__.load({ id: <package name>, … })`。
 *
 * 用法：`node scripts/artifact.mjs`（`pnpm test` 会跑它）。
 */
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const lib = join(root, "lib");
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

/** 客户端束允许出现在 `require(...)` 里的模块 —— 与 `scripts/build.mjs` 的 external 一致。 */
const CLIENT_EXTERNAL = ["react", "@deepseek-ai/dsh-client-ui-primitives"];
/** `require("x")` / `require('x')`：esbuild 把 external 的 import 编译成对注入 require 的调用。 */
const REQUIRE_PATTERN = /\brequire\(\s*(["'])((?:[^"'\\]|\\.)*)\1\s*\)/gu;

const checks = [];
function check(label, condition, detail) {
	checks.push({ label, ok: Boolean(condition) });
	console.log(`${condition ? "  ok  " : " FAIL "} ${label}${detail === undefined ? "" : `  — ${detail}`}`);
}

/**
 * 判定规则本身也要有回归：`new Function` 是这套断言唯一的"编译器"，
 * 它要是哪天不认模块语法了，第 3 条会变成永远通过。
 */
function parsesAsClassicScript(source) {
	try {
		new Function(source);
		return true;
	} catch {
		return false;
	}
}
check(
	"the classic-script checker itself rejects import/export and accepts plain script code",
	parsesAsClassicScript("var x = require('react'); window.a = x;") === true &&
		parsesAsClassicScript("export const x = 1;") === false &&
		parsesAsClassicScript('import x from "y";') === false
);

/** `lib/` 下的每个 .js（含 `lib/host/*.js`）。 */
async function listLib() {
	const found = [];
	async function walk(dir) {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) await walk(path);
			else if (entry.name.endsWith(".js")) found.push(path);
		}
	}
	await walk(lib);
	return found;
}

const files = await listLib();
const names = files.map((file) => relative(lib, file).replace(/\\/g, "/"));
check(
	"lib/index.js and at least one lib/host/*.js exist (the host half is built)",
	names.includes("index.js") && names.some((name) => name.startsWith("host/")),
	names.join(", ")
);
check("lib/client.js exists (the client half is built)", names.includes("client.js"));

if (names.includes("client.js")) {
	const source = await readFile(join(lib, "client.js"), "utf8");
	const requires = [...source.matchAll(REQUIRE_PATTERN)].map((match) => match[2]);
	const unique = [...new Set(requires)].sort();
	check(
		"the client bundle requires exactly the injected externals",
		unique.length > 0 && unique.join(", ") === [...CLIENT_EXTERNAL].sort().join(", "),
		`require(${unique.map((name) => JSON.stringify(name)).join("), require(")})`
	);
	check(
		"lib/client.js parses as a classic script (no ESM import/export)",
		parsesAsClassicScript(source.charAt(0) === "\uFEFF" ? source.slice(1) : source)
	);
	const loader = /window\.__ModuleLoader__\.load\(\{\s*id: (["'])([^"']+)\1/u.exec(source);
	check(
		"the loader shell registers the package name from the manifest",
		loader !== null && loader[2] === manifest.name,
		loader === null ? "no window.__ModuleLoader__.load({ id: … }) found" : `id=${loader[2]} (manifest ${manifest.name})`
	);
	// 裸标识符：客户端束里合法的 `@deepseek-ai/…` 只会出现在 require(...) 里，
	// 而 `require` 又是 DSH 的模块表（运行时注入），所以摘掉 require(...) 再看。
	const stripped = source.replace(REQUIRE_PATTERN, "require(...)");
	check(
		"the client bundle carries no bare @deepseek-ai/* reference outside require()",
		!stripped.includes("@deepseek-ai/"),
		firstBareReference(stripped)
	);
}
const hostFiles = files.filter((file) => !file.endsWith("client.js"));
const offenders = [];
for (const file of hostFiles) {
	const text = await readFile(file, "utf8");
	const hit = bareImport(text);
	if (hit !== null) offenders.push(`${relative(root, file).replace(/\\/g, "/")}: ${hit}`);
}
check("the host half has zero @deepseek-ai/* bare imports (junction-safe)", offenders.length === 0, offenders.join(" | ") || undefined);

/**
 * 命中点前后各 60 字符，够看出是 import 还是别的。
 */
function firstBareReference(text) {
	const at = text.indexOf("@deepseek-ai/");
	return at === -1 ? undefined : JSON.stringify(text.slice(Math.max(0, at - 60), at + 40).replace(/\s+/g, " "));
}

/**
 * 找 `import`/`require` 形式的 `@deepseek-ai/*` 裸导入，返回命中的那一行。
 *
 * 为什么按行 + 先剥注释：本仓库的注释里**故意**写着这些包名（说明"为什么不 import 它"，
 * 例如 `paths.ts` 解释 `@deepseek-ai/dsh-home-paths`），拿 `text.includes()` 判会把
 * 正常的说明文字当成违规。真正要防的是"Node 会去解析的模块标识符"，不是注释里的包名。
 */
function bareImport(text) {
	for (const raw of text.split(/\r?\n/u)) {
		const code = raw
			.replace(/\/\/.*$/u, "")
			.replace(/^\s*\/?\*.*$/u, "")
			.replace(/^\s*\/\*.*$/u, "");
		if (/(?:^|[^\w$.])(?:import|require)\s*\(?\s*["']@deepseek-ai\//u.test(code)) return raw.trim();
		if (/\bfrom\s*["']@deepseek-ai\//u.test(code)) return raw.trim();
	}
	return null;
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);

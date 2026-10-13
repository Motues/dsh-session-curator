/**
 * 构建：`src/`（TypeScript，唯一真源）→ `lib/`（提交进仓库的产物，DSH 直接加载的就是它）。
 *
 * 两个半区各走一条路，因为运行环境不同：
 *   1. 宿主半区：`tsc` 直接输出**多文件 ESM**（`lib/index.js` + `lib/host/*.js`）——
 *      Electron 主进程就是 Node，相对 import 天然可用。
 *   2. 客户端半区：`esbuild` 先把 `src/client` 打成一份 CJS，再由本脚本包进 DSH 的手写束
 *      `window.__ModuleLoader__.load({id, factory})`。浏览器那边拿到的是 classic script
 *      （loader 走 `document.createElement("script")` + `el.src`），**不能**是 ESM，
 *      所以客户端多文件必须在构建期合回一份。
 *
 * `react` 与 `@deepseek-ai/*` 保持 external：它们由 DSH 的模块表在运行时注入，
 * 也就是束里 `factory(require)` 收到的那个 `require`。
 *
 * 用法：`npm run build`（或 `node scripts/build.mjs`）。
 */

/** 构建期依赖只在开发 / 发布时存在（发布包不发 devDependencies），先给一句人话再退出。 */
const MISSING = "build 需要 devDependencies（esbuild + typescript）：先在本仓库里跑 npm install。";

let esbuild;
try {
	esbuild = await import("esbuild");
} catch {
	console.error(MISSING);
	process.exit(1);
}

const { spawnSync } = await import("node:child_process");
const { readFile, rm, writeFile } = await import("node:fs/promises");
const { createRequire } = await import("node:module");
const { join } = await import("node:path");

const root = join(import.meta.dirname, "..");
const lib = join(root, "lib");
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

/** 客户端束里必须在线的外部模块：DSH 的模块表注入它们，别打进产物。 */
const CLIENT_EXTERNAL = ["react", "@deepseek-ai/*"];

// 只清自己产出的东西（`lib/` 是提交进仓库的产物，别顺手扫掉别的）。
await rm(join(lib, "host"), { recursive: true, force: true });
await rm(join(lib, "index.js"), { force: true });
await rm(join(lib, "client.js"), { force: true });

// ── 1) 宿主半区：tsc 输出多文件 ESM ──────────────────────────────────────
let tsc;
try {
	tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
} catch {
	console.error(MISSING);
	process.exit(1);
}
const emitted = spawnSync(process.execPath, [tsc, "-p", join(root, "tsconfig.build.json")], {
	stdio: "inherit",
	cwd: root
});
if (emitted.status !== 0) process.exit(emitted.status ?? 1);

// ── 2) 客户端半区：esbuild → CJS → DSH 手写束 ────────────────────────────
const client = await esbuild.build({
	entryPoints: [join(root, "src", "client", "index.ts")],
	bundle: true,
	format: "cjs",
	platform: "browser",
	target: ["es2020"],
	external: CLIENT_EXTERNAL,
	write: false,
	legalComments: "none",
	charset: "utf8",
	logLevel: "warning"
});
const body = client.outputFiles[0].text.trimEnd();

await writeFile(
	join(lib, "client.js"),
	[
		"// 本文件由 `node scripts/build.mjs` 从 src/client/**/*.ts 生成，不要手改。",
		"window.__ModuleLoader__.load({",
		`\tid: ${JSON.stringify(manifest.name)},`,
		"\t// 浏览器只认这种「工厂 + 局部 require」的束：factory 收到的 require 就是 DSH 的模块表，",
		"\t// esbuild 把 external 的 import 编译成了对这个参数的调用。",
		"\tfactory: (require) => {",
		"\t\tconst module = { exports: {} };",
		"\t\t(function (module, exports, require) {",
		body,
		"\t\t})(module, module.exports, require);",
		"\t\treturn module.exports;",
		"\t}",
		"});",
		""
	].join("\n"),
	"utf8"
);

console.log(`built: lib/index.js + lib/host/*.js (tsc) and lib/client.js (esbuild ${body.length} B)`);

/**
 * profile junction 冒烟 —— 证明"DSH 在 link 挂载下解析到的就是本仓库这份构建"。
 *
 * 为什么单独一个脚本：本机 desktop profile 里本插件是 `link:` + junction 挂载
 *（AGENTS.md §11），DSH 加载的既不是 npm 包、也不是 `node_modules` 里的副本，而是
 * **仓库里的 `lib/`**。这条链路上任何一环松掉（junction 被 pnpm 换掉、指向了旧目录、
 * 忘了 `pnpm run build`），`pnpm test` 都还是全绿 —— 它测的是仓库自己的 `lib/`，
 * 与"DSh 实际加载的那份"是否同一个文件无关。
 *
 * 做法：把 `scripts/activation.mjs` 指向 profile 解析出来的入口跑一遍（它自带真 cordis
 * 拓扑 + 10 条路由断言）。判定与 `activation.mjs` 的 asar SKIP 同理：
 *   找不到 profile / 该包不是 junction（例如换回了 npm 版）→ 打印 SKIP 并以 0 退出。
 *
 * 用法：`pnpm run check:profile`（或 `node scripts/check-profile.mjs [profileName]`，
 * 默认 desktop，也可用 `$env:DSH_PROFILE`；`$env:DSH_HOME` 决定 home，与插件一致）。
 */
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const PROFILE = process.argv[2] ?? process.env.DSH_PROFILE ?? "desktop";

function dshHome() {
	const configured = process.env.DSH_HOME;
	if (typeof configured === "string" && configured.trim() !== "") return resolve(configured.trim());
	return resolve(join(homedir(), ".dsh"));
}

const home = dshHome();
const profileDir = join(home, "profiles", PROFILE);
const link = join(profileDir, "node_modules", manifest.name);

console.log(`profile: ${profileDir}`);
console.log(`link:    ${link}`);

/** 与 activation.mjs 的 asar SKIP 同一种做法：环境不具备这条断言的前提就跳过。 */
function skip(reason) {
	console.log(`SKIP: ${reason}`);
	process.exit(0);
}

if (!existsSync(profileDir)) skip(`profile ${JSON.stringify(PROFILE)} 不存在（用参数或 $env:DSH_PROFILE 指定别的）`);
if (!existsSync(link)) skip(`profile 里没有 ${manifest.name}（未安装）`);

const stat = lstatSync(link);
if (!stat.isSymbolicLink()) {
	skip(`${manifest.name} 是实体目录而不是 junction / symlink（npm / pnpm 装出来的那份），本脚本只验 link 挂载`);
}

const mounted = realpathSync(link);
const entry = join(mounted, "lib", "index.js");
const mine = join(realpathSync(root), "lib", "index.js");

const checks = [];
function check(label, condition, detail) {
	checks.push({ label, ok: Boolean(condition) });
	console.log(`${condition ? "  ok  " : " FAIL "} ${label}${detail === undefined ? "" : `  — ${detail}`}`);
}

check("the junction resolves to a real directory", existsSync(mounted), mounted);
check(
	`the mounted package is ${manifest.name}`,
	(() => {
		try {
			return JSON.parse(readFileSync(join(mounted, "package.json"), "utf8")).name === manifest.name;
		} catch {
			return false;
		}
	})(),
	mounted
);
check(
	"the junction points at THIS checkout (not an old copy)",
	existsSync(entry) && existsSync(mine) && realpathSync(entry) === realpathSync(mine),
	`${entry} vs ${mine}`
);

const failed = checks.filter((entryCheck) => !entryCheck.ok);
if (failed.length > 0) {
	console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
	process.exit(1);
}

// 真跑一遍宿主半区激活（真 cordis + 真 Request），跑的就是 profile 解析到的那个文件。
console.log(`\nactivation against: ${entry}\n`);
const activated = spawnSync(process.execPath, [join(root, "scripts", "activation.mjs"), entry], {
	stdio: "inherit",
	cwd: root
});
console.log(`\n${checks.length}/${checks.length} link checks passed; activation exit=${String(activated.status)}`);
process.exit(activated.status ?? 1);

/**
 * 产物同步闸：断言"仓库里的 `lib/` 就是当前 `src/` 构建出来的那一份"。
 *
 * 这道闸以前是 CI 的第 4 步（`git diff --exit-code -- lib/`）。2026-10-14 仓库主人决定
 * 删掉 CI（"每次发布前自己本地检查就行了"），于是它挪到发布前：`prepublishOnly` 里先跑
 * 本脚本、再跑 `pnpm test` —— 上传 tarball 之前就会被挡住。
 *
 * 它挡的是**静默事故**：改了 `src/` 忘了 `pnpm run build`。那种情况下
 *   - `pnpm test` 照样全绿（它自己会先 build，脚本读的是刚构建出来的 `lib/`）；
 *   - `pnpm publish` 打出来的 tarball 也是对的（`prepublishOnly` 会重新构建）；
 *   - 只有**提交进仓库的 `lib/`** 是旧的 —— 于是"从 GitHub 装"（README 里那条
 *     `dsh plugin add github:Motues/dsh-session-curator`）和 tag 指向的那份产物都是旧的。
 *
 * 为什么可以"重新 build 一遍再比"：构建是确定性的（同输入同字节，见 AGENTS.md §3），
 * 所以 build 之后 `lib/` 还有差异 ⇔ 仓库里那份不是当前 `src/` 的产物。
 *
 * 为什么用 `git status --porcelain` 而不是 `git diff --exit-code`：后者看不见**新增且未跟踪**
 * 的产物文件（新加 `src/host/xxx.ts`、build 出 `lib/host/xxx.js` 却忘了 `git add`，
 * `git diff` 是空的）。
 *
 * 什么时候会报（都会报，都是对的）：
 *   1. 改了 `src/` 忘了重新 build / 忘了提交 `lib/` —— 本脚本存在的主要理由；
 *   2. 工作区里有**未提交**的 `src/` 改动 —— 那本来也不该发布（`release.mjs` 同样要求干净树）。
 *
 * 用法：`pnpm run check:lib`（或 `node scripts/lib-sync.mjs`；会先自己构建一遍，所以独立可跑）。
 */
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

/** 跑一条 git 子命令，拿 stdout；非零退出就把 stderr 一起抛出来。 */
function git(...args) {
	const run = spawnSync("git", args, { cwd: root, encoding: "utf8" });
	if (run.status !== 0) {
		console.error(`[FAIL] \`git ${args.join(" ")}\` 跑不起来 —— 本脚本要在 git 仓库里跑（\`lib/\` 是提交进仓库的产物）。`);
		if (run.stderr) console.error(String(run.stderr).trim());
		process.exit(1);
	}
	return String(run.stdout ?? "");
}

// 先构建：脚本因此可以独立跑（"我改了 src 但没 build"这种时刻正好也要能验）。
// 构建是确定性的，所以这一步之后 `lib/` 与仓库里那份的差异就是"产物过期"本身。
const built = spawnSync(process.execPath, [join(import.meta.dirname, "build.mjs")], { cwd: root, stdio: "inherit" });
if (built.status !== 0) {
	console.error("[FAIL] 构建失败 —— 先把 `pnpm run build` 修好，再谈产物是否同步。");
	process.exit(built.status ?? 1);
}

const dirty = git("status", "--porcelain", "--", "lib").trim();
if (dirty !== "") {
	console.error("[FAIL] `lib/` 与 `src/` 不同步 —— 下面就是刚刚重新构建出来的差异：\n");
	console.error(
		dirty
			.split("\n")
			.map((line) => `  ${line}`)
			.join("\n")
	);
	console.error("\n       把 `pnpm run build` 之后的 `lib/` 一起提交，再发布（`git add lib`）。");
	process.exit(1);
}

const files = git("ls-files", "lib")
	.split("\n")
	.filter((line) => line !== "").length;
console.log(`[ok] lib/ 与 src/ 同步（${files} 个产物文件都是当前 src/ 构建出来的）`);

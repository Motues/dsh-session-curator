#!/usr/bin/env node
/**
 * 发版收尾：打 tag → 推 tag → 在 GitHub 上建 Release。
 *
 * **为什么不做 `pnpm publish`**：发布需要真实终端 + npm web 2FA（无 TTY 的调用只会拿到
 * `EOTP`，见 AGENTS.md §10），所以本脚本的定位是"**发布之后**的收尾"。顺序反过来有代价，
 * 所以它开头就要 registry 上真的已经有这个版本，否则直接拒。
 *
 * 它顺手把 AGENTS.md §10 里那条手工步骤自动化了：**把 registry 上那份 tarball 下载下来，
 * 跟本地重新 `pnpm pack` 出来的逐个文件比对**（文件清单 + 每个文件的 sha256）。对不上就说明
 * "发布出去的东西"跟"仓库里这一份"不是同一个，这时打 tag 只会把错误固化下来；常见原因：
 * `files` 白名单改过、打包前忘了重新构建 / 提交 `lib/`、版本号没跟着改。
 *
 * 为什么比**内容**而不是比 tarball 的 sha1：实测 `pnpm pack` 与 `npm pack` 打出的字节
 * **不同**（0.1.2 是 npm 时代发的，只有 `npm pack` 能复现它的 `dist.shasum`；同一棵树里
 * `pnpm pack` 自己倒是完全稳定，gzip mtime 也没漏进去）。字节一致只说明"打包器也一样"，
 * 不是我们真正关心的东西 —— 所以只在**顺带能对上**时报一句，不当闸。要看内容差异：
 * 下面会逐个列出"只在远端 / 只在本地 / 内容不同"的文件。
 *
 * 幂等：tag 已经存在时不重复创建（但仍会推一次，`Everything up-to-date` 是正常的），
 * Release 已经存在时直接结束 —— 所以"当时没配 token，事后补一个 Release"只要再跑一次。
 *
 * 用法（在仓库根目录）：
 *   node scripts/release.mjs --dry-run        # 只检查 + 打印将要做什么（不打 tag / 不推送 / 不建 Release）
 *   node scripts/release.mjs                  # 真打 tag + 推送 + 建 Release
 *   node scripts/release.mjs --wait 300       # npm 刚 publish 完，等 registry 认这个版本（秒）
 *   node scripts/release.mjs --skip-verify    # 跳过 tarball 比对（只在你确定为什么对不上时用）
 *   node scripts/release.mjs --branch main    # 默认就要求 main
 *
 * 环境变量：
 *   GITHUB_TOKEN / GH_TOKEN   建 Release 用的 token（有 `repo` 权限即可）。没设也照样打 tag + 推送，
 *                             只是最后一步会跳过并提示你怎么补。
 *   CURATOR_GIT_PROXY         git 要走的代理，例如 `http://127.0.0.1:7897`（本机直连 github.com 会被
 *                             reset，git 不读 WinINET 系统代理，所以必须显式喂给它）。只作用于 git；
 *                             registry / api.github.com 走 Node 的 fetch（本机实测可直连）。
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const ROOT = resolve(import.meta.dirname, "..");
const REGISTRY = "https://registry.npmjs.org";
const GITHUB_API = "https://api.github.com";
/** npm 收到 publish 之后先回 PUT 202，版本要过一会儿才在 registry 上出现，所以是轮询。 */
const POLL_MS = 15_000;
const USER_AGENT = "dsh-session-curator-release";
/** 报告差异时最多列几个文件（免得一屏全是 diff）。 */
const REPORT_LIMIT = 12;

// ── 参数 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
const valueOf = (name, fallback) => {
	const at = argv.indexOf(name);
	return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback;
};
if (has("--help") || has("-h")) {
	console.log("用法：node scripts/release.mjs [--dry-run] [--wait <秒>] [--skip-verify] [--branch <名>]");
	process.exit(0);
}
const dryRun = has("--dry-run");
const skipVerify = has("--skip-verify");
const branch = valueOf("--branch", "main");
const waitSeconds = Number(valueOf("--wait", "0"));
if (!Number.isFinite(waitSeconds) || waitSeconds < 0) throw new Error("--wait 要一个 ≥ 0 的秒数");
const proxy = (process.env.CURATOR_GIT_PROXY ?? "").trim();

// ── 小工具 ──────────────────────────────────────────────────────────────
const quote = (value) => (/[\s"]/u.test(value) ? `"${value.replace(/"/gu, '\\"')}"` : value);

/**
 * 跑一条命令。Windows 下必须 `shell: true`：本机的 `pnpm` 只有 `.cmd` / `.ps1` 垫片，
 * `execFileSync("pnpm.cmd", …)` 会直接 `EINVAL`（Node 对 .cmd/.bat 的已知限制）。
 * 传的是**拼好的单条字符串**，所以不会踩"shell + args 数组"那个坑。
 */
function run(command, options = {}) {
	return execSync(command, {
		cwd: ROOT,
		encoding: "utf8",
		stdio: options.stream === true ? "inherit" : ["ignore", "pipe", "pipe"]
	});
}

function git(...args) {
	return run(["git", ...gitConfig(), ...args].map(quote).join(" ")).trim();
}
/** 需要看到进度的 git（推送）：直接继承 stdio。 */
function gitStream(...args) {
	return run(["git", ...gitConfig(), ...args].map(quote).join(" "), { stream: true });
}
/** git 的代理设置：`-c` 必须出现在子命令**之前**。 */
function gitConfig() {
	return proxy === "" ? [] : ["-c", `http.proxy=${proxy}`, "-c", `https.proxy=${proxy}`];
}

const step = (text) => console.log(`\n[..] ${text}`);
const ok = (text) => console.log(`[ok] ${text}`);
const warn = (text) => console.log(`[!!] ${text}`);

/** `die()` 抛的就是它；顶层接住之后只设 exitCode。 */
class ReleaseFailure extends Error {}

/**
 * 中止。**故意不调 `process.exit()`**：Windows 上它撞上还在收尾的句柄（`execSync` 的子进程
 * 或 fetch 的连接）会直接崩在 libuv 里 ——
 *   `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94`
 * 退出码变成 0xC0000409，把一句人话的拒绝变成一条看不懂的原生断言（实测偶发：同一段代码
 * 跑两次，一次干净退出、一次崩）。抛出去让 Node 自己退，退出码同样是 1。
 */
function die(text) {
	console.error(`\n[FAIL] ${text}`);
	throw new ReleaseFailure(text);
}

/** `git+https://github.com/Owner/Repo.git` → `Owner/Repo`。 */
function repoSlug(url) {
	const match = /github\.com[/:]([^/]+)\/([^/.]+)/u.exec(String(url ?? ""));
	return match === null ? null : `${match[1]}/${match[2]}`;
}

async function getJson(url, init) {
	const response = await fetch(url, {
		...init,
		headers: { accept: "application/json", "user-agent": USER_AGENT, ...(init?.headers ?? {}) }
	});
	if (response.status === 404) return null;
	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(`HTTP ${response.status} ${url}${detail === "" ? "" : ` — ${detail.slice(0, 200)}`}`);
	}
	return response.json();
}

/** 等 registry 上出现这个版本；超时回 null。 */
async function waitForVersion(name, version) {
	const deadline = Date.now() + waitSeconds * 1000;
	for (;;) {
		const manifest = await getJson(`${REGISTRY}/${name}/${version}`);
		if (manifest !== null) return manifest;
		if (Date.now() >= deadline) return null;
		console.log(`     还没看到 ${name}@${version}，${POLL_MS / 1000}s 后再问一次…`);
		await new Promise((done) => setTimeout(done, POLL_MS));
	}
}

/**
 * 极简 tar 读取器：只认普通文件。
 *
 * 为什么不 shell 出去调 `tar`：那样就把"这台机器有没有 tar.exe"变成发版的前置条件了
 *（Windows 10 以前没有）。格式本身很简单：512 字节头 + 按 512 对齐的数据块，
 * 名字在 0..100、八进制体积在 124..136、类型在 156，全零块表示结束。
 * 本仓库的 `scripts/activation.mjs` 也是同一套思路（手写了个 asar 读取器）。
 */
function tarEntries(buffer) {
	const entries = new Map();
	let offset = 0;
	while (offset + 512 <= buffer.length) {
		const header = buffer.subarray(offset, offset + 512);
		const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/su, "").trim();
		if (name === "") break;
		const size = Number.parseInt(header.subarray(124, 136).toString("utf8").replace(/\0.*$/su, "").trim() || "0", 8);
		const type = String.fromCharCode(header[156]);
		const start = offset + 512;
		if (type === "0" || type === "\0") entries.set(name, buffer.subarray(start, start + size));
		offset = start + Math.ceil(size / 512) * 512;
	}
	return entries;
}

/** tarball（.tgz）→ `Map<路径, sha256>`。 */
function digestsOf(tarball) {
	const digests = new Map();
	for (const [name, bytes] of tarEntries(gunzipSync(tarball))) {
		digests.set(name, createHash("sha256").update(bytes).digest("hex"));
	}
	return digests;
}

/** 本地重新打一份包（临时目录），返回 `{ tarball, sha1, digests }`。 */
function packLocal() {
	const dir = mkdtempSync(join(tmpdir(), "dsh-session-curator-release-"));
	try {
		run(`pnpm pack --pack-destination ${quote(dir)}`);
		const tarballs = readdirSync(dir).filter((name) => name.endsWith(".tgz"));
		if (tarballs.length !== 1) throw new Error(`期望恰好一个 .tgz，实际 ${tarballs.length} 个`);
		const tarball = readFileSync(join(dir, tarballs[0]));
		return {
			tarball,
			sha1: createHash("sha1").update(tarball).digest("hex"),
			digests: digestsOf(tarball)
		};
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** 列出两份打包内容的差异（空数组 = 一致）。 */
function diffDigests(local, remote) {
	const lines = [];
	const onlyRemote = [...remote.keys()].filter((name) => !local.has(name)).sort();
	const onlyLocal = [...local.keys()].filter((name) => !remote.has(name)).sort();
	const changed = [...local.keys()].filter((name) => remote.has(name) && remote.get(name) !== local.get(name)).sort();
	for (const [label, names] of [
		["只在 registry 那份里", onlyRemote],
		["只在本地这份里", onlyLocal],
		["内容不同", changed]
	]) {
		if (names.length === 0) continue;
		lines.push(`    ${label}（${names.length}）：${names.slice(0, REPORT_LIMIT).join(", ")}${names.length > REPORT_LIMIT ? " …" : ""}`);
	}
	return lines;
}

/** 取 CHANGELOG 里 `## [<版本>]` 那一小节（到下一个 `## ` 标题为止）。 */
function changelogSection(version) {
	let text;
	try {
		text = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
	} catch {
		return null;
	}
	const lines = text.split(/\r?\n/u);
	const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
	if (start < 0) return null;
	const rest = lines.slice(start + 1);
	// 小节到下一个 `## ` 标题、或文件末尾那串链接引用（`[Unreleased]: …`）为止。
	const end = rest.findIndex((line) => line.startsWith("## ") || /^\[[^\]]+\]:/u.test(line));
	const body = (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
	return body === "" ? null : body;
}

/** 没有 CHANGELOG 小节时的兜底：上一个 tag 到 HEAD 的提交标题。 */
function commitsSinceLastTag() {
	let range = "HEAD";
	try {
		// 用 `HEAD^` 而不是 `HEAD`：重跑时 HEAD 自己可能已经带着这个 tag，那样会取到它自己。
		const previous = git("describe", "--tags", "--abbrev=0", "HEAD^");
		range = `${previous}..HEAD`;
	} catch {
		// 一个 tag 都没有 / HEAD 是第一个提交：整段历史都是这次要发的。
	}
	const log = git("log", "--no-merges", "--format=- %s", range);
	return log === "" ? `见 ${tag}` : log;
}

/**
 * 包本身的四个事实：所有 helper 都要用（`commitsSinceLastTag` 用 `tag`、`changelogSection`
 * 用 `version`），所以放在模块级；`readFileSync` 是同步的，不会留下句柄。
 */
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const version = String(pkg.version);
const tag = `v${version}`;
const slug = repoSlug(pkg.repository?.url);

// ── 主流程 ──────────────────────────────────────────────────────────────
async function main() {
	// ── 1. 前置检查 ─────────────────────────────────────────────────────────
	console.log(`仓库：${ROOT}\n包：${pkg.name}@${version}（tag ${tag}）${dryRun ? "  —— DRY RUN" : ""}`);

	step("工作区必须是干净的");
	const dirty = git("status", "--porcelain");
	if (dirty !== "") die(`有未提交的改动，先把它们提交（tag 指向的是提交，不是工作区）：\n${dirty}`);
	ok("工作区干净");

	step(`当前分支必须是 ${branch}`);
	const current = git("rev-parse", "--abbrev-ref", "HEAD");
	if (current !== branch) die(`当前在 ${current}，不是 ${branch}；先切过去，或者用 --branch ${current} 明确指定。`);
	ok(`在 ${branch} 上`);

	step(`HEAD 必须已经在 origin/${branch} 上`);
	// 上面 `git status` 已经证明我们确实在一个 git 仓库里，所以这里失败只会是
	// "没有 origin/<branch> 这个引用"（没配 remote / 没 fetch 过）—— 跳过就好。
	const remoteHead = (() => {
		try {
			return git("rev-parse", `origin/${branch}`);
		} catch {
			return null;
		}
	})();
	const head = git("rev-parse", "HEAD");
	if (remoteHead === null) warn(`本地没有 origin/${branch} 这个引用，跳过这一步（remote 没配或没 fetch 过）`);
	else if (remoteHead !== head)
		die(
			`HEAD（${head.slice(0, 8)}）与 origin/${branch}（${remoteHead.slice(0, 8)}）不一致：先 push 分支再发版，否则 tag 会指向一个远端没有的提交。`
		);
	else ok("与远端一致");

	step("tag 是否已经存在（存在就只补推 / 补 Release）");
	const tagExists = git("tag", "--list", tag) !== "";
	if (tagExists) warn(`${tag} 已存在 —— 不重复创建（这一步是幂等的，供"当时没配 token，事后补 Release"用）`);
	else ok(`${tag} 还没打过`);

	// ── 2. registry：版本已发布，且打包内容与本地一致 ───────────────────────
	step(`registry 上要有 ${pkg.name}@${version}`);
	let manifest;
	try {
		manifest = await waitForVersion(String(pkg.name), version);
	} catch (error) {
		warn(`查 registry 失败：${String(error?.message ?? error)}`);
		die("确认网络（或代理）之后重跑；本机实测 registry.npmjs.org 可直连。");
	}
	if (manifest === null) {
		die(
			`registry 上还没有 ${pkg.name}@${version}。先发布：在**真实控制台**里 pnpm publish（要人工过 2FA），过几分钟再回来；或者用 --wait 300 让它自己等。`
		);
	}
	ok(`registry 上已有这个版本（dist.shasum ${manifest.dist?.shasum ?? "?"}）`);

	if (skipVerify) {
		warn("按 --skip-verify 跳过了打包内容比对");
	} else {
		step("本地重新打包，逐文件与 registry 上那份比对");
		let local;
		try {
			local = packLocal();
		} catch (error) {
			die(`打包失败：${String(error?.message ?? error)}`);
		}
		let remote;
		try {
			const response = await fetch(String(manifest.dist?.tarball ?? ""), { headers: { "user-agent": USER_AGENT } });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			remote = digestsOf(Buffer.from(await response.arrayBuffer()));
		} catch (error) {
			die(`下载 registry 上那份 tarball 失败：${String(error?.message ?? error)}\n    （只想跳过这一步：--skip-verify）`);
		}
		const differences = diffDigests(local.digests, remote);
		if (differences.length > 0) {
			die(
				`发布出去的那份和仓库里这一份**内容不一致**（共 ${local.digests.size} 个文件）：\n${differences.join("\n")}\n` +
					"    常见原因：`files` 白名单改过、打包前忘了重新构建 / 提交 `lib/`、或版本号没跟着改。\n" +
					"    确认是有意为之（例如刚改了 files 但还没发新版）时才用 --skip-verify。"
			);
		}
		ok(`打包内容一致（${local.digests.size} 个文件）`);
		if (local.sha1 === manifest.dist?.shasum) ok(`字节级也一致（${local.sha1}）`);
		else
			warn(
				`字节级不同（本地 ${local.sha1} / 远端 ${manifest.dist?.shasum ?? "?"}）—— 打包器不同而已（0.1.2 是 npm 时代发的），内容一致就不算问题`
			);
	}

	// ── 3. Release 正文 ─────────────────────────────────────────────────────
	step("取 Release 正文（CHANGELOG 的对应小节）");
	let body = changelogSection(version);
	if (body === null) {
		warn(`CHANGELOG.md 里没有 \`## [${version}]\` 小节，退化成"上个 tag 以来的提交标题"`);
		body = commitsSinceLastTag();
	}
	ok(`正文 ${body.split("\n").length} 行`);

	// ── 4. 打 tag + 推 tag ──────────────────────────────────────────────────
	if (dryRun) {
		console.log(`\n[..] DRY RUN：以下步骤都只打印不执行\n  git tag -a ${tag} -m ${tag}\n  git push origin ${tag}`);
	} else {
		if (tagExists) warn(`跳过创建 ${tag}`);
		else {
			step(`创建注释 tag ${tag}`);
			git("tag", "-a", tag, "-m", tag);
			ok(`已创建 ${tag}`);
		}
		step(`推送 tag 到 origin${proxy === "" ? "" : "（走 CURATOR_GIT_PROXY）"}`);
		gitStream("push", "origin", tag);
		ok("tag 已推送");
	}

	// ── 5. 建 Release ───────────────────────────────────────────────────────
	const token = (process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "").trim();
	if (slug === null) {
		warn("package.json 里没解析出 GitHub 仓库地址，跳过 Release 这**整**步");
	} else if (dryRun) {
		console.log(`\n[..] DRY RUN：建 Release 需要 POST ${GITHUB_API}/repos/${slug}/releases`);
		console.log(`      tag_name=${tag} name=${tag} prerelease=${version.includes("-")} body=${body.split("\n")[0] ?? ""}…`);
	} else if (token === "") {
		warn("没有 GITHUB_TOKEN / GH_TOKEN —— tag 已经推好了，Release 没建。");
		console.log("     补的办法：设好 token 之后再跑一次本脚本（tag 已存在不会重复创建），或直接开网页：");
		console.log(`     https://github.com/${slug}/releases/new?tag=${tag}`);
	} else {
		step("建 GitHub Release");
		const existing = await getJson(`${GITHUB_API}/repos/${slug}/releases/tags/${tag}`);
		if (existing !== null) {
			ok(`Release 已经在了：${existing.html_url}`);
		} else {
			try {
				const created = await getJson(`${GITHUB_API}/repos/${slug}/releases`, {
					method: "POST",
					headers: {
						authorization: `Bearer ${token}`,
						"content-type": "application/json",
						"x-github-api-version": "2022-11-28"
					},
					body: JSON.stringify({ tag_name: tag, name: tag, body, draft: false, prerelease: version.includes("-") })
				});
				ok(`已创建：${created.html_url}`);
			} catch (error) {
				die(
					`建 Release 失败：${String(error?.message ?? error)}\n` +
						"    如果这台机器访问 api.github.com 需要代理，给 Node 打开环境代理再重跑：\n" +
						'      $env:NODE_USE_ENV_PROXY = "1"; $env:HTTPS_PROXY = "http://127.0.0.1:7897"\n' +
						"    （若只是网络问题，tag 已经推好了，网页上补一个 Release 也行。）"
				);
			}
		}
	}

	console.log(dryRun ? "\n[ok] 预检通过（什么都没改）" : "\n[ok] 发版收尾完成");
}

try {
	await main();
} catch (error) {
	// `die()` 的哨兵：原因已经打印过了，这里只负责把退出码交出去。
	// 别的异常照旧抛（Node 打栈 + 退出码 1），别把它吞成"成功"。
	if (!(error instanceof ReleaseFailure)) throw error;
	process.exitCode = 1;
}

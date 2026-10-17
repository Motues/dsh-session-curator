/**
 * 宿主半区**激活**自检 —— 对着真实 DSH 运行时的 cordis 跑一遍（不需要 DSH 在跑）。
 *
 * 为什么除了 `smoke.mjs` 还要这个：`smoke.mjs` 用的是**假 ctx**（服务直接挂在根上），
 * 它测得出"登记了什么路由"，但复现不了这次的 405 事故 —— 那个事故要求服务**各自挂在
 * 自己的兄弟 fiber 上**（Loader 挂 profile 条目就是这样），此时 cordis 的服务调用带
 * shadow（`Context[symbols.shadow]` 指向提供者作用域），于是
 * `ctx.connection.rpc.handle()` 会拿 **Connection 自己的 ctx** 去
 * `owner.webServer.register(...)`，抛
 *
 *     cannot get property "webServer" without inject
 *     （@deepseek-ai/dsh-client-connection/lib/index.js:656）
 *
 * 插件 fiber 直接 `failed`、一条路由都没挂上，客户端每个 POST 落到 SPA 静态兜底，
 * 被回 **HTTP 405** —— 就是 `transport failure for /session-manager/trash: HTTP 405`。
 *
 * 本脚本从 `app.asar` 里抽出真实的 `@deepseek-ai/cordis` + `@deepseek-ai/cosmokit`
 * （外加 app-boot 判版本用的真 `semver`），用**逐字照抄**的 Connection
 * （`rpc` / `fetch` / `createSharedFetchHandler` / `endpointFromPath` / `assertChannel` /
 * `assertFetchRoute`）搭出同样的兄弟拓扑，然后：
 *   1. 载入本插件的宿主半区，断言 fiber 变 **ACTIVE**（FAILED 直接判失败）；
 *   2. 断言 10 条 `/api/session-curator/*` 精确路由都登记上了；
 *   3. 用真 `Request` 走一遍共享处理器（等价于宿主 `/api` 栅栏之后的路径），要 200 + 合法信封；
 *   4. 登记一条"永远不该被碰到"的 webServer —— 谁把实现改回 `rpc.handle()` 就会撞上它；
 *   5. dispose 插件，断言 10 条路由全部释放；
 *   6. 断言 `engines.dsh` **认得这个正在跑的版本**（见下面的"兼容闸"：0.3.0 就是栽在这上面）。
 *
 * 用法：`node scripts/activation.mjs`
 *   找不到 `app.asar` 时打印 SKIP 并以 0 退出；可用 `$env:DSH_APP_ASAR` 指定路径。
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ── 找 app.asar ──────────────────────────────────────────────────────────
function findArchive() {
	const configured = process.env.DSH_APP_ASAR;
	if (typeof configured === "string" && configured.trim() !== "") {
		const path = resolve(configured.trim());
		if (!existsSync(path)) throw new Error(`$DSH_APP_ASAR 指向的文件不存在：${path}`);
		return path;
	}
	const candidates = [
		"C:/Soft/DeepSeek Harness/resources/app.asar",
		join(process.env.LOCALAPPDATA ?? "", "Programs/DeepSeek Harness/resources/app.asar"),
		join(process.env.PROGRAMFILES ?? "", "DeepSeek Harness/resources/app.asar")
	];
	return candidates.find((path) => existsSync(path));
}

/** 最小 asar 读取器：Chromium pickle 头 + JSON 目录 + 顺序拼接的文件体。 */
async function readArchive(path) {
	const buffer = await readFile(path);
	const headerSize = buffer.readUInt32LE(4);
	const jsonLength = buffer.readUInt32LE(12);
	const header = JSON.parse(buffer.subarray(16, 16 + jsonLength).toString("utf8"));
	const dataStart = 8 + headerSize;
	const files = [];
	(function walk(node, prefix) {
		for (const [name, entry] of Object.entries(node.files ?? {})) {
			const target = prefix === "" ? name : `${prefix}/${name}`;
			if (entry.files) walk(entry, target);
			else files.push({ path: target, offset: Number(entry.offset), size: entry.size });
		}
	})(header, "");
	return {
		files,
		read(file) {
			return buffer.subarray(dataStart + file.offset, dataStart + file.offset + file.size);
		}
	};
}

/** 把运行时的 cordis + cosmokit（外加 app-boot 判 `engines.dsh` 用的 semver）抽到一个临时 node_modules 里（每次覆盖，避免陈旧）。 */
async function extractRuntime(archive) {
	const root = join(tmpdir(), "dsh-session-curator-activation");
	const modules = join(root, "node_modules");
	await rm(modules, { recursive: true, force: true });
	/** 落一个文件（自动建目录）。 */
	const copy = async (relative, bytes) => {
		const target = join(modules, relative);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, bytes);
	};
	let extracted = 0;
	let semverFiles = 0;
	for (const file of archive.files) {
		const match = /^dsh\/node_modules\/(@deepseek-ai\/(?:cordis|cosmokit))(\/.*)?$/.exec(file.path);
		if (match !== null) {
			const [, packageName, rest = ""] = match;
			if (rest !== "" && rest !== "/package.json" && !rest.startsWith("/lib/")) continue;
			await copy(join(packageName, rest.replace(/^\//, "")), archive.read(file));
			extracted += 1;
			continue;
		}
		// semver 也抽一份真的：`engines.dsh` 这道闸就是 app-boot 用它判的，
		// 自己写个半吊子版本比较只会把"闸坏了"伪装成"通过"。
		if (file.path.startsWith("dsh/node_modules/semver/")) {
			await copy(file.path.slice("dsh/node_modules/".length), archive.read(file));
			semverFiles += 1;
		}
	}
	if (extracted === 0) throw new Error("app.asar 里没有找到 @deepseek-ai/cordis —— 布局变了？");
	if (semverFiles === 0) throw new Error("app.asar 里没有找到 semver —— 布局变了？");
	return {
		cordisEntry: join(modules, "@deepseek-ai/cordis/lib/index.js"),
		semver: createRequire(import.meta.url)(join(modules, "semver"))
	};
}

/**
 * 正在跑的 DSH 版本。
 *
 * 注意读的是 **`dsh-app-boot` 自己的 package.json**：`getDshRuntimeVersion()` 就是这么做的
 *（`new URL("../package.json", import.meta.url)`），所以这个数才是 `engines.dsh` 被比对的那一边。
 */
function runtimeVersionOf(archive) {
	const file = archive.files.find((entry) => entry.path === "dsh/node_modules/@deepseek-ai/dsh-app-boot/package.json");
	if (file === undefined) throw new Error("app.asar 里没有 dsh-app-boot 的 package.json —— 布局变了？");
	const manifest = JSON.parse(archive.read(file).toString("utf8"));
	if (typeof manifest.version !== "string" || manifest.version.trim() === "")
		throw new Error("dsh-app-boot 的 package.json 没有 version —— 布局变了？");
	return manifest.version;
}

// ── 逐字照抄 @deepseek-ai/dsh-client-connection 的判定与注册代码 ─────────
const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/;
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/;

function endpointFromPath(channel, pathname) {
	if (!pathname.startsWith(`${channel}/`)) return undefined;
	const endpoint = pathname.slice(channel.length + 1);
	if (
		endpoint
			.split("/")
			.some((segment) => segment === "" || segment === "." || segment === ".." || !ENDPOINT_SEGMENT_PATTERN.test(segment))
	)
		return undefined;
	return endpoint;
}

function assertChannel(channel) {
	if (!CHANNEL_PATTERN.test(channel) || channel === "/api")
		throw new Error(`connection: invalid or reserved RPC channel ${JSON.stringify(channel)}`);
}

function assertFetchRoute(route) {
	if (endpointFromPath("/api", route.path) === undefined)
		throw new Error(`connection: invalid exact Fetch route ${JSON.stringify(route.path)}`);
	if (route.methods.length === 0) throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} declares no methods`);
	if (new Set(route.methods).size !== route.methods.length)
		throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} repeats a method`);
}

const ENDPOINTS = ["snapshot", "describe", "archive", "unarchive", "pin", "unpin", "delete", "usage", "open", "check-update"];
const CHANNEL = "/api";
const PREFIX = "session-curator";
const ROUTE_PREFIX = `${CHANNEL}/${PREFIX}`;

const checks = [];
function check(label, condition, detail) {
	checks.push({ label, ok: Boolean(condition) });
	console.log(`${condition ? "  ok  " : " FAIL "} ${label}${detail === undefined ? "" : `  — ${detail}`}`);
}

// ── 跑 ───────────────────────────────────────────────────────────────────
const archivePath = findArchive();
if (archivePath === undefined) {
	console.log("SKIP: 找不到 app.asar（用 $env:DSH_APP_ASAR 指定 DSH 的 resources/app.asar 后重跑）");
	process.exit(0);
}

const archive = await readArchive(archivePath);
const runtimeVersion = runtimeVersionOf(archive);
console.log(`runtime: ${archivePath} (dsh ${runtimeVersion})`);
const { cordisEntry, semver } = await extractRuntime(archive);
const { Context, Service } = await import(pathToFileURL(cordisEntry).href);

/** 故意抛错：这个插件不该再碰 webServer（老实现才会）。 */
class WebServer extends Service {
	constructor(ctx) {
		super(ctx, "webServer");
	}
	register(route) {
		throw new Error(`webserver.register 不该被本插件调用：${route.path}`);
	}
}

/** verbatim: dsh-client-connection/lib/index.js `HostConnectionService`。 */
class Connection extends Service {
	fetchRoutes = new Map();
	constructor(ctx) {
		super(ctx, "connection");
	}
	get rpc() {
		const owner = this.ctx;
		return {
			handle: (channel, handler) => this.register(owner, channel, handler),
			intercept: (channel, matches, handler) => this.registerInterceptor(owner, channel, matches, handler)
		};
	}
	get fetch() {
		const owner = this.ctx;
		return { register: (route) => this.registerFetchRoute(owner, route) };
	}
	register(owner, channel) {
		assertChannel(channel);
		const route = { kind: "prefix", path: channel, handler: async () => {} };
		return owner.effect(() => owner.webServer.register(route), `client-connection: ${channel} rpc channel`);
	}
	registerInterceptor() {
		throw new Error("intercept 未实现（本插件不用）");
	}
	registerFetchRoute(owner, route) {
		assertFetchRoute(route);
		const registered = { methods: new Set(route.methods), requestBody: route.requestBody, fetch: route.fetch };
		return owner.effect(() => {
			if (this.fetchRoutes.has(route.path))
				throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} is already registered`);
			this.fetchRoutes.set(route.path, registered);
			return () => {
				this.fetchRoutes.delete(route.path);
			};
		}, `client-connection: ${route.path} Fetch route`);
	}
	createSharedFetchHandler(channel) {
		return {
			requestBodyMode: ({ method, url }) => {
				const route = this.fetchRoutes.get(url.pathname);
				return route?.methods.has(method) === true ? route.requestBody : "buffered";
			},
			fetch: (request) => {
				const pathname = new URL(request.url).pathname;
				const route = this.fetchRoutes.get(pathname);
				if (route?.methods.has(request.method) === true) return route.fetch(request);
				return Promise.resolve(new Response("not found", { status: 404 }));
			}
		};
	}
}

class WorkspaceRegistry extends Service {
	constructor(ctx) {
		super(ctx, "workspaceRegistry");
	}
	list() {
		return [];
	}
	get archivedSessionIds() {
		return [];
	}
	get pinnedSessionIds() {
		return [];
	}
}

// 兄弟拓扑：Loader 挂 profile 条目就是每个服务一条自己的 fiber。
const root = new Context();
let connection;
root.plugin({ name: "webserver", apply: (ctx) => void new WebServer(ctx) });
root.plugin({
	name: "connection",
	apply: (ctx) => {
		connection = new Connection(ctx);
	}
});
root.plugin({ name: "workspace-registry", apply: (ctx) => void new WorkspaceRegistry(ctx) });

const plugin = await import(
	pathToFileURL(process.argv[2] === undefined ? join(import.meta.dirname, "../lib/index.js") : resolve(process.argv[2])).href
);
const fiber = root.plugin(plugin);
let failure;
try {
	await fiber.await();
} catch (error) {
	failure = error;
}

check(
	"host half activates (fiber ACTIVE)",
	fiber.state === 2,
	failure === undefined ? `state=${fiber.state}` : `state=${fiber.state}: ${failure.message}`
);
check(
	"registers one exact /api route per endpoint",
	ENDPOINTS.every((endpoint) => connection.fetchRoutes.has(`${ROUTE_PREFIX}/${endpoint}`)),
	[...connection.fetchRoutes.keys()].join(", ")
);

const shared = connection.createSharedFetchHandler("/api");
const rpcId = "activation-probe";
const response = await shared.fetch(
	new Request(`http://127.0.0.1:19387${ROUTE_PREFIX}/snapshot`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ type: "client-request", rpcId, method: `${PREFIX}/snapshot`, payload: {} })
	})
);
const text = await response.text();
let envelope;
try {
	envelope = JSON.parse(text);
} catch {
	// 路由没挂上时这里拿到的是 Connection 的纯文本 404，别让它盖掉上面的 FAIL 列表。
	envelope = { type: "unparsable", result: { ok: false, error: { message: text.slice(0, 80) } } };
}
check(
	"POST /api/session-curator/snapshot answers 200 + Connection envelope",
	response.status === 200 && envelope.type === "server-response" && envelope.rpcId === rpcId,
	`status=${response.status} type=${envelope.type} ok=${envelope.result?.ok}${envelope.result?.ok === false ? ` error=${JSON.stringify(envelope.result.error)}` : ""}`
);
check(
	"snapshot value carries the documented shape",
	envelope.result?.ok === true &&
		["dshHome", "sessionsDir", "archived", "pinned", "totals"].every((key) => key in (envelope.result.value ?? {}))
);

// `describe` 也走一遍真 Request：它读的是**真实** DSH_HOME，所以这里只问一个
// 一定不存在的 id —— 期望 200 + `{ok:false}` 的错误信封，而不是 404 或抛异常。
const describeRpcId = "activation-describe";
const describeResponse = await shared.fetch(
	new Request(`http://127.0.0.1:19387${ROUTE_PREFIX}/describe`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			type: "client-request",
			rpcId: describeRpcId,
			method: `${PREFIX}/describe`,
			payload: { ids: ["session-curator-activation-missing"] }
		})
	})
);
const describeEnvelope = await describeResponse.json();
check(
	"POST /api/session-curator/describe answers 200 + a business error envelope for an unknown id",
	describeResponse.status === 200 &&
		describeEnvelope.type === "server-response" &&
		describeEnvelope.rpcId === describeRpcId &&
		describeEnvelope.result?.ok === false &&
		describeEnvelope.result.error?.code === "session-curator/error",
	`status=${describeResponse.status} result=${JSON.stringify(describeEnvelope.result)}`
);

const unregistered = await shared.fetch(new Request("http://127.0.0.1:19387/api/not-ours", { method: "POST" }));
check("an unregistered /api path is left to Connection (404)", unregistered.status === 404, `status=${unregistered.status}`);

await fiber.dispose();
await fiber.await().catch(() => {});
check("disposing the host half releases every route", connection.fetchRoutes.size === 0, `${connection.fetchRoutes.size} left`);

// ── manifest 元数据：插件管理页卡片上的图标与标题/描述 ───────────────────
// 逐条复刻 @deepseek-ai/dsh-app-boot 的 `lib/types/package-meta.js`（readPluginMeta /
// iconOf）：locale 文件**必须能被 Node 解析器按 exports 找到**，图标是 manifest 相对路径、
// 只能是 SVG/PNG/JPEG/WebP、realpath 之后仍在 manifest 目录内、且 ≤ 256 KiB。
const ICON_MEDIA_TYPES = new Map([
	[".svg", "image/svg+xml"],
	[".png", "image/png"],
	[".jpg", "image/jpeg"],
	[".jpeg", "image/jpeg"],
	[".webp", "image/webp"]
]);
const MAX_ICON_BYTES = 256 * 1024;

/** 极简标签配对：够验证我们自己的手写 SVG（跳过注释、自闭合、XML 声明）。 */
function tagsBalanced(source) {
	const text = source.replace(/<!--[\s\S]*?-->/gu, "");
	const stack = [];
	const pattern = /<\s*(\/?)\s*([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)\s*>/gu;
	let match;
	while ((match = pattern.exec(text)) !== null) {
		const [, closing, name] = match;
		// 自闭合看原始匹配的结尾，别信那个可选捕获组：属性组会把 `/` 一起吃掉。
		if (/\/\s*>$/u.test(match[0]) || name.startsWith("?")) continue;
		if (closing === "/") {
			if (stack.pop() !== name) return false;
		} else {
			stack.push(name);
		}
	}
	return stack.length === 0;
}
check(
	"the SVG tag checker itself detects imbalance",
	tagsBalanced("<svg><path/></svg>") === true &&
		tagsBalanced("<svg><path></svg>") === false &&
		tagsBalanced("<svg><path>x</svg>") === false
);

const pluginDir = resolve(import.meta.dirname, "..");
// 用 self-reference 解析：不需要插件已经装进 profile，走的是同一张 exports 表。
const pluginRequire = createRequire(join(pluginDir, "package.json"));
// 包名从自己的 manifest 读：将来改名（发布到 npm 前一定要改）自检不会跟着烂。
const PACKAGE_NAME = JSON.parse(readFileSync(join(pluginDir, "package.json"), "utf8")).name;
let manifest;
let manifestPath;
try {
	manifestPath = pluginRequire.resolve(`${PACKAGE_NAME}/package.json`);
	manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
	manifestPath = undefined;
	check("package.json is reachable through its own exports map", false, String(error?.code ?? error));
}
if (manifestPath !== undefined) {
	check("package.json is reachable through its own exports map", true);

	/**
	 * 兼容闸：`engines.dsh` 认得**正在跑的**这个 DSH 吗。
	 *
	 * 这是 0.3.0 在 dsh 0.2.1-rc.2 上翻车的**唯一**原因 —— profile startup 读到
	 *
	 *     Plugin dsh-session-curator@0.3.0 is incompatible with dsh 0.2.1-rc.2:
	 *     requirements {"engines.dsh":">=0.2.0-rc.2 <0.2.1-0"}
	 *
	 * 就把整条 entry 拒之门外（宿主半区与客户端半区一起消失），界面上看不出任何插件痕迹：
	 * 插件管理页只是不挂它，`cordis_inspect` 里查不到，槽位里也没有我们的贡献。
	 * 判据逐字照抄 `dsh-app-boot` 的 `satisfies()`（`engines.dsh` 存在时它一票定生死，
	 * 且 `includePrerelease`）—— 用抽出来的**真 semver** 算，不自己写版本比较。
	 */
	const enginesDsh = manifest.engines?.dsh;
	check(
		"engines.dsh admits the DSH runtime this activation just ran against",
		typeof enginesDsh === "string" &&
			enginesDsh.trim() !== "" &&
			semver.satisfies(runtimeVersion, enginesDsh, { includePrerelease: true }),
		`engines.dsh=${JSON.stringify(enginesDsh)} dsh=${runtimeVersion}`
	);

	check(
		"the manifest exports locale JSON for the metadata reader",
		(() => {
			try {
				return pluginRequire.resolve(`${PACKAGE_NAME}/locale/en.json`).endsWith("en.json");
			} catch {
				return false;
			}
		})()
	);

	// 本地化 title / description（app-boot 读取 locale/ 目录下每个 *.json 的 meta）。
	const englishPath = pluginRequire.resolve(`${PACKAGE_NAME}/locale/en.json`);
	const dictionaries = new Map();
	for (const name of readdirSync(dirname(englishPath))) {
		if (!name.endsWith(".json")) continue;
		const id = name.slice(0, -5).toLowerCase();
		const parsed = JSON.parse(readFileSync(pluginRequire.resolve(`${PACKAGE_NAME}/locale/${name}`), "utf8"));
		dictionaries.set(id, parsed.meta ?? {});
	}
	check(
		"every locale file carries meta.title and meta.description",
		[...dictionaries].every(
			([, meta]) =>
				typeof meta.title === "string" && meta.title !== "" && typeof meta.description === "string" && meta.description !== ""
		),
		[...dictionaries].map(([id, meta]) => `${id}:${meta.title}`).join(", ")
	);
	const title = {
		en: manifest.name,
		...Object.fromEntries([...dictionaries].filter(([, meta]) => meta.title !== undefined).map(([id, meta]) => [id, meta.title]))
	};
	const description = {
		en: manifest.description ?? "",
		...Object.fromEntries(
			[...dictionaries].filter(([, meta]) => meta.description !== undefined).map(([id, meta]) => [id, meta.description])
		)
	};
	check(
		"the plugin card gets a real (non-package-name) title in both languages",
		title.en !== manifest.name && typeof title.zh === "string" && title.zh !== "",
		JSON.stringify(title)
	);
	check(
		"the plugin card gets a description in both languages",
		typeof description.en === "string" && description.en !== "" && typeof description.zh === "string" && description.zh !== ""
	);

	// 图标：路径规则 + 体积 + 内容。
	const icon = manifest.icon;
	check(
		"the manifest declares a manifest-relative SVG icon",
		typeof icon === "string" && !isAbsolute(icon) && ICON_MEDIA_TYPES.get(extname(icon).toLowerCase()) === "image/svg+xml",
		JSON.stringify(icon)
	);
	if (typeof icon === "string") {
		const iconFile = realpathSync(resolve(dirname(manifestPath), icon));
		const local = relative(realpathSync(dirname(manifestPath)), iconFile);
		const size = statSync(iconFile).size;
		check(
			"the icon stays inside the manifest directory, is a regular file and fits 256 KiB",
			!local.startsWith("..") && !isAbsolute(local) && statSync(iconFile).isFile() && size <= MAX_ICON_BYTES,
			`${size} B`
		);
		const svg = readFileSync(iconFile, "utf8");
		// 注释不算数：只有真正会被渲染的部分才需要自带着色。
		const shapes = svg.replace(/<!--[\s\S]*?-->/gu, "");
		check(
			"the icon is well-formed SVG with its own colours (it renders through <img>)",
			svg.trimStart().startsWith("<svg") && svg.trimEnd().endsWith("</svg>") && tagsBalanced(svg) && !shapes.includes("currentColor"),
			`${svg.length} chars`
		);
		check(
			"the icon uses the same square canvas as DSH's own plugin artwork",
			/viewBox="0 0 36 36"/u.test(svg) && /width="36"/u.test(svg) && /height="36"/u.test(svg)
		);
		// 只量几何属性（别去扫 xmlns 里的 2000、也别把 #324DE2 读成 324）。
		const geometryAttributes = [...shapes.matchAll(/\b(?:d|viewBox|x|y|x1|y1|x2|y2|width|height|rx)="([^"]*)"/gu)];
		const coordinates = geometryAttributes.flatMap((match) =>
			[...match[1].matchAll(/-?\d+(?:\.\d+)?/gu)].map((number) => Number(number[0]))
		);
		check(
			"every coordinate stays inside the 36×36 canvas",
			coordinates.length > 0 && coordinates.every((value) => value >= 0 && value <= 36),
			`${coordinates.length} numbers, max=${Math.max(...coordinates)}`
		);
	}
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);

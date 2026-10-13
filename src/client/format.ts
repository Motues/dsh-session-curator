/** 展示层的纯格式化：体积 / 时间 / 路径尾段。不依赖任何 DSH 服务，可以单独单测。 */

export function formatBytes(bytes: number | null | undefined): string {
	if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function formatTime(ms: number | null | undefined): string {
	if (typeof ms !== "number" || ms <= 0) return "";
	try {
		return new Date(ms).toLocaleString();
	} catch {
		return "";
	}
}

/** 路径的最后一段（分组标题在 `workspaceTitle` 缺失时用它）。 */
export function baseName(path: string | null | undefined): string {
	if (typeof path !== "string" || path === "") return "";
	const parts = path.split(/[\\/]/).filter((part) => part !== "");
	return parts.length > 0 ? (parts[parts.length - 1] as string) : path;
}

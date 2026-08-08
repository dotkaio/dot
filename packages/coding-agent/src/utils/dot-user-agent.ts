export function getDotUserAgent(version: string): string {
	const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
	return `dot/${version} (${process.platform}; ${runtime}; ${process.arch})`;
}

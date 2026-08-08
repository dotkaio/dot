import { describe, expect, it } from "vitest";
import { getDotUserAgent } from "../src/utils/dot-user-agent.ts";

describe("getDotUserAgent", () => {
	it("formats the user agent expected by github.com/dotkaio/dot", () => {
		const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
		const userAgent = getDotUserAgent("1.2.3");

		expect(userAgent).toBe(`dot/1.2.3 (${process.platform}; ${runtime}; ${process.arch})`);
		expect(userAgent).toMatch(/^dot\/[^\s()]+ \([^;()]+;\s*[^;()]+;\s*[^()]+\)$/);
	});
});

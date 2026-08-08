import { describe, expect, test } from "vitest";
import { type ChangelogEntry, getNewEntries, normalizeChangelogLinks } from "../src/utils/changelog.ts";

const entry: ChangelogEntry = {
	major: 0,
	minor: 79,
	patch: 0,
	content: "",
};

describe("getNewEntries", () => {
	const entries: ChangelogEntry[] = [
		{ major: 0, minor: 83, patch: 0, content: "0.83.0" },
		{ major: 0, minor: 0, patch: 2, content: "0.0.2" },
		{ major: 0, minor: 0, patch: 1, content: "0.0.1" },
	];

	test("ignores changelog entries newer than the running version", () => {
		expect(getNewEntries(entries, "0.0.1", "0.0.1")).toEqual([]);
	});

	test("returns entries after the last seen version through the running version", () => {
		expect(getNewEntries(entries, "0.0.1", "0.0.2").map((item) => item.content)).toEqual(["0.0.2"]);
	});
});

describe("normalizeChangelogLinks", () => {
	test("rewrites package-relative changelog links to tag-pinned GitHub source links", () => {
		const markdown = [
			"[Project Trust](README.md#project-trust)",
			"[Extensions](docs/extensions.md#project_trust)",
			"[Examples](examples/extensions/)",
			"[Root README](../../README.md#supply-chain-hardening)",
		].join("\n");

		expect(normalizeChangelogLinks(markdown, entry)).toBe(
			[
				"[Project Trust](https://github.com/dotkaio/dot/blob/v0.79.0/packages/coding-agent/README.md#project-trust)",
				"[Extensions](https://github.com/dotkaio/dot/blob/v0.79.0/packages/coding-agent/docs/extensions.md#project_trust)",
				"[Examples](https://github.com/dotkaio/dot/tree/v0.79.0/packages/coding-agent/examples/extensions/)",
				"[Root README](https://github.com/dotkaio/dot/blob/v0.79.0/README.md#supply-chain-hardening)",
			].join("\n"),
		);
	});

	test("pins canonical repository source links without changing external links", () => {
		const markdown = [
			"[#5167](https://github.com/dotkaio/dot/pull/5167)",
			"[#4163](https://github.com/dotkaio/dot/issues/4163)",
			"[Agent README](https://github.com/dotkaio/dot/blob/main/packages/agent/README.md)",
			"[External](https://example.com/docs)",
			"[Local anchor](#settings)",
		].join("\n");

		expect(normalizeChangelogLinks(markdown, "0.79.0")).toBe(
			[
				"[#5167](https://github.com/dotkaio/dot/pull/5167)",
				"[#4163](https://github.com/dotkaio/dot/issues/4163)",
				"[Agent README](https://github.com/dotkaio/dot/blob/v0.79.0/packages/agent/README.md)",
				"[External](https://example.com/docs)",
				"[Local anchor](#settings)",
			].join("\n"),
		);
	});
});

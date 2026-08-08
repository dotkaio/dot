import { afterEach, describe, expect, it } from "vitest";
import { areExperimentalFeaturesEnabled } from "../src/core/experimental.ts";

describe("areExperimentalFeaturesEnabled", () => {
	const originalDotExperimental = process.env.DOT_EXPERIMENTAL;

	afterEach(() => {
		if (originalDotExperimental === undefined) {
			delete process.env.DOT_EXPERIMENTAL;
		} else {
			process.env.DOT_EXPERIMENTAL = originalDotExperimental;
		}
	});

	it("returns false when DOT_EXPERIMENTAL is unset", () => {
		delete process.env.DOT_EXPERIMENTAL;

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when DOT_EXPERIMENTAL is empty", () => {
		process.env.DOT_EXPERIMENTAL = "";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns true when DOT_EXPERIMENTAL is set to 1", () => {
		process.env.DOT_EXPERIMENTAL = "1";

		expect(areExperimentalFeaturesEnabled()).toBe(true);
	});

	it("returns false when DOT_EXPERIMENTAL is set to 0", () => {
		process.env.DOT_EXPERIMENTAL = "0";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when DOT_EXPERIMENTAL is set to a non-1 value", () => {
		process.env.DOT_EXPERIMENTAL = "true";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});
});

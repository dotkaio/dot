import assert from "node:assert";
import { describe, it } from "node:test";
import { fuzzyFilter, fuzzyMatch } from "../src/fuzzy.ts";

describe("fuzzyMatch", () => {
	it("empty query matches everything with score 0", () => {
		const result = fuzzyMatch("", "anything");
		assert.strictEqual(result.matches, true);
		assert.strictEqual(result.score, 0);
	});

	it("query longer than text does not match", () => {
		const result = fuzzyMatch("longquery", "short");
		assert.strictEqual(result.matches, false);
	});

	it("exact match has good score", () => {
		const result = fuzzyMatch("test", "test");
		assert.strictEqual(result.matches, true);
		assert.ok(result.score < 0); // Should be negative due to consecutive bonuses
	});

	it("characters must appear in order", () => {
		const matchInOrder = fuzzyMatch("abc", "aXbXc");
		assert.strictEqual(matchInOrder.matches, true);

		const matchOutOfOrder = fuzzyMatch("abc", "cba");
		assert.strictEqual(matchOutOfOrder.matches, false);
	});

	it("case insensitive matching", () => {
		const result = fuzzyMatch("ABC", "abc");
		assert.strictEqual(result.matches, true);

		const result2 = fuzzyMatch("abc", "ABC");
		assert.strictEqual(result2.matches, true);
	});

	it("consecutive matches score better than scattered matches", () => {
		const consecutive = fuzzyMatch("foo", "foobar");
		const scattered = fuzzyMatch("foo", "f_o_o_bar");

		assert.strictEqual(consecutive.matches, true);
		assert.strictEqual(scattered.matches, true);
		assert.ok(consecutive.score < scattered.score);
	});

	it("word boundary matches score better", () => {
		const atBoundary = fuzzyMatch("fb", "foo-bar");
		const notAtBoundary = fuzzyMatch("fb", "afbx");

		assert.strictEqual(atBoundary.matches, true);
		assert.strictEqual(notAtBoundary.matches, true);
		assert.ok(atBoundary.score < notAtBoundary.score);
	});

	it("matches swapped alpha numeric tokens", () => {
		const result = fuzzyMatch("codex52", "gpt-5.2-codex");
		assert.strictEqual(result.matches, true);
	});

	it("rejects cross-word-boundary match across whitespace", () => {
		// "fast" should not match "flash" + "gateway" where 't' comes from "gateway"
		const result = fuzzyMatch("fast", "google/gemini-3.6-flash vercel-ai-gateway");
		assert.strictEqual(result.matches, false);
	});

	it("rejects cross-word-boundary match across slash", () => {
		// characters of query must not span across a /
		const result = fuzzyMatch("fast", "fast/model");
		// "fast" is consecutive before /, so it should match
		assert.strictEqual(result.matches, true);

		// but fa/s should not match because / is in the gap
		const result2 = fuzzyMatch("fas", "fa/s");
		assert.strictEqual(result2.matches, false);
	});

	it("allows dash-separated compound word matches", () => {
		// "v4flash" should match "deepseek-v4-flash" across dashes
		const result = fuzzyMatch("v4flash", "deepseek-v4-flash");
		assert.strictEqual(result.matches, true);
	});

	it("allows dot-separated version matches", () => {
		// "35" should match "3.5" across dot
		const result = fuzzyMatch("35", "model-3.5");
		assert.strictEqual(result.matches, true);
	});

	it("allows colon-separated matches", () => {
		const result = fuzzyMatch("ab", "a:b");
		assert.strictEqual(result.matches, true);
	});

	it("swapped alpha numeric still works after cross-word fix", () => {
		// "codex52" should still match "gpt-5.2-codex" via swapped match
		const result = fuzzyMatch("codex52", "gpt-5.2-codex");
		assert.strictEqual(result.matches, true);

		// "52codex" (digits first) should also work via swapped match
		const result2 = fuzzyMatch("52codex", "gpt-5.2-codex");
		assert.strictEqual(result2.matches, true);
	});

	it("cross-word rejection does not block legitimate whitespace tokens", () => {
		// fuzzyFilter splits by whitespace, so each token is matched independently
		// "flash" as a single token should match "Flash" directly
		const result = fuzzyMatch("flash", "gemini-3.6-flash");
		assert.strictEqual(result.matches, true);

		// The query "fast" should match "fast" directly
		const result2 = fuzzyMatch("fast", "super-fast-model");
		assert.strictEqual(result2.matches, true);
	});

	it("retries a token after an earlier partial match", () => {
		const result = fuzzyMatch("scrollbar", "Fullscreen scrollbar");
		assert.strictEqual(result.matches, true);
	});

	it("query matching entirely within one word still works", () => {
		const result = fuzzyMatch("gt", "gpt-5.2-codex");
		assert.strictEqual(result.matches, true);

		const result2 = fuzzyMatch("codex", "gpt-5.2-codex");
		assert.strictEqual(result2.matches, true);
	});
});

describe("fuzzyFilter", () => {
	it("empty query returns all items unchanged", () => {
		const items = ["apple", "banana", "cherry"];
		const result = fuzzyFilter(items, "", (x: string) => x);
		assert.deepStrictEqual(result, items);
	});

	it("filters out non-matching items", () => {
		const items = ["apple", "banana", "cherry"];
		const result = fuzzyFilter(items, "an", (x: string) => x);
		assert.ok(result.includes("banana"));
		assert.ok(!result.includes("apple"));
		assert.ok(!result.includes("cherry"));
	});

	it("sorts results by match quality", () => {
		const items = ["a_p_p", "app", "application"];
		const result = fuzzyFilter(items, "app", (x: string) => x);

		// "app" should be first (exact consecutive match at start)
		assert.strictEqual(result[0], "app");
	});

	it("prioritizes exact matches over longer prefix matches", () => {
		const items = ["clone", "cl"];
		const result = fuzzyFilter(items, "cl", (x: string) => x);

		assert.deepStrictEqual(result, ["cl", "clone"]);
	});

	it("works with custom getText function", () => {
		const items = [
			{ name: "foo", id: 1 },
			{ name: "bar", id: 2 },
			{ name: "foobar", id: 3 },
		];
		const result = fuzzyFilter(items, "foo", (item: { name: string; id: number }) => item.name);

		assert.strictEqual(result.length, 2);
		assert.ok(result.map((r) => r.name).includes("foo"));
		assert.ok(result.map((r) => r.name).includes("foobar"));
	});

	it("matches slash-separated provider/model queries against reordered text", () => {
		const item = { id: "gpt-5.5", provider: "openai-codex" };
		const result = fuzzyFilter([item], "openai-codex/gpt-5.5", (model) => `${model.id} ${model.provider}`);

		assert.deepStrictEqual(result, [item]);
	});

	it("matches multiple words when a later token starts inside an earlier word", () => {
		const items = ["Fullscreen scrollbar", "Show terminal progress"];
		const result = fuzzyFilter(items, "Fullscreen scrollbar", (item) => item);

		assert.deepStrictEqual(result, ["Fullscreen scrollbar"]);
	});
});

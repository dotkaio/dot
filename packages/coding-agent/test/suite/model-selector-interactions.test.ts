import type { Model, ModelsRefreshResult } from "@dotkaio/dot-ai";
import { setKeybindings, type TUI } from "@dotkaio/dot-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import { ModelSelectorComponent } from "../../src/modes/interactive/components/model-selector.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import { createHarness, type Harness } from "./harness.ts";

function deferCatalogRefresh(harness: Harness): () => void {
	let resolveRefresh: ((result: ModelsRefreshResult) => void) | undefined;
	const pending = new Promise<ModelsRefreshResult>((resolve) => {
		resolveRefresh = resolve;
	});
	vi.spyOn(harness.session.modelRuntime, "refresh").mockReturnValue(pending);
	return () => {
		if (!resolveRefresh) throw new Error("Missing catalog refresh resolver");
		resolveRefresh({ aborted: false, errors: new Map() });
	};
}

async function waitForCatalogRefresh(selector: ModelSelectorComponent): Promise<void> {
	await vi.waitFor(() => {
		expect(stripAnsi(selector.render(140).join("\n"))).toContain("Model catalogs refreshed.");
	});
}

describe("model selector interactions", () => {
	const harnesses: Harness[] = [];
	const selectors: ModelSelectorComponent[] = [];

	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		vi.stubEnv("DOT_OFFLINE", "1");
		setKeybindings(new KeybindingsManager());
	});

	afterEach(() => {
		for (const selector of selectors.splice(0)) selector.handleInput("\x1b");
		for (const harness of harnesses.splice(0)) harness.cleanup();
		vi.restoreAllMocks();
	});

	async function createInteractionHarness(): Promise<Harness> {
		const harness = await createHarness({
			models: [
				{ id: "mini", name: "Mini", contextWindow: 100 },
				{ id: "large-mini", name: "Large Mini", contextWindow: 300 },
				{ id: "medium-mini", name: "Medium Mini", contextWindow: 200 },
				{ id: "other", name: "Other", contextWindow: 400 },
				{ id: "tiny", name: "Tiny", contextWindow: 50 },
			],
		});
		harnesses.push(harness);
		vi.spyOn(harness.session.modelRuntime, "getAvailableSnapshot").mockReturnValue(harness.models);
		return harness;
	}

	function createSelector(
		harness: Harness,
		options: {
			currentModel?: Model<string>;
			scopedModels?: Model<string>[];
			initialSearchInput?: string;
			maxVisible?: number;
		} = {},
	): { selector: ModelSelectorComponent; onSelect: ReturnType<typeof vi.fn> } {
		const onSelect = vi.fn();
		const selector = new ModelSelectorComponent(
			{ requestRender: () => {} } as unknown as TUI,
			options.currentModel ?? harness.models[0],
			harness.settingsManager,
			harness.session.modelRuntime,
			(options.scopedModels ?? []).map((model) => ({ model })),
			onSelect,
			() => {},
			options.initialSearchInput,
			options.maxVisible,
		);
		selectors.push(selector);
		return { selector, onSelect };
	}

	it.each([
		{ keys: ["C"], expected: "large-mini" },
		{ keys: ["C", "C"], expected: "mini" },
	])("keeps the chosen column direction while searching: $expected", async ({ keys, expected }) => {
		const harness = await createInteractionHarness();
		const { selector, onSelect } = createSelector(harness);
		await waitForCatalogRefresh(selector);
		for (const key of keys) selector.handleInput(key);
		for (const char of "mini") selector.handleInput(char);
		selector.handleInput("\r");
		expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: expected }));
	});

	it("preserves the highlighted identity when refreshed catalogs change order", async () => {
		const harness = await createInteractionHarness();
		const finishRefresh = deferCatalogRefresh(harness);
		const { selector, onSelect } = createSelector(harness);
		selector.handleInput("\x1b[B");
		selector.handleInput("\x1b[B");
		const [mini, large, medium, other, tiny] = harness.models;
		vi.spyOn(harness.session.modelRuntime, "getAvailableSnapshot").mockReturnValue(
			[mini, other, large, medium, tiny].map((model) => ({ ...model })),
		);
		finishRefresh();
		await waitForCatalogRefresh(selector);
		selector.handleInput("\r");
		expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "medium-mini" }));
	});

	it("preserves a browsed search result when catalogs finish refreshing", async () => {
		const harness = await createInteractionHarness();
		const finishRefresh = deferCatalogRefresh(harness);
		const { selector, onSelect } = createSelector(harness, { initialSearchInput: "mini" });
		selector.handleInput("\x1b[B");
		finishRefresh();
		await waitForCatalogRefresh(selector);
		selector.handleInput("\r");
		expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "large-mini" }));
	});

	it("clamps selection when the highlighted model disappears during refresh", async () => {
		const harness = await createInteractionHarness();
		const finishRefresh = deferCatalogRefresh(harness);
		const { selector, onSelect } = createSelector(harness);
		selector.handleInput("\x1b[A");
		vi.spyOn(harness.session.modelRuntime, "getAvailableSnapshot").mockReturnValue(harness.models.slice(0, 2));
		finishRefresh();
		await waitForCatalogRefresh(selector);
		selector.handleInput("\r");
		expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "large-mini" }));
	});

	it("keeps scoped order and initially highlights the current model", async () => {
		const harness = await createInteractionHarness();
		const { selector, onSelect } = createSelector(harness, {
			scopedModels: [harness.models[2], harness.models[0], harness.models[1]],
		});
		await waitForCatalogRefresh(selector);
		selector.handleInput("\x1b[A");
		selector.handleInput("\r");
		expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "medium-mini" }));
	});

	it("keeps the current model first in the default all-model order", async () => {
		const harness = await createInteractionHarness();
		const { selector, onSelect } = createSelector(harness, { currentModel: harness.models[2] });
		await waitForCatalogRefresh(selector);
		selector.handleInput("\r");
		expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "medium-mini" }));
	});

	it.each([
		{ keys: ["\x1b[6~"], expected: "medium-mini" },
		{ keys: ["\x1b[6~", "\x1b[6~", "\x1b[6~"], expected: "tiny" },
		{ keys: ["\x1b[6~", "\x1b[6~", "\x1b[5~"], expected: "medium-mini" },
		{ keys: ["\x1b[5~"], expected: "mini" },
	])("moves by a visible page and clamps at the ends: $keys", async ({ keys, expected }) => {
		const harness = await createInteractionHarness();
		const { selector, onSelect } = createSelector(harness, { maxVisible: 2 });
		await waitForCatalogRefresh(selector);
		for (const key of keys) selector.handleInput(key);
		selector.handleInput("\r");
		expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: expected }));
	});

	it("uses configured page navigation keys", async () => {
		setKeybindings(new KeybindingsManager({ "tui.select.pageDown": "ctrl+n", "tui.select.pageUp": "ctrl+p" }));
		const harness = await createInteractionHarness();
		const { selector, onSelect } = createSelector(harness, { maxVisible: 2 });
		await waitForCatalogRefresh(selector);
		selector.handleInput("\x0e");
		selector.handleInput("\x0e");
		selector.handleInput("\x10");
		selector.handleInput("\r");
		expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "medium-mini" }));
	});

	it("keeps the highlighted search result when moving the text cursor", async () => {
		const harness = await createInteractionHarness();
		const { selector, onSelect } = createSelector(harness, { initialSearchInput: "mini" });
		await waitForCatalogRefresh(selector);
		selector.handleInput("\x1b[B");
		selector.handleInput("\x1b[D");
		selector.handleInput("\r");
		expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "large-mini" }));
	});

	it("keeps page navigation safe when the search has no results", async () => {
		const harness = await createInteractionHarness();
		const { selector, onSelect } = createSelector(harness, { initialSearchInput: "no-such-model" });
		await waitForCatalogRefresh(selector);
		selector.handleInput("\x1b[5~");
		selector.handleInput("\x1b[6~");
		selector.handleInput("\r");
		expect(onSelect).not.toHaveBeenCalled();
		expect(stripAnsi(selector.render(140).join("\n"))).toContain("No matching models");
	});
});

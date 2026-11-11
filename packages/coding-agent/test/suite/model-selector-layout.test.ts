import type { Api, Model } from "@dotkaio/dot-ai/compat";
import { setKeybindings, type TUI, visibleWidth } from "@dotkaio/dot-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import * as modelPickerMetadata from "../../src/core/model-picker-metadata.ts";
import { ModelSelectorComponent } from "../../src/modes/interactive/components/model-selector.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import { createHarness, type Harness } from "./harness.ts";

function renderTable(selector: ModelSelectorComponent, width: number, rowCount: number) {
	const lines = selector.render(width);
	const plainLines = lines.map((line) => stripAnsi(line));
	const headerIndex = plainLines.findIndex((line) => /^\s*Model\s/u.test(line) && /\bIQ\b/u.test(line));
	expect(headerIndex, "model table header").toBeGreaterThanOrEqual(0);
	for (const line of lines) {
		expect(visibleWidth(line), stripAnsi(line)).toBeLessThanOrEqual(width);
	}
	return {
		lines: plainLines,
		header: plainLines[headerIndex],
		rows: plainLines.slice(headerIndex + 1, headerIndex + 1 + rowCount),
	};
}

describe("model selector responsive layout", () => {
	const harnesses: Harness[] = [];
	const selectors: ModelSelectorComponent[] = [];
	let previousOffline: string | undefined;

	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		previousOffline = process.env.DOT_OFFLINE;
		process.env.DOT_OFFLINE = "1";
		setKeybindings(new KeybindingsManager());
	});

	afterEach(() => {
		while (selectors.length > 0) selectors.pop()?.handleInput("\x1b");
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
		vi.restoreAllMocks();
		if (previousOffline === undefined) delete process.env.DOT_OFFLINE;
		else process.env.DOT_OFFLINE = previousOffline;
	});

	async function createLayoutSelector(
		options: { count?: number; terminalRows?: number; firstName?: string; refreshFails?: boolean } = {},
	) {
		const definitions = Array.from({ length: options.count ?? 3 }, (_, index) => ({
			id: `layout-${index}`,
			name: index === 0 && options.firstName ? options.firstName : `Model ${String(index).padStart(2, "0")}`,
			reasoning: true,
			contextWindow: 128_000 + index * 1_000,
			maxTokens: 4_096,
			cost: { input: 1.25, output: 5, cacheRead: 0, cacheWrite: 0 },
		}));
		const harness = await createHarness({ models: definitions });
		harnesses.push(harness);
		await harness.session.modelRuntime.refresh({ allowNetwork: false });
		vi.spyOn(harness.session.modelRuntime, "refresh").mockResolvedValue({
			aborted: false,
			errors: options.refreshFails ? new Map([["faux", new Error("fixture refresh failure")]]) : new Map(),
		});
		const metadata: modelPickerMetadata.ModelPickerMetadata = {
			artificialAnalysisScores: {
				exact: new Map(definitions.map((model, index) => [model.id, 70 + index])),
				canonical: new Map(),
			},
			historicalArtificialAnalysisScores: { exact: new Map(), canonical: new Map() },
			vercelReleaseDates: new Map(definitions.map((model) => [model.id, "10/01/2026"])),
			vercelCosts: new Map(),
		};
		vi.spyOn(modelPickerMetadata, "getCachedModelPickerMetadata").mockReturnValue(metadata);
		vi.spyOn(modelPickerMetadata, "getModelPickerMetadata").mockResolvedValue(metadata);
		const onSelect = vi.fn<(model: Model<Api>) => void>();
		const tui = { requestRender: vi.fn(), terminal: { rows: options.terminalRows ?? 80 } } as unknown as TUI;
		const selector = new ModelSelectorComponent(
			tui,
			harness.getModel(),
			harness.settingsManager,
			harness.session.modelRuntime,
			harness.models.map((model) => ({ model })),
			onSelect,
			() => {},
			undefined,
			options.count ?? 3,
		);
		selectors.push(selector);
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		return { selector, onSelect };
	}

	it("keeps IQ and one row per model while resizing from wide to narrow and back", async () => {
		const { selector } = await createLayoutSelector();
		for (const [width, columns] of [
			[120, ["Model", "Context", "Input", "Output", "Provider", "IQ", "Released"]],
			[80, ["Model", "Input", "Output", "Provider", "IQ"]],
			[40, ["Model", "Provider", "IQ"]],
			[120, ["Model", "Context", "Input", "Output", "Provider", "IQ", "Released"]],
		] as const) {
			const rendered = renderTable(selector, width, 3);
			expect(rendered.header.trim().split(/\s{2,}/u)).toEqual(columns);
			for (let index = 0; index < 3; index++) {
				expect(rendered.rows[index]).toContain(`Model 0${index}`);
				expect(rendered.rows[index]).toContain("faux");
				expect(rendered.rows[index]).toMatch(new RegExp(`\\b${70 + index}\\b`, "u"));
			}
		}
	});

	it("keeps the active Context header and its sorted rows on one line", async () => {
		const { selector } = await createLayoutSelector();
		selector.handleInput("C");
		const rendered = renderTable(selector, 120, 3);
		expect(rendered.header).toMatch(/Context\s*↓/u);
		expect(rendered.header).toContain("Released");
		for (let index = 0; index < 3; index++) {
			expect(rendered.rows[index]).toContain(`Model 0${2 - index}`);
			expect(rendered.rows[index]).toContain("10/01/2026");
		}
	});

	it("truncates wide Unicode names without wrapping away the IQ", async () => {
		const { selector } = await createLayoutSelector({
			firstName: "界面模型 e\u0301 界面模型 e\u0301 界面模型 e\u0301",
		});
		for (const width of [120, 80, 40]) {
			const rendered = renderTable(selector, width, 3);
			expect(rendered.rows[0]).toContain("界");
			expect(rendered.rows[0]).toContain("faux");
			expect(rendered.rows[0]).toMatch(/\b70\b/u);
			expect(rendered.rows[0]).not.toContain("\ufffd");
			expect(rendered.rows[1]).toContain("Model 01");
			expect(rendered.rows[2]).toContain("Model 02");
		}
	});

	it("shows omitted values and the selected identity when refreshing cached models fails", async () => {
		const { selector, onSelect } = await createLayoutSelector({ refreshFails: true });
		const rendered = renderTable(selector, 40, 3);
		const output = rendered.lines.join("\n");
		expect(output).toMatch(/showing cached\s+models/u);
		expect(output).toContain("faux/layout-0");
		for (const value of ["Context", "128K", "Input", "$1.25/M", "Output", "$5/M", "Released", "10/01/2026"]) {
			expect(output).toContain(value);
		}
		selector.handleInput("\r");
		expect(onSelect).toHaveBeenCalledOnce();
		expect(onSelect.mock.calls[0]?.[0].id).toBe("layout-0");
	});

	it("fits a 24-row terminal and keeps the navigated selection visible", async () => {
		const { selector, onSelect } = await createLayoutSelector({ count: 30, terminalRows: 24 });
		const initial = renderTable(selector, 80, 1);
		expect(initial.lines.length).toBeLessThanOrEqual(22);
		expect(initial.rows[0]).toContain("Model 00");
		for (let index = 0; index < 18; index++) selector.handleInput("\x1b[B");
		const navigated = renderTable(selector, 80, 1);
		expect(navigated.lines.length).toBeLessThanOrEqual(22);
		expect(navigated.lines.some((line) => /Model 18\s+.*faux\s+88\s*$/u.test(line))).toBe(true);
		expect(navigated.lines.join("\n")).toContain("faux/layout-18");
		selector.handleInput("\r");
		expect(onSelect.mock.calls[0]?.[0].id).toBe("layout-18");
	});
});

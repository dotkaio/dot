import assert from "node:assert";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import type { AutocompleteProvider } from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import { VStack } from "../src/components/v-stack.ts";
import { renderLayoutFrame } from "../src/layout.ts";
import { TuiAltScreen } from "../src/TuiAltScreen.ts";
import { TuiMainScreen } from "../src/TuiMainScreen.ts";
import { type Component, Container } from "../src/tui.ts";
import { defaultEditorTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

const applyCompletion: AutocompleteProvider["applyCompletion"] = (lines, cursorLine, cursorCol, item, prefix) => {
	const currentLine = lines[cursorLine] ?? "";
	return {
		lines: [currentLine.slice(0, cursorCol - prefix.length) + item.value + currentLine.slice(cursorCol)],
		cursorLine,
		cursorCol: cursorCol - prefix.length + item.value.length,
	};
};

async function flushAutocomplete(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("Editor slash-command menu height", () => {
	it("uses every safe terminal row and ignores the generic autocomplete cap", async () => {
		const tui = new TuiMainScreen(new VirtualTerminal(80, 12));
		const editor = new Editor(tui, defaultEditorTheme, { autocompleteMaxVisible: 3 });
		editor.setAutocompleteProvider({
			getSuggestions: async () => ({
				items: Array.from({ length: 7 }, (_, index) => ({
					value: `command-${index}`,
					label: `command-${index}`,
				})),
				prefix: "/",
			}),
			applyCompletion,
		});

		editor.handleInput("/");
		await flushAutocomplete();

		const rendered = editor.render(80).map((line) => stripVTControlCharacters(line));
		assert.strictEqual(
			rendered.findIndex((line) => line.startsWith("┌")),
			7,
		);
		assert.ok(rendered.slice(0, 7).every((line, index) => line.includes(`command-${index}`)));
		assert.strictEqual(rendered.length, 10);
	});

	it("preserves a mounted borderless editor's three-row surface", async () => {
		const terminalRows = 29;
		const tui = new TuiAltScreen(new VirtualTerminal(80, terminalRows));
		const backgroundStart = "\x1b[48;5;236m";
		const editor = new Editor(tui, defaultEditorTheme, {
			showBorder: false,
			minHeight: 3,
			backgroundColor: (text) => `${backgroundStart}${text}\x1b[49m`,
		});
		const editorContainer = new Container();
		editorContainer.addChild(editor);
		const transcript: Component = { render: () => ["transcript"], invalidate: () => {} };
		const footer: Component = { render: () => ["footer"], invalidate: () => {} };
		const dock = new VStack([
			{ component: editorContainer, shrink: 1, minSize: 3 },
			{ component: footer, shrink: 1, minSize: 1 },
		]);
		const root = new VStack([
			{ component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
			{ component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
		]);
		tui.setLayoutRoot(root);
		editor.setAutocompleteProvider({
			getSuggestions: async () => ({
				items: Array.from({ length: 26 }, (_, index) => ({
					value: `command-${index}`,
					label: `command-${index}`,
				})),
				prefix: "/",
			}),
			applyCompletion,
		});

		editor.handleInput("/");
		await flushAutocomplete();

		const frame = renderLayoutFrame(root, 80, terminalRows, () => {});
		assert.strictEqual(frame.lines.filter((line) => line.includes(backgroundStart)).length, 3);
		assert.ok(frame.lines.some((line) => stripVTControlCharacters(line).startsWith("(1/26)")));
	});
});

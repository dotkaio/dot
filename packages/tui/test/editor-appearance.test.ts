import assert from "node:assert";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { Editor } from "../src/components/editor.ts";
import { TuiMainScreen } from "../src/TuiMainScreen.ts";
import { visibleWidth } from "../src/utils.ts";
import { defaultEditorTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("Editor appearance", () => {
	it("renders an inset, borderless, background-filled minimum-height surface that expands", () => {
		const backgroundStart = "\x1b[48;5;236m";
		const backgroundEnd = "\x1b[49m";
		const tui = new TuiMainScreen(new VirtualTerminal(12, 24));
		const editor = new Editor(tui, defaultEditorTheme, {
			showBorder: false,
			marginX: 1,
			minHeight: 2,
			backgroundColor: (text) => `${backgroundStart}${text}${backgroundEnd}`,
		});

		const emptyLines = editor.render(12);
		assert.strictEqual(emptyLines.length, 2);
		for (const line of emptyLines) {
			assert.strictEqual(visibleWidth(line), 12);
			assert.ok(line.startsWith(` ${backgroundStart}`));
			assert.ok(line.endsWith(`${backgroundEnd} `));
			const plainLine = stripVTControlCharacters(line);
			assert.ok(plainLine.startsWith(" "));
			assert.ok(plainLine.endsWith(" "));
			assert.doesNotMatch(plainLine, /[┌┐└┘│]/u);
			assert.ok(!line.includes("\x1b[27m"), "cursor styling must use full reset not inverse-only reset");
		}

		editor.setText("one\ntwo\nthree");
		const expandedLines = editor.render(12);
		assert.strictEqual(expandedLines.length, 3);
		assert.deepStrictEqual(
			expandedLines.map((line) => stripVTControlCharacters(line).trim()),
			["one", "two", "three"],
		);

		editor.setText(Array.from({ length: 20 }, (_, index) => `L${index + 1}`).join("\n"));
		const cappedLines = editor.render(12);
		assert.strictEqual(cappedLines.length, 14);
		assert.strictEqual(stripVTControlCharacters(cappedLines[0]!).trim(), "L7");
		assert.strictEqual(stripVTControlCharacters(cappedLines.at(-1)!).trim(), "L20");
	});
});

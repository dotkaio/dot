import assert from "node:assert";
import { describe, it } from "node:test";
import { TuiMainScreen } from "../src/TuiMainScreen.ts";
import { type Component, Container } from "../src/tui.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

function lines(count: number): Component {
	return {
		render: () => Array.from({ length: count }, (_, index) => `line ${index}`),
		invalidate: () => {},
	};
}

describe("TUI pinned row accounting", () => {
	it("counts rendered rows after a nested component", () => {
		const tui = new TuiMainScreen(new VirtualTerminal(80, 24));
		const editor = lines(3);
		const editorContainer = new Container();
		editorContainer.addChild(editor);
		editorContainer.addChild(lines(2));
		tui.addChild(lines(4));
		tui.addChild(editorContainer);
		tui.addChild(lines(1));

		assert.strictEqual(tui.getPinnedRowsBelow(editor, 80), 3);
		assert.strictEqual(tui.getPinnedRowsBelow(lines(1), 80), undefined);
	});
});

import assert from "node:assert";
import { describe, it } from "node:test";
import { SelectList } from "../src/components/select-list.ts";
import { SettingsList } from "../src/components/settings-list.ts";
import { TuiAltScreen } from "../src/TuiAltScreen.ts";
import type { Component, MouseWheelDirection } from "../src/tui.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

const selectTheme = {
	selectedPrefix: (text: string) => text,
	selectedText: (text: string) => text,
	description: (text: string) => text,
	scrollInfo: (text: string) => text,
	noMatch: (text: string) => text,
};

const settingsTheme = {
	label: (text: string) => text,
	value: (text: string) => text,
	description: (text: string) => text,
	cursor: "> ",
	hint: (text: string) => text,
};

const wheelUp = "\x1b[<64;1;1M";
const wheelDown = "\x1b[<65;1;1M";

class WheelComponent implements Component {
	calls: Array<{ direction: MouseWheelDirection; lines: number }> = [];

	render(): string[] {
		return ["wheel target"];
	}

	invalidate(): void {}

	handleMouseWheel(direction: MouseWheelDirection, lines: number): boolean {
		this.calls.push({ direction, lines });
		return true;
	}
}

describe("mouse-wheel selection", () => {
	it("routes SGR mouse-wheel events to the focused component before viewport scrolling", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const tui = new TuiAltScreen(terminal);
		const component = new WheelComponent();
		tui.addChild(component);
		tui.setFocus(component);
		tui.start();
		await terminal.waitForRender();

		terminal.sendInput(wheelDown);
		terminal.sendInput(wheelUp);

		assert.deepStrictEqual(component.calls, [
			{ direction: "down", lines: 3 },
			{ direction: "up", lines: 3 },
		]);
		tui.stop();
	});

	it("moves select-list selection three rows and clamps at bounds", () => {
		const list = new SelectList(
			["one", "two", "three", "four", "five"].map((label) => ({ value: label, label })),
			5,
			selectTheme,
		);

		list.handleMouseWheel("down", 3);
		assert.strictEqual(list.getSelectedItem()?.value, "four");
		list.handleMouseWheel("down", 3);
		assert.strictEqual(list.getSelectedItem()?.value, "five");
		list.handleMouseWheel("up", 3);
		assert.strictEqual(list.getSelectedItem()?.value, "two");
		list.handleMouseWheel("up", 3);
		assert.strictEqual(list.getSelectedItem()?.value, "one");
	});

	it("routes pageUp/pageDown to focused list before viewport scroll", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const tui = new TuiAltScreen(terminal);
		const component = new WheelComponent();
		tui.addChild(component);
		tui.setFocus(component);
		tui.start();
		await terminal.waitForRender();

		terminal.sendInput("\x1b[5~"); // pageUp
		terminal.sendInput("\x1b[6~"); // pageDown

		assert.deepStrictEqual(component.calls, [
			{ direction: "up", lines: 19 },
			{ direction: "down", lines: 19 },
		]);
		tui.stop();
	});

	it("moves settings-list selection three rows and clamps at bounds", () => {
		const list = new SettingsList(
			["one", "two", "three", "four", "five"].map((label) => ({
				id: label,
				label,
				currentValue: "value",
			})),
			5,
			settingsTheme,
			() => {},
			() => {},
		);

		list.handleMouseWheel("down", 3);
		assert.match(list.render(80)[3] ?? "", /^> four/u);
		list.handleMouseWheel("down", 3);
		assert.match(list.render(80)[4] ?? "", /^> five/u);
		list.handleMouseWheel("up", 3);
		assert.match(list.render(80)[1] ?? "", /^> two/u);
		list.handleMouseWheel("up", 3);
		assert.match(list.render(80)[0] ?? "", /^> one/u);
	});
});

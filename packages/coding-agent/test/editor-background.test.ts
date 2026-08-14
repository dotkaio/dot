import { CombinedAutocompleteProvider, setCapabilities, TuiMainScreen } from "@dotkaio/dot-tui";
import { beforeEach, describe, expect, it } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.ts";
import { getEditorTheme, initTheme, setTerminalBackgroundColor } from "../src/modes/interactive/theme/theme.ts";

describe("main editor background", () => {
	beforeEach(() => {
		setCapabilities({ images: null, trueColor: true, hyperlinks: false });
		initTheme("dark");
		setTerminalBackgroundColor({ r: 24, g: 24, b: 30 });
	});

	it("fills the editor surface with the composited background", () => {
		const editor = new CustomEditor(
			new TuiMainScreen(new VirtualTerminal(20, 24)),
			getEditorTheme(),
			KeybindingsManager.create(),
		);

		const lines = editor.render(20);

		expect(lines).toHaveLength(3);
		for (const line of lines) {
			expect(line).toContain("\x1b[48;2;36;36;41m");
			expect(line).not.toMatch(/\x1b\[(?:38|39)(?:;|m)/);
		}
	});

	it("restores the editor background after the software cursor reset", () => {
		const editor = new CustomEditor(
			new TuiMainScreen(new VirtualTerminal(20, 24)),
			getEditorTheme(),
			KeybindingsManager.create(),
		);
		editor.setText("cursor row");

		const cursorLine = editor.render(20)[0]!;

		expect(cursorLine).toContain("\x1b[0m\x1b[48;2;36;36;41m");
	});

	it("does not resume while the slash-command panel is open", async () => {
		const editor = new CustomEditor(
			new TuiMainScreen(new VirtualTerminal(20, 24)),
			getEditorTheme(),
			KeybindingsManager.create(),
		);
		let resumeCount = 0;
		editor.onAction("app.session.resume", () => {
			resumeCount += 1;
		});
		editor.setAutocompleteProvider(
			new CombinedAutocompleteProvider([{ name: "resume", description: "Resume a session" }], process.cwd()),
		);

		editor.handleInput("/");
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(editor.isShowingAutocomplete()).toBe(true);

		editor.handleInput("\x12");
		expect(resumeCount).toBe(0);

		editor.handleInput("\x1b");
		editor.handleInput("\x12");
		expect(resumeCount).toBe(1);
	});
});

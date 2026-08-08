import { setKeybindings } from "@dotkaio/dot-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import {
	type SettingsCallbacks,
	type SettingsConfig,
	SettingsSelectorComponent,
} from "../src/modes/interactive/components/settings-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("SettingsSelectorComponent", () => {
	beforeAll(() => {
		initTheme("dark");
		setKeybindings(new KeybindingsManager());
	});

	it("cycles through fullscreen scrollbar modes", () => {
		const onChange = vi.fn();
		const selector = new SettingsSelectorComponent(
			{
				fullscreenScrollbar: "auto",
				warnings: {},
				availableThinkingLevels: [],
				availableThemes: [],
			} as unknown as SettingsConfig,
			{ onFullscreenScrollbarChange: onChange } as unknown as SettingsCallbacks,
		);
		const settingsList = selector.getSettingsList();

		for (const character of "Fullscreen scrollbar") settingsList.handleInput(character);
		settingsList.handleInput("\r");
		settingsList.handleInput("\r");
		settingsList.handleInput("\r");

		expect(onChange.mock.calls.flat()).toEqual(["always", "hidden", "auto"]);
	});

	it("shows every setting that fits instead of applying a fixed ten-item cap", () => {
		const selector = new SettingsSelectorComponent(
			{
				autoCompact: true,
				showImages: true,
				imageWidthCells: 60,
				autoResizeImages: true,
				blockImages: false,
				enableSkillCommands: true,
				steeringMode: "all",
				followUpMode: "all",
				transport: "auto",
				httpIdleTimeoutMs: 0,
				thinkingLevel: "off",
				selectorMaxVisible: 100,
				currentTheme: "dark",
				terminalTheme: "dark",
				hideThinkingBlock: false,
				showCacheMissNotices: false,
				collapseChangelog: false,
				enableProviderAttribution: false,
				doubleEscapeAction: "tree",
				treeFilterMode: "default",
				showHardwareCursor: false,
				editorPaddingX: 0,
				outputPad: 0,
				autocompleteMaxVisible: 0,
				quietStartup: false,
				defaultProjectTrust: "ask",
				clearOnShrink: false,
				showTerminalProgress: false,
				uiMode: "fullscreen",
				fullscreenScrollbar: "auto",
				warnings: {},
				availableThinkingLevels: [],
				availableThemes: [],
			} as unknown as SettingsConfig,
			{} as unknown as SettingsCallbacks,
		);

		const output = stripAnsi(selector.render(120).join("\n"));
		expect(output).toContain("Terminal progress");
		expect(output).not.toContain("(1/");
	});
});

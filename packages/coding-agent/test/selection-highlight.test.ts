import { beforeAll, describe, expect, it } from "vitest";
import {
	getSelectListTheme,
	getSettingsListTheme,
	highlightSelectedListItem,
	initTheme,
} from "../src/modes/interactive/theme/theme.ts";

describe("list selection highlighting", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	it("uses terminal reverse-video instead of theme-specific colors", () => {
		const inverse = highlightSelectedListItem("selected option");

		expect(inverse).toBe("\x1b[7mselected option\x1b[27m");
		expect(getSelectListTheme().selectedText("selected option")).toBe(inverse);
		expect(getSettingsListTheme().selectedLine?.("selected option")).toBe(inverse);
	});

	it("removes nested colors and styles from selected rows", () => {
		const styled = `\x1b[38;5;214mwarning\x1b[39m \x1b[1mbold\x1b[22m \x1b[48;5;236mbackground\x1b[49m`;

		expect(highlightSelectedListItem(styled)).toBe("\x1b[7mwarning bold background\x1b[27m");
	});
});

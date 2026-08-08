import { type RgbColor, resetCapabilitiesCache, setCapabilities } from "@dotkaio/dot-tui";
import { afterEach, describe, expect, it } from "vitest";
import {
	blendEditorBackgroundColor,
	detectTerminalBackgroundFromEnv,
	detectTerminalBackgroundTheme,
	getEditorBackground,
	getThemeByName,
	getThemeForRgbColor,
	initTheme,
	parseAutoThemeSetting,
	resolveThemeSetting,
	setTerminalBackgroundColor,
} from "../src/modes/interactive/theme/theme.ts";

afterEach(() => {
	resetCapabilitiesCache();
});

describe("detectTerminalBackgroundFromEnv", () => {
	it("uses the COLORFGBG background color index", () => {
		expect(detectTerminalBackgroundFromEnv({ env: { COLORFGBG: "0;15" } })).toMatchObject({
			theme: "light",
			source: "COLORFGBG",
			confidence: "high",
		});
		expect(detectTerminalBackgroundFromEnv({ env: { COLORFGBG: "15;0" } })).toMatchObject({
			theme: "dark",
			source: "COLORFGBG",
			confidence: "high",
		});
	});

	it("uses the last COLORFGBG field as the background", () => {
		expect(detectTerminalBackgroundFromEnv({ env: { COLORFGBG: "0;7;15" } }).theme).toBe("light");
	});

	it("defaults to dark without terminal background hints", () => {
		expect(detectTerminalBackgroundFromEnv({ env: {} })).toMatchObject({
			theme: "dark",
			source: "fallback",
			confidence: "low",
		});
	});
});

describe("detectTerminalBackgroundTheme", () => {
	it("uses the queried terminal background before environment hints", async () => {
		let queriedTimeoutMs: number | undefined;
		const detection = await detectTerminalBackgroundTheme({
			env: { COLORFGBG: "15;0" },
			timeoutMs: 250,
			ui: {
				async queryTerminalBackgroundColor({ timeoutMs }: { timeoutMs: number }): Promise<RgbColor | undefined> {
					queriedTimeoutMs = timeoutMs;
					return { r: 250, g: 250, b: 250 };
				},
			},
		});

		expect(queriedTimeoutMs).toBe(250);
		expect(detection).toMatchObject({
			theme: "light",
			source: "terminal background",
			confidence: "high",
		});
	});

	it("falls back to environment hints when the terminal query returns no color", async () => {
		const detection = await detectTerminalBackgroundTheme({
			env: { COLORFGBG: "15;0" },
			timeoutMs: 250,
			ui: {
				async queryTerminalBackgroundColor(): Promise<RgbColor | undefined> {
					return undefined;
				},
			},
		});

		expect(detection).toMatchObject({
			theme: "dark",
			source: "COLORFGBG",
			confidence: "high",
		});
	});

	it("falls back to environment hints when the terminal query fails", async () => {
		const detection = await detectTerminalBackgroundTheme({
			env: { COLORFGBG: "0;15" },
			timeoutMs: 250,
			ui: {
				async queryTerminalBackgroundColor(): Promise<RgbColor | undefined> {
					throw new Error("terminal write failed");
				},
			},
		});

		expect(detection).toMatchObject({
			theme: "light",
			source: "COLORFGBG",
			confidence: "high",
		});
	});
});

describe("theme color mode", () => {
	it("uses terminal capabilities", () => {
		setCapabilities({ images: null, trueColor: false, hyperlinks: false });
		const ansi256Theme = getThemeByName("dark");
		if (!ansi256Theme) throw new Error("dark theme not found");
		expect(ansi256Theme.getColorMode()).toBe("256color");
		expect(ansi256Theme.getFgAnsi("accent")).toMatch(/^\x1b\[38;5;\d+m$/);

		setCapabilities({ images: null, trueColor: true, hyperlinks: false });
		const truecolorTheme = getThemeByName("dark");
		if (!truecolorTheme) throw new Error("dark theme not found");
		expect(truecolorTheme.getColorMode()).toBe("truecolor");
		expect(truecolorTheme.getFgAnsi("accent")).toMatch(/^\x1b\[38;2;\d+;\d+;\d+m$/);
	});
});

describe("theme detection from RGB", () => {
	it("classifies RGB colors by luminance", () => {
		expect(getThemeForRgbColor({ r: 8, g: 8, b: 8 })).toBe("dark");
		expect(getThemeForRgbColor({ r: 250, g: 250, b: 250 })).toBe("light");
	});
});

describe("editor background", () => {
	it("composites a 5% black overlay in light mode", () => {
		expect(blendEditorBackgroundColor({ r: 248, g: 248, b: 248 }, "light")).toEqual({
			r: 236,
			g: 236,
			b: 236,
		});
	});

	it("composites a 5% white overlay in dark mode", () => {
		expect(blendEditorBackgroundColor({ r: 24, g: 24, b: 30 }, "dark")).toEqual({ r: 36, g: 36, b: 41 });
	});

	it("applies only a background color and preserves the foreground", () => {
		setCapabilities({ images: null, trueColor: true, hyperlinks: false });
		initTheme("dark");
		setTerminalBackgroundColor({ r: 24, g: 24, b: 30 });

		expect(getEditorBackground("text")).toBe("\x1b[48;2;36;36;41mtext\x1b[49m");
	});

	it("uses the black overlay for the light theme", () => {
		setCapabilities({ images: null, trueColor: true, hyperlinks: false });
		initTheme("light");
		setTerminalBackgroundColor({ r: 248, g: 248, b: 248 });

		expect(getEditorBackground("text")).toBe("\x1b[48;2;236;236;236mtext\x1b[49m");
	});

	it("uses the built-in light background when terminal detection is unavailable", () => {
		setCapabilities({ images: null, trueColor: true, hyperlinks: false });
		initTheme("light");
		setTerminalBackgroundColor({ r: 24, g: 24, b: 30 }, "dark", false);

		expect(getEditorBackground("text")).toBe("\x1b[48;2;236;236;236mtext\x1b[49m");
	});
});

describe("theme setting helpers", () => {
	it("parses and resolves automatic theme settings", () => {
		expect(parseAutoThemeSetting("light/dark")).toEqual({ lightTheme: "light", darkTheme: "dark" });
		expect(resolveThemeSetting("dark", "light")).toBe("dark");
		expect(resolveThemeSetting("light/dark", "light")).toBe("light");
		expect(resolveThemeSetting("light/dark", "dark")).toBe("dark");
		expect(resolveThemeSetting("light/dark/extra", "dark")).toBeUndefined();
	});
});

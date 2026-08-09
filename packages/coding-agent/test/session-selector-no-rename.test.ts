import { setKeybindings } from "@dotkaio/dot-tui";
import { beforeAll, describe, expect, it } from "vitest";
import { KEYBINDINGS, KeybindingsManager } from "../src/core/keybindings.ts";
import type { SessionInfo } from "../src/core/session-manager.ts";
import { SessionSelectorComponent } from "../src/modes/interactive/components/session-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function makeSession(): SessionInfo {
	return {
		path: "/tmp/session.jsonl",
		id: "session",
		cwd: "/tmp",
		name: "Automatic Session Title",
		created: new Date(0),
		modified: new Date(0),
		messageCount: 2,
		firstMessage: "fix automatic session titles",
		allMessagesText: "fix automatic session titles",
		recentUserMessages: ["fix automatic session titles"],
	};
}

describe("session selector automatic naming", () => {
	beforeAll(() => {
		initTheme("dark");
		setKeybindings(new KeybindingsManager());
	});

	it("removes the manual session rename keybinding", () => {
		expect(Object.hasOwn(KEYBINDINGS, "app.session.rename")).toBe(false);
	});

	it("renders only the bulk rename control", async () => {
		const sessions = [makeSession()];
		const selector = new SessionSelectorComponent(
			async () => sessions,
			() => {},
			() => {},
			() => {},
			() => {},
			{ keybindings: new KeybindingsManager() },
		);
		await new Promise<void>((resolve) => setImmediate(resolve));

		const output = selector
			.render(120)
			.join("\n")
			.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
			.toLowerCase();
		expect(output).toContain("rename all");
		expect(output).not.toMatch(/\brename\b(?! all)/);
	});
});

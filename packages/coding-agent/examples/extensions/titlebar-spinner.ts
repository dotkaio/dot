/**
 * Titlebar Spinner Extension
 *
 * Shows a braille spinner animation in the terminal title while the agent is working.
 * Uses `ctx.ui.setTitle()` to update the terminal title via the extension API.
 *
 * Usage:
 *   dot --extension examples/extensions/titlebar-spinner.ts
 */

import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@dotkaio/dot-coding-agent";

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function getBaseTitle(dot: ExtensionAPI): string {
	const cwd = path.basename(process.cwd());
	const session = dot.getSessionName();
	return session ? `dot - ${session} - ${cwd}` : `dot - ${cwd}`;
}

export default function (dot: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | null = null;
	let frameIndex = 0;

	function stopAnimation(ctx: ExtensionContext) {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
		frameIndex = 0;
		ctx.ui.setTitle(getBaseTitle(dot));
	}

	function startAnimation(ctx: ExtensionContext) {
		stopAnimation(ctx);
		timer = setInterval(() => {
			const frame = BRAILLE_FRAMES[frameIndex % BRAILLE_FRAMES.length];
			const cwd = path.basename(process.cwd());
			const session = dot.getSessionName();
			const title = session ? `${frame} dot - ${session} - ${cwd}` : `${frame} dot - ${cwd}`;
			ctx.ui.setTitle(title);
			frameIndex++;
		}, 80);
	}

	dot.on("agent_start", async (_event, ctx) => {
		startAnimation(ctx);
	});

	dot.on("agent_end", async (_event, ctx) => {
		stopAnimation(ctx);
	});

	dot.on("session_shutdown", async (_event, ctx) => {
		stopAnimation(ctx);
	});
}

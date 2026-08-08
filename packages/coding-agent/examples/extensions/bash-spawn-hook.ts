/**
 * Bash Spawn Hook Example
 *
 * Adjusts command, cwd, and env before execution.
 *
 * Usage:
 *   dot -e ./bash-spawn-hook.ts
 */

import type { ExtensionAPI } from "@dotkaio/dot";
import { createBashTool } from "@dotkaio/dot";

export default function (dot: ExtensionAPI) {
	const cwd = process.cwd();

	const bashTool = createBashTool(cwd, {
		spawnHook: ({ command, cwd, env }) => ({
			command: `source ~/.profile\n${command}`,
			cwd,
			env: { ...env, DOT_SPAWN_HOOK: "1" },
		}),
	});

	dot.registerTool({
		...bashTool,
		execute: async (id, params, signal, onUpdate, _ctx) => {
			return bashTool.execute(id, params, signal, onUpdate);
		},
	});
}

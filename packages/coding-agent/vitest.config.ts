import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "../../vitest.base.ts";

const testAgentDir = join(tmpdir(), `dot-vitest-${process.pid}`);
process.once("exit", () => rmSync(testAgentDir, { recursive: true, force: true }));

export default mergeConfig(
	baseConfig,
	defineConfig({
		test: {
			globals: true,
			environment: "node",
			testTimeout: 30000,
			// Keep tests offline and isolate accidental default-path writes from the user's dot data.
			// Tests can opt into networking with allowNetwork() from test/test-network-env.ts.
			env: {
				DOT_OFFLINE: "1",
				DOT_CODING_AGENT_DIR: testAgentDir,
			},
			unstubEnvs: true,
			reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
			silent: "passed-only",
			server: {
				deps: {
					external: [/@silvia-odwyer\/photon-node/],
				},
			},
		},
	}),
);

import { describe, expect, it, vi } from "vitest";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import type { Extension, ExtensionRuntime } from "../src/core/extensions/types.ts";
import type { ModelRegistry } from "../src/core/model-registry.ts";
import type { SessionManager } from "../src/core/session-manager.ts";

const runtime = {} as ExtensionRuntime;
const sessionManager = {} as SessionManager;
const modelRegistry = {} as ModelRegistry;

describe("ExtensionRunner generic event fast path", () => {
	it("does not create an extension context when no handler is registered", async () => {
		const runner = new ExtensionRunner([], runtime, process.cwd(), sessionManager, modelRegistry);
		const createContext = vi.spyOn(runner, "createContext");

		await runner.emit({ type: "agent_start" });

		expect(createContext).not.toHaveBeenCalled();
	});

	it("creates one shared context when handlers are registered", async () => {
		const firstHandler = vi.fn();
		const secondHandler = vi.fn();
		const extension = {
			path: "test-extension.ts",
			handlers: new Map([["agent_start", [firstHandler, secondHandler]]]),
		} as unknown as Extension;
		const runner = new ExtensionRunner([extension], runtime, process.cwd(), sessionManager, modelRegistry);
		const createContext = vi.spyOn(runner, "createContext");

		await runner.emit({ type: "agent_start" });

		expect(createContext).toHaveBeenCalledOnce();
		expect(firstHandler).toHaveBeenCalledOnce();
		expect(secondHandler).toHaveBeenCalledOnce();
	});
});

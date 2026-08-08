import { expect } from "vitest";
import { describeEval } from "vitest-evals";
import { createDotCodingAgentHarness } from "./dot-harness.ts";

const dotCodingAgentHarness = createDotCodingAgentHarness({ noTools: "all" });

describeEval("Dot Coding Agent smoke", { harness: dotCodingAgentHarness }, (it) => {
	it("runs a basic prompt end to end", async ({ run }) => {
		const result = await run("What's the capital of France? Respond with only the city name.");

		expect(result.output.trim()).toBe("Paris");
		expect(result.errors).toEqual([]);
		expect(result.usage.provider).toBe(process.env.DOT_PROVIDER);
		expect(result.usage.model).toBe(process.env.DOT_MODEL);
		expect(result.usage.totalTokens).toBeGreaterThan(0);
	});
});

import { fauxAssistantMessage } from "@dotkaio/dot-ai/compat";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.ts";

describe("AgentSession automatic titles", () => {
	let harness: Harness | undefined;
	let previousGroqApiKey: string | undefined;

	beforeAll(() => {
		previousGroqApiKey = process.env.GROQ_API_KEY;
		delete process.env.GROQ_API_KEY;
	});

	afterAll(() => {
		if (previousGroqApiKey === undefined) delete process.env.GROQ_API_KEY;
		else process.env.GROQ_API_KEY = previousGroqApiKey;
	});

	afterEach(() => {
		harness?.cleanup();
		harness = undefined;
	});

	it("names meaningful sessions and keeps following topic drift", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage("First response"), fauxAssistantMessage("Second response")]);

		await harness.session.prompt("fix OAuth token refresh handling");
		expect(harness.session.sessionName).toBe("Fix OAuth Token Refresh Handling");

		harness.session.setSessionName("Temporary Manual Name");
		await harness.session.prompt("configure Vercel deployment for JuryScan custom domains");
		expect(harness.session.sessionName).toBe("Configure Vercel Deployment JuryScan Custom");
	});
});

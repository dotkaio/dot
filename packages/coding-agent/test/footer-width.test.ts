import { visibleWidth } from "@dotkaio/dot-tui";
import { beforeAll, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import {
	FooterComponent,
	formatContextPercent,
	formatCost,
	formatCwdForFooter,
	formatRemainingBalance,
} from "../src/modes/interactive/components/footer.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

type AssistantUsage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { total: number };
};

function createSession(options: {
	sessionName: string;
	modelId?: string;
	provider?: string;
	reasoning?: boolean;
	thinkingLevel?: string;
	usage?: AssistantUsage;
	percent?: number | null;
	contextWindow?: number;
}): AgentSession {
	const usage = options.usage;
	const entries =
		usage === undefined
			? []
			: [
					{
						type: "message",
						message: {
							role: "assistant",
							usage,
						},
					},
				];

	const contextWindow = options.contextWindow ?? 200_000;
	const percent = options.percent === undefined ? 12.3 : options.percent;
	const sessionCost = usage?.cost.total ?? 0;

	const session = {
		state: {
			model: {
				id: options.modelId ?? "test-model",
				provider: options.provider ?? "test",
				contextWindow,
				reasoning: options.reasoning ?? false,
			},
			thinkingLevel: options.thinkingLevel ?? "off",
		},
		sessionManager: {
			getEntries: () => entries,
			getSessionName: () => options.sessionName,
			getCwd: () => "/tmp/project",
		},
		getContextUsage: () => ({ contextWindow, percent }),
		getSessionStats: () => ({ cost: sessionCost }),
		modelRuntime: {
			isUsingOAuth: () => false,
		},
	};

	return session as unknown as AgentSession;
}

function createFooterData(
	providerCount: number,
	balance: number | null = 34.8855,
	providerSpend: Record<string, number> = {},
	codexWeeklyRemaining: number | null = 31,
): ReadonlyFooterDataProvider {
	const provider = {
		getGitBranch: () => "main",
		getAiGatewayBalance: () => balance,
		getCodexWeeklyRemainingPercent: () => codexWeeklyRemaining,
		getProviderSpend: (providerId: string) => providerSpend[providerId] ?? 0,
		addProviderSpend: (_providerId: string, _amount: number) => {},
		getExtensionStatuses: () => new Map<string, string>(),
		getAvailableProviderCount: () => providerCount,
		onBranchChange: (callback: () => void) => {
			void callback;
			return () => {};
		},
		onBalanceChange: (callback: () => void) => {
			void callback;
			return () => {};
		},
		refreshAiGatewayBalance: async () => {},
		refreshCodexWeeklyLimit: async () => {},
		applyLocalSpend: (_amount: number) => {},
		scheduleBalanceResyncAfterSpend: () => {},
	};

	return provider;
}

describe("formatCwdForFooter", () => {
	it("does not abbreviate sibling paths that share the home prefix", () => {
		expect(formatCwdForFooter("/home/user2", "/home/user")).toBe("/home/user2");
	});

	it("abbreviates the home directory and descendants", () => {
		expect(formatCwdForFooter("/home/user", "/home/user")).toBe("~");
		expect(formatCwdForFooter("/home/user/project", "/home/user")).toBe("~/project");
	});
});

describe("formatCost", () => {
	it("formats money as $0.00", () => {
		expect(formatCost(0)).toBe("$0.00");
		expect(formatCost(1.234)).toBe("$1.23");
		expect(formatCost(0.001)).toBe("$0.00");
	});
});

describe("formatRemainingBalance", () => {
	it("formats remaining balance or $-- when unknown", () => {
		expect(formatRemainingBalance(34.8855)).toBe("$34.89");
		expect(formatRemainingBalance(0)).toBe("$0.00");
		expect(formatRemainingBalance(null)).toBe("$--");
		expect(formatRemainingBalance(undefined)).toBe("$--");
	});
});

describe("formatContextPercent", () => {
	it("renders percent only", () => {
		expect(formatContextPercent(0)).toBe("0%");
		expect(formatContextPercent(12.3)).toBe("12%");
		expect(formatContextPercent(99.6)).toBe("100%");
		expect(formatContextPercent(null)).toBe("?%");
		expect(formatContextPercent(undefined)).toBe("?%");
	});
});

describe("FooterComponent simplified row", () => {
	beforeAll(() => {
		initTheme(undefined, false);
	});

	it("renders a single row with the shared horizontal inset", () => {
		const footer = new FooterComponent(createSession({ sessionName: "" }), createFooterData(1));
		const lines = footer.render(80);
		expect(lines).toHaveLength(1);
		const line = stripAnsi(lines[0]);
		expect(visibleWidth(line)).toBe(80);
		expect(line.startsWith(" ")).toBe(true);
		expect(line.endsWith(" ")).toBe(true);
	});

	it("shows compact Vercel provider and model names on the right", () => {
		const footer = new FooterComponent(
			createSession({
				sessionName: "",
				provider: "vercel-ai-gateway",
				modelId: "deepseek/deepseek-v4-flash-0731",
				percent: 12.3,
				usage: {
					input: 100,
					output: 10,
					cacheRead: 0,
					cacheWrite: 0,
					cost: { total: 0 },
				},
			}),
			createFooterData(1, 34.8855),
		);

		const line = stripAnsi(footer.render(80)[0]);
		expect(line.startsWith(" $34.89 • 12% • $0.00")).toBe(true);
		expect(line.trimEnd().endsWith("vercel • deepseek-v4-flash-0731 • off")).toBe(true);
	});

	it("replaces all right-side model information with a fixed installation label", () => {
		const footer = new FooterComponent(
			createSession({
				sessionName: "",
				provider: "vercel-ai-gateway",
				modelId: "deepseek/deepseek-v4-flash-0731",
				thinkingLevel: "medium",
			}),
			createFooterData(1, 34.8855),
			"Abiy's agent",
		);

		const line = stripAnsi(footer.render(80)[0]);
		expect(line.trimEnd().endsWith("Abiy's agent")).toBe(true);
		expect(line).not.toContain("deepseek-v4-flash-0731");
		expect(line).not.toContain("medium");
	});

	it("shows Codex weekly remaining between provider spend and context", () => {
		const footer = new FooterComponent(
			createSession({
				sessionName: "",
				provider: "openai-codex",
				modelId: "gpt-5.3-codex",
				percent: 12.3,
			}),
			createFooterData(1, 34.8855, { "openai-codex": 12.345 }),
		);

		const line = stripAnsi(footer.render(80)[0]);
		expect(line.startsWith(" $12.35 • 31% • 12% • $0.00")).toBe(true);
		expect(line.trimEnd().endsWith("openai-codex • gpt-5.3-codex • off")).toBe(true);
	});

	it("omits the Codex weekly percentage when unavailable", () => {
		const footer = new FooterComponent(
			createSession({ sessionName: "", provider: "openai-codex", percent: 12.3 }),
			createFooterData(1, null, {}, null),
		);
		const line = stripAnsi(footer.render(80)[0]);
		expect(line.startsWith(" $0.00 • 12% • $0.00")).toBe(true);
	});

	it("includes thinking level in provider • model • thinking format", () => {
		const footer = new FooterComponent(
			createSession({
				sessionName: "",
				provider: "xai",
				modelId: "grok-4.5",
				reasoning: true,
				thinkingLevel: "high",
				percent: 40,
				usage: {
					input: 1,
					output: 1,
					cacheRead: 0,
					cacheWrite: 0,
					cost: { total: 1.2 },
				},
			}),
			createFooterData(1, 12.5),
		);

		const line = stripAnsi(footer.render(100)[0]);
		expect(line).toContain("$0.00");
		expect(line).toContain("40%");
		expect(line).toContain("$1.20");
		expect(line.trimEnd().endsWith("xai • grok-4.5 • high")).toBe(true);
	});

	it("keeps the row within width for wide model names", () => {
		const width = 40;
		const footer = new FooterComponent(
			createSession({
				sessionName: "",
				modelId: "模".repeat(30),
				reasoning: true,
				thinkingLevel: "high",
				percent: 87.5,
				usage: {
					input: 12_345,
					output: 6_789,
					cacheRead: 0,
					cacheWrite: 0,
					cost: { total: 1.234 },
				},
			}),
			createFooterData(2),
		);

		const lines = footer.render(width);
		expect(lines).toHaveLength(1);
		expect(visibleWidth(lines[0])).toBeLessThanOrEqual(width);
	});

	it("shows ?% when context usage is unknown", () => {
		const footer = new FooterComponent(createSession({ sessionName: "", percent: null }), createFooterData(1));
		const line = stripAnsi(footer.render(80)[0]);
		expect(line).toContain("?%");
	});

	it("shows $-- when remaining Vercel balance is unknown", () => {
		const footer = new FooterComponent(
			createSession({ sessionName: "", provider: "vercel-ai-gateway", percent: 10 }),
			createFooterData(1, null),
		);
		const line = stripAnsi(footer.render(80)[0]);
		expect(line.startsWith(" $-- • 10% • $0.00")).toBe(true);
	});

	it("shows $0.00 when a non-Vercel provider has no recorded spend yet", () => {
		const footer = new FooterComponent(
			createSession({ sessionName: "", provider: "anthropic", percent: 10 }),
			createFooterData(1, null),
		);
		const line = stripAnsi(footer.render(80)[0]);
		expect(line.startsWith(" $0.00 • 10% • $0.00")).toBe(true);
	});

	it("appends session total cost after context for any provider", () => {
		const footer = new FooterComponent(
			createSession({
				sessionName: "",
				provider: "anthropic",
				percent: 22.4,
				usage: {
					input: 1000,
					output: 200,
					cacheRead: 0,
					cacheWrite: 0,
					cost: { total: 3.456 },
				},
			}),
			createFooterData(1, null, { anthropic: 99.99 }),
		);
		const line = stripAnsi(footer.render(80)[0]);
		expect(line.startsWith(" $99.99 • 22% • $3.46")).toBe(true);
	});
});

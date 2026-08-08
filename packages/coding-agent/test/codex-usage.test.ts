import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import { fetchCodexWeeklyRemainingPercent, parseCodexWeeklyRemainingPercent } from "../src/core/codex-usage.ts";

function createAccessToken(accountId: string): string {
	const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${encode({ alg: "none" })}.${encode({
		"https://api.openai.com/auth": { chatgpt_account_id: accountId },
	})}.signature`;
}

describe("parseCodexWeeklyRemainingPercent", () => {
	it("converts the primary weekly window from used to remaining percent", () => {
		expect(
			parseCodexWeeklyRemainingPercent({
				rate_limit: {
					primary_window: { used_percent: 69, limit_window_seconds: 604_800 },
				},
			}),
		).toBe(31);
	});

	it("finds a weekly secondary window", () => {
		expect(
			parseCodexWeeklyRemainingPercent({
				rate_limit: {
					primary_window: { used_percent: 10, limit_window_seconds: 18_000 },
					secondary_window: { used_percent: 35.5, limit_window_seconds: 604_800 },
				},
			}),
		).toBe(64.5);
	});

	it("returns null when the account has no weekly window", () => {
		expect(
			parseCodexWeeklyRemainingPercent({
				rate_limit: {
					primary_window: { used_percent: 20, limit_window_seconds: 2_592_000 },
				},
			}),
		).toBeNull();
	});
});

describe("fetchCodexWeeklyRemainingPercent", () => {
	it("uses the OAuth account and returns weekly percentage remaining", async () => {
		const accountId = "account-123";
		const accessToken = createAccessToken(accountId);
		const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
			const headers = new Headers(init?.headers);
			expect(headers.get("authorization")).toBe(`Bearer ${accessToken}`);
			expect(headers.get("chatgpt-account-id")).toBe(accountId);
			return new Response(
				JSON.stringify({
					rate_limit: {
						primary_window: { used_percent: 69, limit_window_seconds: 604_800 },
					},
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});

		await expect(fetchCodexWeeklyRemainingPercent(accessToken, fetchMock)).resolves.toBe(31);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://chatgpt.com/backend-api/wham/usage",
			expect.objectContaining({ headers: expect.any(Object) }),
		);
	});

	it("rejects failed usage requests", async () => {
		const fetchMock = vi.fn(async () => new Response("unauthorized", { status: 401 }));
		await expect(fetchCodexWeeklyRemainingPercent(createAccessToken("account-123"), fetchMock)).rejects.toThrow(
			"OpenAI Codex usage request failed (401)",
		);
	});
});

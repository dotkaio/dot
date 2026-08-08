import { afterEach, describe, expect, it, vi } from "vitest";
import {
	discoverProject,
	loginGoogleGeminiCli,
	refreshGoogleGeminiCliToken,
} from "../src/auth/oauth/google-gemini-cli.ts";
import type { AuthPrompt } from "../src/auth/types.ts";
import { googleGeminiCliProvider } from "../src/providers/google-gemini-cli.ts";

type FetchInit = {
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	signal?: AbortSignal;
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function pendingPrompt(prompt: AuthPrompt): Promise<string> {
	return new Promise((_resolve, reject) => {
		if (prompt.signal?.aborted) {
			reject(new Error("Login cancelled"));
			return;
		}
		prompt.signal?.addEventListener("abort", () => reject(new Error("Login cancelled")), { once: true });
	});
}

describe("google-gemini-cli project discovery", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it("prompts for a project id when paid/standard tiers require one", async () => {
		vi.stubEnv("GOOGLE_CLOUD_PROJECT", "");
		vi.stubEnv("GOOGLE_CLOUD_PROJECT_ID", "");

		const fetchMock = vi.fn(async (input: string | URL, init?: FetchInit) => {
			const url = String(input);
			if (url.includes("v1internal:loadCodeAssist")) {
				return jsonResponse({
					allowedTiers: [{ id: "standard-tier", isDefault: true }],
					ineligibleTiers: [
						{
							tierId: "free-tier",
							reasonMessage:
								"Your current account is not eligible for Gemini Code Assist for individuals, the free version of Gemini Code Assist.",
						},
					],
				});
			}
			if (url.includes("v1internal:onboardUser")) {
				const body = JSON.parse(init?.body ?? "{}") as {
					cloudaicompanionProject?: string;
					tierId?: string;
				};
				expect(body.tierId).toBe("standard-tier");
				expect(body.cloudaicompanionProject).toBe("my-gcp-project");
				return jsonResponse({
					done: true,
					response: { cloudaicompanionProject: { id: "my-gcp-project" } },
				});
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		const onPrompt = vi.fn(async () => "my-gcp-project");
		const projectId = await discoverProject("access-token", undefined, onPrompt);

		expect(onPrompt).toHaveBeenCalled();
		expect(projectId).toBe("my-gcp-project");
	});

	it("uses a dynamic loopback redirect and cancels both authorization waits", async () => {
		const controller = new AbortController();
		let authUrl: string | undefined;
		const login = loginGoogleGeminiCli({
			signal: controller.signal,
			prompt: pendingPrompt,
			notify: (event) => {
				if (event.type !== "auth_url") return;
				authUrl = event.url;
				controller.abort();
			},
		});

		await expect(login).rejects.toThrow("Login cancelled");
		if (!authUrl) throw new Error("Google auth URL was not emitted");
		const authorizationUrl = new URL(authUrl);
		const redirect = new URL(authorizationUrl.searchParams.get("redirect_uri") ?? "");
		expect(redirect.hostname).toBe("127.0.0.1");
		expect(Number(redirect.port)).toBeGreaterThan(0);
		expect(authorizationUrl.searchParams.get("state")).not.toBe(authorizationUrl.searchParams.get("code_challenge"));
	});

	it("rejects a callback whose OAuth state does not match", async () => {
		let resolveAuthUrl: ((url: string) => void) | undefined;
		const authUrl = new Promise<string>((resolve) => {
			resolveAuthUrl = resolve;
		});
		const login = loginGoogleGeminiCli({
			prompt: pendingPrompt,
			notify: (event) => {
				if (event.type === "auth_url") resolveAuthUrl?.(event.url);
			},
		}).then(
			() => ({ error: undefined }),
			(error: unknown) => ({ error }),
		);

		const authorizationUrl = new URL(await authUrl);
		const redirectUri = authorizationUrl.searchParams.get("redirect_uri");
		if (!redirectUri) throw new Error("Google auth URL did not include redirect_uri");
		const callback = new URL(redirectUri);
		callback.searchParams.set("code", "fake-code");
		callback.searchParams.set("state", "wrong-state");
		const response = await fetch(callback);
		expect(response.status).toBe(400);

		const result = await login;
		expect(result.error).toBeInstanceOf(Error);
		expect((result.error as Error).message).toMatch(/state mismatch/i);
	});

	it("surfaces ineligibility reasons instead of a bare project-id error", async () => {
		vi.stubEnv("GOOGLE_CLOUD_PROJECT", "");
		vi.stubEnv("GOOGLE_CLOUD_PROJECT_ID", "");

		const fetchMock = vi.fn(async (input: string | URL) => {
			const url = String(input);
			if (url.includes("v1internal:loadCodeAssist")) {
				return jsonResponse({
					allowedTiers: [{ id: "standard-tier", isDefault: true }],
					ineligibleTiers: [
						{
							tierId: "free-tier",
							reasonMessage:
								"Your current account is not eligible for Gemini Code Assist for individuals, the free version of Gemini Code Assist.",
						},
					],
				});
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(discoverProject("access-token", undefined, async () => "")).rejects.toThrow(
			/not eligible for Gemini Code Assist for individuals/i,
		);
	});

	it("rejects numeric project numbers from the environment", async () => {
		vi.stubEnv("GOOGLE_CLOUD_PROJECT", "123456789012");
		vi.stubEnv("GOOGLE_CLOUD_PROJECT_ID", "");

		const fetchMock = vi.fn(async () => {
			throw new Error("fetch should not be called for invalid numeric project IDs");
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(discoverProject("access-token")).rejects.toThrow(/not the numeric project number/i);
	});

	it("loads subscription auth through the provider without an API key", async () => {
		const oauth = googleGeminiCliProvider().auth.oauth;
		if (!oauth) throw new Error("Google Gemini CLI OAuth is not registered");
		await expect(
			oauth.toAuth({
				type: "oauth",
				access: "access-token",
				refresh: "refresh-token",
				expires: Date.now() + 60_000,
				projectId: "managed-project-abc",
			}),
		).resolves.toEqual({
			apiKey: "access-token",
			headers: { "X-Goog-User-Project": "managed-project-abc" },
		});
	});

	it("rejects malformed stored subscription credentials before a request", async () => {
		const oauth = googleGeminiCliProvider().auth.oauth;
		if (!oauth) throw new Error("Google Gemini CLI OAuth is not registered");
		await expect(
			oauth.toAuth({
				type: "oauth",
				access: "access-token",
				refresh: "refresh-token",
				expires: Date.now() + 60_000,
				projectId: "123456789012",
			}),
		).rejects.toThrow(/numeric project number/i);
		await expect(
			oauth.toAuth({
				type: "oauth",
				access: "",
				refresh: "refresh-token",
				expires: Date.now() + 60_000,
				projectId: "managed-project-abc",
			}),
		).rejects.toThrow(/access token/i);
	});

	it("refreshes subscription tokens and preserves an unrotated refresh token", async () => {
		const fetchMock = vi.fn(async (_input: string | URL, init?: FetchInit) => {
			const form = new URLSearchParams(init?.body);
			expect(form.get("grant_type")).toBe("refresh_token");
			expect(form.get("refresh_token")).toBe("old-refresh");
			return jsonResponse({ access_token: "new-access", expires_in: 3600 });
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(refreshGoogleGeminiCliToken("old-refresh", "managed-project-abc")).resolves.toMatchObject({
			type: "oauth",
			access: "new-access",
			refresh: "old-refresh",
			projectId: "managed-project-abc",
		});
	});

	it("cancels project discovery while a request is pending", async () => {
		vi.stubEnv("GOOGLE_CLOUD_PROJECT", "");
		vi.stubEnv("GOOGLE_CLOUD_PROJECT_ID", "");
		const controller = new AbortController();
		vi.stubGlobal(
			"fetch",
			vi.fn(
				(_input: string | URL, init?: FetchInit) =>
					new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
							once: true,
						});
					}),
			),
		);

		const discovery = discoverProject("access-token", undefined, undefined, controller.signal);
		controller.abort();
		await expect(discovery).rejects.toThrow("Login cancelled");
	});

	it("forwards cancellation through lazy provider token refresh", async () => {
		const oauth = googleGeminiCliProvider().auth.oauth;
		if (!oauth) throw new Error("Google Gemini CLI OAuth is not registered");
		const controller = new AbortController();
		vi.stubGlobal(
			"fetch",
			vi.fn(
				(_input: string | URL, init?: FetchInit) =>
					new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
							once: true,
						});
					}),
			),
		);

		const refresh = oauth.refresh(
			{
				type: "oauth",
				access: "old-access",
				refresh: "old-refresh",
				expires: 0,
				projectId: "managed-project-abc",
			},
			controller.signal,
		);
		controller.abort();
		await expect(refresh).rejects.toThrow("Login cancelled");
	});

	it("reuses an existing managed Cloud Code Assist project", async () => {
		vi.stubEnv("GOOGLE_CLOUD_PROJECT", "");
		vi.stubEnv("GOOGLE_CLOUD_PROJECT_ID", "");

		const fetchMock = vi.fn(async (input: string | URL) => {
			const url = String(input);
			if (url.includes("v1internal:loadCodeAssist")) {
				return jsonResponse({
					currentTier: { id: "free-tier" },
					cloudaicompanionProject: "managed-project-abc",
				});
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(discoverProject("access-token")).resolves.toBe("managed-project-abc");
	});
});

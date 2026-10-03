/**
 * Custom Provider Example
 *
 * Demonstrates registering a custom provider with:
 * - Custom API identifier ("custom-anthropic-api")
 * - Custom streamSimple implementation
 * - OAuth support for /login
 * - API key support via environment variable
 * - Two model definitions
 *
 * Usage:
 * Uses the shared native-fetch Messages adapter; no Anthropic SDK is needed.
 *
 *   # With OAuth (run /login custom-anthropic first)
 *   dot -e ./packages/coding-agent/examples/extensions/custom-provider-anthropic
 *
 *   # With API key
 *   CUSTOM_ANTHROPIC_API_KEY=sk-ant-... dot -e ./packages/coding-agent/examples/extensions/custom-provider-anthropic
 *
 * Then use /model to select custom-anthropic/claude-sonnet-4-5
 */

import type { ExtensionAPI } from "@dotkaio/dot";
import type { Model, OAuthCredentials, OAuthLoginCallbacks } from "@dotkaio/dot-ai";
import { streamSimple as streamAnthropicSimple } from "@dotkaio/dot-ai/api/anthropic-messages";

// =============================================================================
// OAuth implementation adapted for the legacy extension compatibility interface.
// =============================================================================

const decode = (s: string) => atob(s);
const CLIENT_ID = decode("OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl");
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const SCOPES = "org:create_api_key user:profile user:inference";

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	const verifier = btoa(String.fromCharCode(...array))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const hash = await crypto.subtle.digest("SHA-256", data);
	const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

	return { verifier, challenge };
}

async function loginAnthropic(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const { verifier, challenge } = await generatePKCE();

	const authParams = new URLSearchParams({
		code: "true",
		client_id: CLIENT_ID,
		response_type: "code",
		redirect_uri: REDIRECT_URI,
		scope: SCOPES,
		code_challenge: challenge,
		code_challenge_method: "S256",
		state: verifier,
	});

	callbacks.onAuth({ url: `${AUTHORIZE_URL}?${authParams.toString()}` });

	const authCode = await callbacks.onPrompt({ message: "Paste the authorization code:" });
	const [code, state] = authCode.split("#");

	const tokenResponse = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			state,
			redirect_uri: REDIRECT_URI,
			code_verifier: verifier,
		}),
	});

	if (!tokenResponse.ok) {
		throw new Error(`Token exchange failed: ${await tokenResponse.text()}`);
	}

	const data = (await tokenResponse.json()) as {
		access_token: string;
		refresh_token: string;
		expires_in: number;
	};

	return {
		refresh: data.refresh_token,
		access: data.access_token,
		expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
	};
}

async function refreshAnthropicToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			grant_type: "refresh_token",
			client_id: CLIENT_ID,
			refresh_token: credentials.refresh,
		}),
	});

	if (!response.ok) {
		throw new Error(`Token refresh failed: ${await response.text()}`);
	}

	const data = (await response.json()) as {
		access_token: string;
		refresh_token: string;
		expires_in: number;
	};

	return {
		refresh: data.refresh_token,
		access: data.access_token,
		expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
	};
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function (dot: ExtensionAPI) {
	dot.registerProvider("custom-anthropic", {
		baseUrl: "https://api.anthropic.com",
		apiKey: "$CUSTOM_ANTHROPIC_API_KEY",
		api: "custom-anthropic-api",

		models: [
			{
				id: "claude-opus-4-5",
				name: "Claude Opus 4.5 (Custom)",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
				contextWindow: 200000,
				maxTokens: 64000,
			},
			{
				id: "claude-sonnet-4-5",
				name: "Claude Sonnet 4.5 (Custom)",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
				contextWindow: 200000,
				maxTokens: 64000,
			},
		],

		oauth: {
			name: "Custom Anthropic (Claude Pro/Max)",
			login: loginAnthropic,
			refreshToken: refreshAnthropicToken,
			getApiKey: (cred) => cred.access,
		},

		streamSimple: (model, context, options) =>
			streamAnthropicSimple(model as Model<"anthropic-messages">, context, {
				...options,
				maxTokens: options?.maxTokens ?? Math.floor(model.maxTokens / 3),
			}),
	});
}

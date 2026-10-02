/**
 * Meta Model API (Muse) OAuth flow.
 *
 * RFC 8628 device authorization grant against https://auth.meta.com, the same
 * browser sign-in Meta's Muse Code launcher performs: client id
 * 1031625952748946, form-encoded requests, JSON responses. The access token
 * authenticates requests to https://api.meta.ai/v1 as an
 * `Authorization: Bearer` header. Token response fields beyond `access_token`
 * are not publicly documented, so `refresh_token` and `expires_in` are parsed
 * tolerantly: without a refresh token the credential is cleared and the user
 * is prompted to sign in again after expiry.
 */

import { getProviderEnvValue } from "../../utils/provider-env.ts";
import type { AuthInteraction, OAuthAuth, OAuthCredential } from "../types.ts";
import { pollOAuthDeviceCodeFlow } from "./device-code.ts";

const CLIENT_ID = "1031625952748946";
const DEFAULT_OAUTH_HOST = "https://auth.meta.com";
const DEFAULT_DEVICE_LIFETIME_SECONDS = 900;
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const REQUEST_TIMEOUT_MS = 30 * 1000;
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const DEFAULT_TOKEN_LIFETIME_SECONDS = 3600;
const REFRESH_MAX_RETRIES = 3;

type DeviceAuthorization = {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete: string | undefined;
	intervalSeconds: number;
	expiresInSeconds: number;
};

type TokenResponse = {
	access: string;
	refresh: string;
	expires: number;
};

function getOauthHost(): string {
	const override = getProviderEnvValue("MUSE_OAUTH_HOST");
	return (override || DEFAULT_OAUTH_HOST).replace(/\/+$/, "");
}

function requestSignal(signal?: AbortSignal): AbortSignal {
	return AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...(signal ? [signal] : [])]);
}

function formUrlEncode(fields: Record<string, string>): string {
	return new URLSearchParams(fields).toString();
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
	try {
		const json = await response.json();
		return json && typeof json === "object" ? (json as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** Verification URIs are opened in the user's browser; only http(s) URLs are trusted. */
function trustedHttpUrl(value: unknown): string | null {
	if (typeof value !== "string" || !value) return null;
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" && url.protocol !== "http:") return null;
		return url.href;
	} catch {
		return null;
	}
}

async function startDeviceAuthorization(oauthHost: string, signal?: AbortSignal): Promise<DeviceAuthorization> {
	const response = await fetch(`${oauthHost}/oidc/device/authorization/`, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: formUrlEncode({ client_id: CLIENT_ID }),
		signal: requestSignal(signal),
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`Muse device authorization failed with status ${response.status}${text ? `: ${text}` : ""}`);
	}

	const json = await readJson(response);
	const deviceCode = json?.device_code;
	const userCode = json?.user_code;
	const verificationUri = trustedHttpUrl(json?.verification_uri);
	const verificationUriComplete = trustedHttpUrl(json?.verification_uri_complete) ?? undefined;
	if (typeof deviceCode !== "string" || !deviceCode || typeof userCode !== "string" || !userCode || !verificationUri) {
		throw new Error(`Invalid Muse device authorization response: ${JSON.stringify(json)}`);
	}

	const interval = json?.interval;
	const expiresIn = json?.expires_in;
	return {
		deviceCode,
		userCode,
		verificationUri,
		verificationUriComplete,
		intervalSeconds:
			typeof interval === "number" && Number.isFinite(interval) && interval > 0
				? interval
				: DEFAULT_POLL_INTERVAL_SECONDS,
		expiresInSeconds:
			typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0
				? expiresIn
				: DEFAULT_DEVICE_LIFETIME_SECONDS,
	};
}

function parseTokenResponse(json: Record<string, unknown> | null, operation: string): TokenResponse {
	const accessToken = json?.access_token;
	if (typeof accessToken !== "string" || !accessToken) {
		throw new Error(`Muse token ${operation} response missing access_token: ${JSON.stringify(json)}`);
	}

	const refreshToken = json?.refresh_token;
	const expiresIn = json?.expires_in;
	return {
		access: accessToken,
		refresh: typeof refreshToken === "string" ? refreshToken : "",
		expires:
			typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0
				? Date.now() + expiresIn * 1000 - TOKEN_EXPIRY_SKEW_MS
				: Date.now() + DEFAULT_TOKEN_LIFETIME_SECONDS * 1000,
	};
}

async function pollForToken(
	oauthHost: string,
	device: DeviceAuthorization,
	signal?: AbortSignal,
): Promise<TokenResponse> {
	return pollOAuthDeviceCodeFlow<TokenResponse>({
		intervalSeconds: device.intervalSeconds,
		expiresInSeconds: device.expiresInSeconds,
		waitBeforeFirstPoll: true,
		signal,
		poll: async () => {
			const response = await fetch(`${oauthHost}/oidc/device/token/`, {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Accept: "application/json",
				},
				body: formUrlEncode({
					client_id: CLIENT_ID,
					device_code: device.deviceCode,
					grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				}),
				signal: requestSignal(signal),
			});

			if (response.status >= 500) {
				const text = await response.text().catch(() => "");
				return {
					status: "failed",
					message: `Muse device token request failed with status ${response.status}${text ? `: ${text}` : ""}`,
				};
			}

			const json = await readJson(response);
			if (response.ok && typeof json?.access_token === "string") {
				try {
					return { status: "complete", value: parseTokenResponse(json, "poll") };
				} catch (error) {
					return { status: "failed", message: error instanceof Error ? error.message : String(error) };
				}
			}

			const error = json?.error;
			const description = typeof json?.error_description === "string" ? `: ${json.error_description}` : "";
			if (error === "authorization_pending") {
				return { status: "pending" };
			}
			if (error === "slow_down") {
				const interval = json?.interval;
				return {
					status: "slow_down",
					intervalSeconds: typeof interval === "number" && interval > 0 ? interval : undefined,
				};
			}
			if (error === "expired_token") {
				return { status: "failed", message: "Muse device authorization expired. Please restart login." };
			}
			if (error === "access_denied") {
				return { status: "failed", message: "Muse login was denied." };
			}
			return {
				status: "failed",
				message: `Muse device token request failed (status ${response.status})${typeof error === "string" ? `: ${error}${description}` : ""}`,
			};
		},
	});
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableRefreshFailure(response: Response): boolean {
	return response.status === 429 || response.status >= 500;
}

async function refreshAccessToken(
	oauthHost: string,
	refreshTokenValue: string,
	signal?: AbortSignal,
): Promise<TokenResponse> {
	let lastError: Error | undefined;
	for (let attempt = 0; attempt <= REFRESH_MAX_RETRIES; attempt++) {
		if (attempt > 0) {
			await sleep(1000 * 2 ** (attempt - 1));
		}
		if (signal?.aborted) {
			throw new Error("Muse token refresh aborted");
		}

		let response: Response;
		try {
			response = await fetch(`${oauthHost}/oidc/device/token/`, {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Accept: "application/json",
				},
				body: formUrlEncode({
					client_id: CLIENT_ID,
					grant_type: "refresh_token",
					refresh_token: refreshTokenValue,
				}),
				signal: requestSignal(signal),
			});
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			continue;
		}

		const json = await readJson(response);
		if (response.ok) {
			return parseTokenResponse(json, "refresh");
		}

		// Unauthorized: the stored credential is dead; Models clears it and prompts re-login.
		if (response.status === 401 || response.status === 403 || json?.error === "invalid_grant") {
			const description = typeof json?.error_description === "string" ? `: ${json.error_description}` : "";
			throw new Error(`Muse token refresh unauthorized (status ${response.status})${description}`);
		}

		if (isRetryableRefreshFailure(response) && attempt < REFRESH_MAX_RETRIES) {
			lastError = new Error(`Muse token refresh failed with status ${response.status}`);
			continue;
		}

		const text = JSON.stringify(json);
		throw new Error(`Muse token refresh failed with status ${response.status}${text ? `: ${text}` : ""}`);
	}

	throw lastError ?? new Error("Muse token refresh failed");
}

async function loginMuse(interaction: AuthInteraction): Promise<OAuthCredential> {
	const oauthHost = getOauthHost();
	const device = await startDeviceAuthorization(oauthHost, interaction.signal);
	interaction.notify({
		type: "device_code",
		userCode: device.userCode,
		verificationUri: device.verificationUriComplete ?? device.verificationUri,
		intervalSeconds: device.intervalSeconds,
		expiresInSeconds: device.expiresInSeconds,
	});
	const token = await pollForToken(oauthHost, device, interaction.signal);
	return { type: "oauth", access: token.access, refresh: token.refresh, expires: token.expires };
}

export const museOAuth: OAuthAuth = {
	name: "Muse (Meta account)",
	loginLabel: "Sign in with a Meta account",

	login: loginMuse,

	refresh: async (credential, signal) => {
		if (!credential.refresh) {
			throw new Error("Muse session cannot be refreshed; sign in again.");
		}
		const token = await refreshAccessToken(getOauthHost(), credential.refresh, signal);
		return { type: "oauth", access: token.access, refresh: token.refresh, expires: token.expires };
	},

	async toAuth(credential) {
		return { headers: { Authorization: `Bearer ${credential.access}` } };
	},
};

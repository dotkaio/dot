import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { getProviderEnvValue } from "../../utils/provider-env.ts";
import type { AuthInteraction, OAuthAuth, OAuthCredential } from "../types.ts";
import { oauthErrorHtml, oauthSuccessHtml } from "./oauth-page.ts";
import { generatePKCE } from "./pkce.ts";

type GeminiCredentials = OAuthCredential & { projectId?: string; email?: string };
type ProjectPrompt = { message: string; placeholder?: string };

type CallbackServerInfo = {
	server: Server;
	redirectUri: string;
	cancelWait: () => void;
	waitForCode: () => Promise<{ code: string; state: string } | null>;
};

type LoadCodeAssistPayload = {
	cloudaicompanionProject?: string;
	currentTier?: { id?: string; name?: string };
	allowedTiers?: Array<{ id?: string; isDefault?: boolean; name?: string }>;
	ineligibleTiers?: Array<{
		tierId?: string;
		tierName?: string;
		reasonCode?: string;
		reasonMessage?: string;
		validationUrl?: string;
	}>;
};

type LongRunningOperationResponse = {
	name?: string;
	done?: boolean;
	response?: { cloudaicompanionProject?: { id?: string } };
};

type GoogleRpcErrorResponse = {
	error?: { details?: Array<{ reason?: string }> };
};

type FetchResponse = {
	ok: boolean;
	status: number;
	statusText: string;
	text(): Promise<string>;
	json(): Promise<unknown>;
	clone(): FetchResponse;
};

function asFetchResponse(response: unknown): FetchResponse {
	return response as FetchResponse;
}

const decode = (s: string) => atob(s);
const CLIENT_ID = decode(
	"NjgxMjU1ODA5Mzk1LW9vOGZ0Mm9wcmRybnA5ZTNhcWY2YXYzaG1kaWIxMzVqLmFwcHMuZ29vZ2xldXNlcmNvbnRlbnQuY29t",
);
const CLIENT_SECRET = decode("R09DU1BYLTR1SGdNUG0tMW83U2stZ2VWNkN1NWNsWEZzeGw=");
const CALLBACK_PATH = "/oauth2callback";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const TIER_FREE = "free-tier";
const TIER_LEGACY = "legacy-tier";
const SCOPES = [
	"https://www.googleapis.com/auth/cloud-platform",
	"https://www.googleapis.com/auth/userinfo.email",
	"https://www.googleapis.com/auth/userinfo.profile",
];

function getEnv(name: string): string | undefined {
	return getProviderEnvValue(name);
}

function startCallbackServer(expectedState: string): Promise<CallbackServerInfo> {
	return new Promise((resolve, reject) => {
		let settleWait: ((value: { code: string; state: string } | null) => void) | undefined;
		let rejectWait: ((error: Error) => void) | undefined;
		const waitForCodePromise = new Promise<{ code: string; state: string } | null>((resolveWait, rejectCode) => {
			let settled = false;
			settleWait = (value) => {
				if (settled) return;
				settled = true;
				resolveWait(value);
			};
			rejectWait = (error) => {
				if (settled) return;
				settled = true;
				rejectCode(error);
			};
		});

		const server = createServer((req, res) => {
			try {
				const url = new URL(req.url || "", "http://127.0.0.1");
				if (url.pathname !== CALLBACK_PATH) {
					res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
					res.end(oauthErrorHtml("Callback route not found."));
					return;
				}
				const error = url.searchParams.get("error");
				if (error) {
					const description = url.searchParams.get("error_description");
					res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
					res.end(
						oauthErrorHtml(
							"Google authentication did not complete.",
							`Error: ${error}${description ? `: ${description}` : ""}`,
						),
					);
					rejectWait?.(new Error(`Google OAuth error: ${error}${description ? `: ${description}` : ""}`));
					return;
				}
				const code = url.searchParams.get("code");
				const state = url.searchParams.get("state");
				if (!code || !state) {
					res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
					res.end(oauthErrorHtml("Missing code or state parameter."));
					return;
				}
				if (state !== expectedState) {
					res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
					res.end(oauthErrorHtml("OAuth state mismatch."));
					rejectWait?.(new Error("OAuth state mismatch"));
					return;
				}
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(oauthSuccessHtml("Google authentication completed. You can close this window."));
				settleWait?.({ code, state });
			} catch {
				res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
				res.end(oauthErrorHtml("Internal error while processing OAuth callback."));
			}
		});

		server.on("error", (error) => {
			reject(error);
			rejectWait?.(error);
		});
		const callbackHost =
			getProviderEnvValue("DOT_OAUTH_CALLBACK_HOST") || getProviderEnvValue("OAUTH_CALLBACK_HOST") || "127.0.0.1";
		server.listen(0, callbackHost, () => {
			const address = server.address() as AddressInfo | null;
			if (!address) {
				server.close();
				reject(new Error("Google OAuth callback server did not expose a listening address"));
				return;
			}
			resolve({
				server,
				redirectUri: `http://127.0.0.1:${address.port}${CALLBACK_PATH}`,
				cancelWait: () => settleWait?.(null),
				waitForCode: () => waitForCodePromise,
			});
		});
	});
}

function parseAuthorizationInput(input: string): { code?: string; state?: string } {
	const value = input.trim();
	if (!value) return {};
	try {
		const url = new URL(value);
		return {
			code: url.searchParams.get("code") ?? undefined,
			state: url.searchParams.get("state") ?? undefined,
		};
	} catch {}
	if (value.includes("code=")) {
		const params = new URLSearchParams(value);
		return { code: params.get("code") ?? undefined, state: params.get("state") ?? undefined };
	}
	return { code: value };
}

function isVpcScAffectedUser(payload: unknown): boolean {
	if (!payload || typeof payload !== "object" || !("error" in payload)) return false;
	const error = (payload as GoogleRpcErrorResponse).error;
	return error?.details?.some((detail) => detail.reason === "SECURITY_POLICY_VIOLATED") ?? false;
}

function defaultTier(allowedTiers?: Array<{ id?: string; isDefault?: boolean }>): string {
	return allowedTiers?.find((tier) => tier.isDefault)?.id ?? allowedTiers?.[0]?.id ?? TIER_LEGACY;
}

function isNumericProjectId(projectId: string): boolean {
	return /^\d+$/.test(projectId);
}

function formatIneligibleTiers(ineligibleTiers?: LoadCodeAssistPayload["ineligibleTiers"]): string | undefined {
	if (!ineligibleTiers?.length) return undefined;
	const reasons = ineligibleTiers
		.map((tier) => tier.reasonMessage?.trim())
		.filter((reason): reason is string => Boolean(reason));
	if (reasons.length === 0) return undefined;
	return reasons.join(" ");
}

function projectIdRequiredError(ineligibleTiers?: LoadCodeAssistPayload["ineligibleTiers"]): Error {
	const ineligible = formatIneligibleTiers(ineligibleTiers);
	if (ineligible) {
		return new Error(
			`${ineligible} If this account uses Gemini Code Assist Standard/Enterprise, set GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID to a string project ID (not the numeric project number), or enter one when prompted during /login. See https://goo.gle/gemini-cli-auth-docs#workspace-gca`,
		);
	}
	return new Error(
		"This account requires a Google Cloud project ID for Gemini CLI subscription auth. Set GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID to a string project ID (not the numeric project number), or enter one when prompted during /login. See https://goo.gle/gemini-cli-auth-docs#workspace-gca",
	);
}

async function resolveProjectId(
	envProjectId: string | undefined,
	onPrompt?: (prompt: ProjectPrompt) => Promise<string>,
	onProgress?: (message: string) => void,
	ineligibleTiers?: LoadCodeAssistPayload["ineligibleTiers"],
): Promise<string> {
	const candidates = [envProjectId];
	if (onPrompt) {
		onProgress?.("A Google Cloud project ID is required for this account.");
		const entered = (
			await onPrompt({
				message:
					"Enter your Google Cloud project ID (string ID, not the numeric project number). Leave empty to cancel:",
				placeholder: "my-gcp-project",
			})
		).trim();
		candidates.push(entered || undefined);
	}

	for (const candidate of candidates) {
		if (!candidate) continue;
		if (isNumericProjectId(candidate)) {
			throw new Error(
				`Invalid Google Cloud Project ID: "${candidate}". Use the string project ID (for example, "my-project-123"), not the numeric project number.`,
			);
		}
		return candidate;
	}

	throw projectIdRequiredError(ineligibleTiers);
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.reject(new Error("Login cancelled"));
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timeout);
			reject(new Error("Login cancelled"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

async function fetchWithCancellation(url: string, init: RequestInit, signal?: AbortSignal): Promise<FetchResponse> {
	if (signal?.aborted) throw new Error("Login cancelled");
	try {
		return asFetchResponse(await fetch(url, { ...init, signal }));
	} catch (error) {
		if (signal?.aborted) throw new Error("Login cancelled");
		throw error;
	}
}

async function pollOperation(
	operationName: string,
	headers: Record<string, string>,
	onProgress?: (message: string) => void,
	signal?: AbortSignal,
): Promise<LongRunningOperationResponse> {
	let attempt = 0;
	while (true) {
		if (attempt > 0) {
			onProgress?.(`Waiting for project provisioning (attempt ${attempt + 1})...`);
			await wait(5000, signal);
		}
		const response = await fetchWithCancellation(
			`${CODE_ASSIST_ENDPOINT}/v1internal/${operationName}`,
			{ headers },
			signal,
		);
		if (!response.ok) throw new Error(`Failed to poll operation: ${response.status} ${response.statusText}`);
		const data = (await response.json()) as LongRunningOperationResponse;
		if (data.done) return data;
		attempt++;
	}
}

/** @internal exported for tests */
export async function discoverProject(
	accessToken: string,
	onProgress?: (message: string) => void,
	onPrompt?: (prompt: ProjectPrompt) => Promise<string>,
	signal?: AbortSignal,
): Promise<string> {
	const envProjectId = getEnv("GOOGLE_CLOUD_PROJECT") || getEnv("GOOGLE_CLOUD_PROJECT_ID");
	if (envProjectId && isNumericProjectId(envProjectId)) {
		throw new Error(
			`Invalid Google Cloud Project ID: "${envProjectId}". Use the string project ID (for example, "my-project-123"), not the numeric project number.`,
		);
	}
	const headers = {
		Authorization: `Bearer ${accessToken}`,
		"Content-Type": "application/json",
		"User-Agent": "google-api-nodejs-client/9.15.1",
		"X-Goog-Api-Client": "gl-node/22.19.0",
	};
	onProgress?.("Checking for existing Cloud Code Assist project...");
	const loadResponse = await fetchWithCancellation(
		`${CODE_ASSIST_ENDPOINT}/v1internal:loadCodeAssist`,
		{
			method: "POST",
			headers,
			body: JSON.stringify({
				cloudaicompanionProject: envProjectId,
				metadata: {
					ideType: "IDE_UNSPECIFIED",
					platform: "PLATFORM_UNSPECIFIED",
					pluginType: "GEMINI",
					duetProject: envProjectId,
				},
			}),
		},
		signal,
	);

	let data: LoadCodeAssistPayload;
	if (loadResponse.ok) {
		data = (await loadResponse.json()) as LoadCodeAssistPayload;
	} else {
		let errorPayload: unknown;
		try {
			errorPayload = await loadResponse.clone().json();
		} catch {}
		if (isVpcScAffectedUser(errorPayload)) {
			data = { currentTier: { id: "standard-tier" } };
		} else {
			throw new Error(
				`loadCodeAssist failed: ${loadResponse.status} ${loadResponse.statusText}: ${await loadResponse.text()}`,
			);
		}
	}

	if (data.currentTier) {
		if (data.cloudaicompanionProject) return data.cloudaicompanionProject;
		return resolveProjectId(envProjectId, onPrompt, onProgress, data.ineligibleTiers);
	}

	const tierId = defaultTier(data.allowedTiers);
	let projectId = envProjectId;
	if (tierId !== TIER_FREE) {
		projectId = await resolveProjectId(envProjectId, onPrompt, onProgress, data.ineligibleTiers);
	}

	onProgress?.("Provisioning Cloud Code Assist project...");
	const onboardBody: Record<string, unknown> = {
		tierId,
		metadata: { ideType: "IDE_UNSPECIFIED", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" },
	};
	// Free tier uses a managed Google project. Sending a project ID can fail with Precondition Failed.
	if (tierId !== TIER_FREE && projectId) {
		onboardBody.cloudaicompanionProject = projectId;
		onboardBody.metadata = { ...(onboardBody.metadata as Record<string, unknown>), duetProject: projectId };
	}

	const onboardResponse = await fetchWithCancellation(
		`${CODE_ASSIST_ENDPOINT}/v1internal:onboardUser`,
		{
			method: "POST",
			headers,
			body: JSON.stringify(onboardBody),
		},
		signal,
	);
	if (!onboardResponse.ok) {
		throw new Error(
			`onboardUser failed: ${onboardResponse.status} ${onboardResponse.statusText}: ${await onboardResponse.text()}`,
		);
	}
	let operation = (await onboardResponse.json()) as LongRunningOperationResponse;
	if (!operation.done && operation.name) operation = await pollOperation(operation.name, headers, onProgress, signal);
	const provisionedProjectId = operation.response?.cloudaicompanionProject?.id;
	if (provisionedProjectId) return provisionedProjectId;
	if (projectId) return projectId;
	throw projectIdRequiredError(data.ineligibleTiers);
}

async function getUserEmail(accessToken: string, signal?: AbortSignal): Promise<string | undefined> {
	try {
		const response = await fetchWithCancellation(
			"https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
			{
				headers: { Authorization: `Bearer ${accessToken}` },
			},
			signal,
		);
		if (!response.ok) return undefined;
		const data = (await response.json()) as { email?: string };
		return data.email;
	} catch {
		if (signal?.aborted) throw new Error("Login cancelled");
		return undefined;
	}
}

async function exchangeCode(
	code: string,
	verifier: string,
	redirectUri: string,
	signal?: AbortSignal,
): Promise<{ access: string; refresh: string; expires: number }> {
	const response = await fetchWithCancellation(
		TOKEN_URL,
		{
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: CLIENT_ID,
				client_secret: CLIENT_SECRET,
				code,
				grant_type: "authorization_code",
				redirect_uri: redirectUri,
				code_verifier: verifier,
			}),
		},
		signal,
	);
	if (!response.ok) throw new Error(`Google token exchange failed: ${await response.text()}`);
	const data = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
	if (
		!data.access_token ||
		!data.refresh_token ||
		typeof data.expires_in !== "number" ||
		!Number.isFinite(data.expires_in) ||
		data.expires_in <= 0
	) {
		throw new Error(`Google token exchange response missing fields: ${JSON.stringify(data)}`);
	}
	return {
		access: data.access_token,
		refresh: data.refresh_token,
		expires: Date.now() + data.expires_in * 1000 - 300000,
	};
}

export async function refreshGoogleGeminiCliToken(
	refreshToken: string,
	projectId: string,
	signal?: AbortSignal,
): Promise<OAuthCredential> {
	const validProjectId = validateStoredProjectId(projectId);
	const validRefreshToken = validateStoredRefreshToken(refreshToken);
	const response = await fetchWithCancellation(
		TOKEN_URL,
		{
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: CLIENT_ID,
				client_secret: CLIENT_SECRET,
				refresh_token: validRefreshToken,
				grant_type: "refresh_token",
			}),
		},
		signal,
	);
	if (!response.ok) throw new Error(`Google token refresh failed: ${await response.text()}`);
	const data = (await response.json()) as { access_token?: string; expires_in?: number; refresh_token?: string };
	if (
		!data.access_token ||
		typeof data.expires_in !== "number" ||
		!Number.isFinite(data.expires_in) ||
		data.expires_in <= 0
	) {
		throw new Error(`Google token refresh response missing fields: ${JSON.stringify(data)}`);
	}
	return {
		type: "oauth",
		access: data.access_token,
		refresh: data.refresh_token || validRefreshToken,
		expires: Date.now() + data.expires_in * 1000 - 300000,
		projectId: validProjectId,
	};
}

export async function loginGoogleGeminiCli(interaction: AuthInteraction): Promise<OAuthCredential> {
	if (interaction.signal?.aborted) throw new Error("Login cancelled");
	const { verifier, challenge } = await generatePKCE();
	const state = randomBytes(32).toString("hex");
	const server = await startCallbackServer(state);
	const manualAbort = new AbortController();
	const onAbort = () => {
		manualAbort.abort();
		server.cancelWait();
	};
	interaction.signal?.addEventListener("abort", onAbort, { once: true });

	try {
		const authParams = new URLSearchParams({
			client_id: CLIENT_ID,
			response_type: "code",
			redirect_uri: server.redirectUri,
			scope: SCOPES.join(" "),
			code_challenge: challenge,
			code_challenge_method: "S256",
			state,
			access_type: "offline",
			prompt: "consent",
		});
		interaction.notify({
			type: "auth_url",
			url: `${AUTH_URL}?${authParams.toString()}`,
			instructions: "Complete Google sign-in in your browser.",
		});

		const manualPromise = interaction.prompt({
			type: "manual_code",
			message: "Complete login in your browser, or paste the authorization code / redirect URL here:",
			placeholder: server.redirectUri,
			signal: manualAbort.signal,
		});
		const winner = await Promise.race([
			server.waitForCode().then((result) => ({ type: "callback" as const, result })),
			manualPromise.then((input) => ({ type: "manual" as const, input })),
		]);
		if (interaction.signal?.aborted) throw new Error("Login cancelled");

		let code: string | undefined;
		if (winner.type === "callback") {
			manualAbort.abort();
			code = winner.result?.code;
		} else {
			server.cancelWait();
			const parsed = parseAuthorizationInput(winner.input);
			if (parsed.state && parsed.state !== state) throw new Error("OAuth state mismatch");
			code = parsed.code;
		}

		if (!code) throw new Error("OAuth login did not return an authorization code");
		interaction.notify({ type: "progress", message: "Exchanging authorization code for tokens..." });
		const tokens = await exchangeCode(code, verifier, server.redirectUri, interaction.signal);
		const projectId = await discoverProject(
			tokens.access,
			(message) => interaction.notify({ type: "progress", message }),
			(prompt) => interaction.prompt({ type: "text", message: prompt.message, placeholder: prompt.placeholder }),
			interaction.signal,
		);
		const email = await getUserEmail(tokens.access, interaction.signal);
		return { type: "oauth", ...tokens, projectId, email } satisfies GeminiCredentials;
	} finally {
		interaction.signal?.removeEventListener("abort", onAbort);
		manualAbort.abort();
		server.cancelWait();
		server.server.close();
	}
}

export const googleGeminiCliOAuth: OAuthAuth = {
	name: "Google AI Pro/Ultra (Gemini CLI)",
	login: loginGoogleGeminiCli,
	async refresh(credential, signal) {
		const { email } = credential as GeminiCredentials;
		const projectId = validateStoredProjectId((credential as GeminiCredentials).projectId);
		const refreshToken = validateStoredRefreshToken(credential.refresh);
		return { ...(await refreshGoogleGeminiCliToken(refreshToken, projectId, signal)), email };
	},
	async toAuth(credential) {
		const projectId = validateStoredProjectId((credential as GeminiCredentials).projectId);
		const accessToken = validateStoredAccessToken(credential.access);
		return {
			apiKey: accessToken,
			headers: { "X-Goog-User-Project": projectId },
		};
	},
};

function validateStoredProjectId(projectId: unknown): string {
	if (typeof projectId !== "string" || !projectId.trim()) {
		throw new Error("Google Gemini CLI OAuth credentials are missing projectId");
	}
	const value = projectId.trim();
	if (isNumericProjectId(value)) {
		throw new Error(`Google Gemini CLI OAuth credentials contain a numeric project number: "${value}"`);
	}
	return value;
}

function validateStoredAccessToken(accessToken: unknown): string {
	if (typeof accessToken !== "string" || !accessToken.trim()) {
		throw new Error("Google Gemini CLI OAuth credentials are missing an access token");
	}
	return accessToken;
}

function validateStoredRefreshToken(refreshToken: unknown): string {
	if (typeof refreshToken !== "string" || !refreshToken.trim()) {
		throw new Error("Google Gemini CLI OAuth credentials are missing a refresh token");
	}
	return refreshToken;
}

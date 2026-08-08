import { Buffer } from "node:buffer";
import { readStoredCredential } from "./auth-storage.ts";

export const OPENAI_CODEX_PROVIDER = "openai-codex";

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const OPENAI_AUTH_CLAIM = "https://api.openai.com/auth";
const WEEK_SECONDS = 7 * 24 * 60 * 60;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function getWindowSeconds(window: JsonObject): number | undefined {
	const seconds = asFiniteNumber(window.limit_window_seconds);
	if (seconds !== undefined) return seconds;
	const minutes = asFiniteNumber(window.window_minutes);
	return minutes === undefined ? undefined : minutes * 60;
}

/** Parse the main Codex account's weekly percentage remaining from the usage response. */
export function parseCodexWeeklyRemainingPercent(payload: unknown): number | null {
	const rateLimit = asObject(asObject(payload)?.rate_limit);
	if (!rateLimit) return null;

	for (const key of ["primary_window", "secondary_window"] as const) {
		const window = asObject(rateLimit[key]);
		if (!window) continue;
		const windowSeconds = getWindowSeconds(window);
		if (windowSeconds === undefined || Math.abs(windowSeconds - WEEK_SECONDS) > 60) continue;
		const usedPercent = asFiniteNumber(window.used_percent);
		if (usedPercent === undefined) return null;
		return Math.max(0, Math.min(100, 100 - usedPercent));
	}

	return null;
}

function getAccountId(accessToken: string): string {
	try {
		const payloadSegment = accessToken.split(".")[1];
		if (!payloadSegment) throw new Error("missing JWT payload");
		const payload = asObject(JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8")));
		const auth = asObject(payload?.[OPENAI_AUTH_CLAIM]);
		const accountId = auth?.chatgpt_account_id;
		if (typeof accountId !== "string" || accountId.length === 0) throw new Error("missing account ID");
		return accountId;
	} catch {
		throw new Error("Could not read the ChatGPT account ID from the OpenAI Codex OAuth token");
	}
}

/** Fetch the main Codex account's weekly percentage remaining. */
export async function fetchCodexWeeklyRemainingPercent(
	accessToken: string,
	fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
	const response = await fetchImpl(CODEX_USAGE_URL, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"ChatGPT-Account-Id": getAccountId(accessToken),
			Accept: "application/json",
			"User-Agent": "dot",
		},
	});
	if (!response.ok) {
		throw new Error(`OpenAI Codex usage request failed (${response.status})`);
	}
	return parseCodexWeeklyRemainingPercent(await response.json());
}

/** Fetch weekly usage from the OpenAI Codex credential in the default auth store. */
export async function fetchStoredCodexWeeklyRemainingPercent(): Promise<number | null> {
	if (process.env.DOT_OFFLINE === "1") return null;
	const credential = readStoredCredential(OPENAI_CODEX_PROVIDER);
	if (credential?.type !== "oauth" || !credential.access) return null;
	return fetchCodexWeeklyRemainingPercent(credential.access);
}

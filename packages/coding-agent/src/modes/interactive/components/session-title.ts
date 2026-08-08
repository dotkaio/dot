import { basename } from "node:path";
import type { SessionInfo } from "../../../core/session-manager.ts";

const GENERATED_SESSION_TITLE_MAX_LENGTH = 60;
const MIN_TITLE_WORDS = 3;
const MAX_TITLE_WORDS = 5;
const FALLBACK_TITLE = "Untitled session";
const RECENT_USER_PROMPT_LIMIT = 4;
const RECENT_ASSISTANT_PROMPT_LIMIT = 2;

const QUESTION_STARTERS = new Set([
	"who",
	"what",
	"when",
	"where",
	"why",
	"how",
	"is",
	"are",
	"can",
	"could",
	"should",
	"would",
	"do",
	"does",
	"did",
	"will",
]);

const FILLER_WORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"by",
	"can",
	"could",
	"did",
	"do",
	"does",
	"don",
	"dont",
	"for",
	"from",
	"had",
	"has",
	"have",
	"in",
	"instead",
	"into",
	"is",
	"it",
	"its",
	"just",
	"me",
	"my",
	"no",
	"not",
	"now",
	"of",
	"on",
	"or",
	"other",
	"our",
	"please",
	"so",
	"such",
	"that",
	"the",
	"then",
	"these",
	"this",
	"those",
	"to",
	"under",
	"was",
	"we",
	"were",
	"with",
	"would",
	"you",
	"your",
]);

const GENERIC_WORDS = new Set([
	"all",
	"already",
	"any",
	"anything",
	"app",
	"assistant",
	"chatgpt",
	"chat",
	"conversation",
	"dumb",
	"function",
	"help",
	"internet",
	"like",
	"look",
	"method",
	"need",
	"openai",
	"point",
	"right",
	"same",
	"say",
	"session",
	"sounds",
	"still",
	"stuff",
	"system",
	"thing",
	"try",
	"use",
	"using",
	"user",
	"wanna",
	"want",
	"whatever",
	"whole",
]);

const NOISE_MESSAGES = new Set([
	"ok",
	"okay",
	"k",
	"yes",
	"y",
	"no",
	"n",
	"sure",
	"thanks",
	"thank you",
	"thx",
	"cool",
	"fire",
	"nice",
	"go",
	"go on",
	"continue",
	"do it",
	"do ti",
	"yep",
	"yeah",
	"lgtm",
	"ship it",
	"sup",
	"hi",
	"hello",
	"hey",
	"yo",
	"done",
	"next",
	"testing",
	"testing then",
	"then",
	"a",
	"b",
	"c",
	"d",
	"/exit",
	"/quit",
	"/new",
	"/clear",
	"/help",
	"/reload",
	"/name",
]);

export type SessionTitleMessage = {
	role: "user" | "assistant";
	text: string;
};

export type SessionTitleSource = {
	path?: string;
	cwd?: string;
	firstMessage?: string;
	allMessagesText?: string;
	recentUserMessages?: string[];
	messages?: SessionTitleMessage[];
};

function normalizeTitle(text: string): string {
	const normalized = text
		.replace(/[\x00-\x1f\x7f]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/[.!?:;,\-–—]+$/g, "")
		.trim();
	if (normalized.length <= GENERATED_SESSION_TITLE_MAX_LENGTH) return normalized;
	return `${normalized.slice(0, GENERATED_SESSION_TITLE_MAX_LENGTH - 3).trimEnd()}...`;
}

function cleanPrompt(text: string): string {
	return text
		.replace(/^(?:User|Assistant|System):\s*/giu, "")
		.replace(/<skill[^>]*>[\s\S]*?<\/skill>/giu, " ")
		.replace(/<\/?[^>]+>/g, " ")
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
		.replace(/https?:\/\/[^\s]+/g, " ")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/([/~]?[-\w.]+\/)+([-\w.]+)/g, "$2")
		.replace(/[“”]/g, '"')
		.replace(/[‘’]/g, "'")
		.replace(/[_*#>]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function stripRequestPrefix(text: string): string {
	return text
		.replace(/^(?:hey|hi|hello|yo|sup|dude)[,!\s]+/iu, "")
		.replace(/^(?:fire|cool|nice|ok(?:ay)?)[.!,\s]+/iu, "")
		.replace(/^(?:please\s+)?(?:can|could|would)\s+you\s+/iu, "")
		.replace(
			/^(?:please\s+)?(?:help\s+me\s+|i\s+need\s+(?:you\s+)?to\s+|i\s+want\s+(?:you\s+)?to\s+|let'?s\s+|we\s+need\s+to\s+)/iu,
			"",
		)
		.replace(/^(?:tell|explain|show)\s+(?:me\s+)?(?:about\s+)?/iu, "")
		.replace(/^(?:continue working toward|keep working on|work on)\s+/iu, "")
		.replace(/^(?:no[.!,]?\s+)?instead[,\s]+(?:use\s+)?/iu, "")
		.replace(/^(?:now\s+(?:just\s+)?|then\s+)/iu, "")
		.replace(/^(?:ok(?:ay)?,?\s+)?so(?:,|\s)+/iu, "")
		.replace(/^before anything[,\s]+/iu, "")
		.trim();
}

function firstSentence(text: string): string {
	const match = text.match(/^(.{8,160}?[.!?])(?:\s|$)/u);
	return normalizeTitle(match?.[1] ?? text.slice(0, 160));
}

function titleCaseWord(word: string): string {
	if (/^[A-Z0-9]{2,}$/u.test(word)) return word;
	if (/^[a-z]+(?:\.[a-z]+)+$/iu.test(word)) return word;
	return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function titleCase(text: string): string {
	return text.split(/\s+/u).filter(Boolean).map(titleCaseWord).join(" ");
}

function wordKey(word: string): string {
	return word
		.toLowerCase()
		.replace(/(?:ing|ed|es|s)$/u, "")
		.replace(/e$/u, "");
}

function isNoiseMessage(text: string): boolean {
	const cleaned = cleanPrompt(text).toLowerCase();
	if (!cleaned) return true;
	if (NOISE_MESSAGES.has(cleaned)) return true;
	if (/^\/\w+(?:\s+\S+)?$/u.test(cleaned) && cleaned.length < 24) return true;
	if (/^[a-z]$/u.test(cleaned)) return true;
	if (cleaned.length < 3) return true;
	// Pure confirmations / short acknowledgements.
	if (
		/^(?:ok(?:ay)?|sure|yes|yep|yeah|nope|thanks|thank you|cool|fire|nice|do it|go(?: on)?|continue)[.!]*$/iu.test(
			cleaned,
		)
	) {
		return true;
	}
	return false;
}

function scoreUserMessage(text: string): number {
	const cleaned = stripRequestPrefix(cleanPrompt(text));
	if (!cleaned || isNoiseMessage(cleaned)) return -1;

	const words = tokenize(cleaned).filter((word) => {
		const lower = word.toLowerCase();
		return word.length >= 2 && !FILLER_WORDS.has(lower) && !GENERIC_WORDS.has(lower);
	});
	if (words.length === 0) return -1;

	let score = Math.min(words.length, 8) * 3 + Math.min(cleaned.length, 120) / 20;
	// Prefer actionable task language.
	if (
		/(?:fix|make|build|add|rename|improve|install|setup|configure|debug|analyze|stop|remove|create|copy|save|fill|compose|send|mirror|merge)/iu.test(
			cleaned,
		)
	) {
		score += 4;
	}
	// Prefer questions that carry substance.
	if (/^(?:who|what|when|where|why|how)\b/iu.test(cleaned) && words.length >= 3) {
		score += 2;
	}
	// Penalize shell dumps / path-only blobs / tree listings.
	if (
		/^[~/].{0,40}$/u.test(cleaned) ||
		/(?:^|\s)(?:ls|pwd|cd)\b/iu.test(cleaned) ||
		/├──|└──|\.cups|\.npm|\.nvm|\.pnpm-store|\d+\s+~\s*→/u.test(cleaned)
	) {
		score -= 20;
	}
	// Penalize pure contact data or short acknowledgements that slipped through.
	if (/(?:phone number|address:|apt\s+\d+)/iu.test(cleaned) && words.length < 8) {
		score -= 4;
	}
	return score;
}

function tokenize(text: string): string[] {
	return text
		.replace(/[^\p{L}\p{N}.+-]+/gu, " ")
		.split(/\s+/u)
		.map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
		.filter(Boolean);
}

function keywordTitle(text: string, options?: { minWords?: number; maxWords?: number }): string {
	const minWords = options?.minWords ?? MIN_TITLE_WORDS;
	const maxWords = options?.maxWords ?? MAX_TITLE_WORDS;
	const words = tokenize(text);

	const titleWords: string[] = [];
	const seen = new Set<string>();
	for (const word of words) {
		const lower = word.toLowerCase();
		if (word.length < 2 || /^\d+$/u.test(word) || FILLER_WORDS.has(lower) || GENERIC_WORDS.has(lower)) continue;

		const key = wordKey(word);
		if (seen.has(key)) continue;
		seen.add(key);
		titleWords.push(titleCaseWord(word));
		if (titleWords.length >= maxWords) break;
	}

	if (titleWords.length < minWords) {
		for (const word of words) {
			const lower = word.toLowerCase();
			if (word.length < 2 || /^\d+$/u.test(word) || FILLER_WORDS.has(lower)) continue;
			const key = wordKey(word);
			if (seen.has(key)) continue;
			seen.add(key);
			titleWords.push(titleCaseWord(word));
			if (titleWords.length >= minWords) break;
		}
	}

	return normalizeTitle(titleWords.slice(0, maxWords).join(" "));
}

function parseRolePrefixedMessages(text: string): SessionTitleMessage[] {
	const messages: SessionTitleMessage[] = [];
	const pattern = /(?:^|\s)(User|Assistant|System):\s*/giu;
	const matches = [...text.matchAll(pattern)];
	if (matches.length === 0) return messages;

	for (let i = 0; i < matches.length; i++) {
		const match = matches[i]!;
		const roleRaw = match[1]!.toLowerCase();
		if (roleRaw !== "user" && roleRaw !== "assistant") continue;
		const start = (match.index ?? 0) + match[0].length;
		const end = i + 1 < matches.length ? (matches[i + 1]!.index ?? text.length) : text.length;
		const body = text.slice(start, end).trim();
		if (!body) continue;
		messages.push({ role: roleRaw, text: body });
	}

	return messages;
}

function fallbackMessagesFromSource(source: SessionTitleSource): SessionTitleMessage[] {
	if (source.messages && source.messages.length > 0) {
		return source.messages
			.map((message) => ({
				role: message.role,
				text: message.text.trim(),
			}))
			.filter((message) => message.text.length > 0);
	}

	if (source.recentUserMessages && source.recentUserMessages.length > 0) {
		return source.recentUserMessages
			.map((text) => text.trim())
			.filter(Boolean)
			.map((text) => ({ role: "user" as const, text }));
	}

	const fromPrefixed = source.allMessagesText ? parseRolePrefixedMessages(source.allMessagesText) : [];
	if (fromPrefixed.length > 0) return fromPrefixed;

	const messages: SessionTitleMessage[] = [];
	if (source.firstMessage && source.firstMessage !== "(no messages)") {
		messages.push({ role: "user", text: source.firstMessage });
	}

	if (source.allMessagesText && source.allMessagesText !== "(no messages)") {
		const remaining = source.firstMessage
			? source.allMessagesText.replace(source.firstMessage, "").trim()
			: source.allMessagesText.trim();
		if (remaining) {
			// Older session summaries may only expose a concatenated blob. Prefer the end of it for topic drift.
			const chunks = remaining
				.split(/(?<=[.!?])\s+|\n+/u)
				.map((chunk) => chunk.trim())
				.filter(Boolean);
			for (const chunk of chunks.slice(-RECENT_USER_PROMPT_LIMIT)) {
				messages.push({ role: "user", text: chunk });
			}
		}
	}

	return messages;
}

function selectTopicText(messages: SessionTitleMessage[]): string {
	const userCandidates = messages
		.filter((message) => message.role === "user")
		.map((message) => ({
			raw: message.text,
			cleaned: stripRequestPrefix(cleanPrompt(message.text)),
			score: scoreUserMessage(message.text),
		}))
		.filter((candidate) => candidate.cleaned && candidate.score >= 0);

	// Prefer the best of the most recent user turns so titles track topic drift without latching onto "ok/fire".
	const recentUsers = userCandidates.slice(-RECENT_USER_PROMPT_LIMIT);
	if (recentUsers.length > 0) {
		// Recency bias: later messages win ties.
		let best = recentUsers[0]!;
		for (let i = 1; i < recentUsers.length; i++) {
			const candidate = recentUsers[i]!;
			const recencyBoost = i * 0.35;
			if (candidate.score + recencyBoost >= best.score) best = candidate;
		}
		return best.cleaned;
	}

	const assistants = messages
		.filter((message) => message.role === "assistant" && !isNoiseMessage(message.text))
		.map((message) => stripRequestPrefix(cleanPrompt(message.text)))
		.filter(Boolean);

	const recentAssistants = assistants.slice(-RECENT_ASSISTANT_PROMPT_LIMIT);
	if (recentAssistants.length > 0) {
		return recentAssistants.join(". ");
	}

	const anyUseful = messages
		.map((message) => stripRequestPrefix(cleanPrompt(message.text)))
		.filter((text) => text && !isNoiseMessage(text));
	return anyUseful.at(-1) ?? "";
}

function compactPhraseTitle(text: string): string {
	const words = tokenize(stripRequestPrefix(cleanPrompt(text)))
		.filter((word) => {
			const lower = word.toLowerCase();
			return word.length >= 2 && !FILLER_WORDS.has(lower);
		})
		.slice(0, MAX_TITLE_WORDS)
		.map(titleCaseWord);
	return normalizeTitle(words.join(" "));
}

function enforceWordCount(title: string, fallbackText: string): string {
	const words = title.split(/\s+/u).filter(Boolean);
	if (words.length >= MIN_TITLE_WORDS && words.length <= MAX_TITLE_WORDS) {
		return normalizeTitle(words.join(" "));
	}

	if (words.length > MAX_TITLE_WORDS) {
		return normalizeTitle(words.slice(0, MAX_TITLE_WORDS).join(" "));
	}

	const fromKeywords = keywordTitle(fallbackText, { minWords: MIN_TITLE_WORDS, maxWords: MAX_TITLE_WORDS });
	if (fromKeywords && fromKeywords.split(/\s+/u).filter(Boolean).length >= MIN_TITLE_WORDS) {
		return fromKeywords;
	}

	const phrase = compactPhraseTitle(fallbackText);
	if (phrase.split(/\s+/u).filter(Boolean).length >= Math.min(MIN_TITLE_WORDS, 2)) {
		return phrase;
	}

	return normalizeTitle(title || phrase);
}

export function generateSessionTitleFromSource(source: SessionTitleSource): string {
	const fallbackPath = normalizeTitle(basename(source.cwd || source.path || "")) || FALLBACK_TITLE;
	const messages = fallbackMessagesFromSource(source);
	const topicText = selectTopicText(messages);

	if (!topicText) {
		if (source.firstMessage && source.firstMessage !== "(no messages)") {
			const cleaned = stripRequestPrefix(cleanPrompt(source.firstMessage));
			return enforceWordCount(keywordTitle(cleaned) || titleCase(firstSentence(cleaned)), cleaned) || fallbackPath;
		}
		return fallbackPath;
	}

	const sentence = firstSentence(topicText);
	const firstWord = sentence.split(/\s+/u)[0]?.toLowerCase();
	const questionWords = sentence.split(/\s+/u).filter(Boolean);

	// Keep short, punchy questions as titles. Longer ones become keyword titles.
	if (firstWord && QUESTION_STARTERS.has(firstWord) && questionWords.length >= 2 && questionWords.length <= 8) {
		let kept = [...questionWords];
		if (kept.length > MAX_TITLE_WORDS) {
			// Drop middle filler first so we keep the question stem and the object.
			const droppable = new Set([...FILLER_WORDS, "i", "i'm", "im"]);
			const stem = kept[0]!;
			const rest = kept.slice(1).filter((word) => !droppable.has(word.toLowerCase()));
			kept = [stem, ...rest].slice(0, MAX_TITLE_WORDS);
		}
		const questionTitle = normalizeTitle(titleCase(kept.join(" ")));
		if (questionTitle) return questionTitle;
	}

	const keywords = keywordTitle(topicText);
	const title = enforceWordCount(keywords || titleCase(sentence), topicText);
	return title || fallbackPath;
}

export function generateSessionTitle(session: SessionInfo | SessionTitleSource): string {
	return generateSessionTitleFromSource(session);
}

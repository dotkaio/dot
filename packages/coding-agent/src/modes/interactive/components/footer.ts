import { isAbsolute, relative, resolve, sep } from "node:path";
import { type Component, truncateToWidth, visibleWidth } from "@dotkaio/dot-tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import { OPENAI_CODEX_PROVIDER } from "../../../core/codex-usage.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import { isVercelAiGatewayProvider } from "../../../core/provider-spend.ts";
import { theme } from "../theme/theme.ts";
import { INTERACTIVE_HORIZONTAL_MARGIN } from "./layout.ts";

/**
 * Format token counts for compact display.
 * Kept for call sites outside the simplified footer.
 */
export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

/** Format USD amounts as `$0.00`. */
export function formatCost(cost: number): string {
	return `$${Math.max(0, cost).toFixed(2)}`;
}

/** Format remaining AI Gateway balance, or `$--` when unknown. */
export function formatRemainingBalance(balance: number | null | undefined): string {
	if (balance === null || balance === undefined || Number.isNaN(balance)) return "$--";
	return formatCost(balance);
}

/** Format context usage as a percentage only, e.g. `12%` or `?%`. */
export function formatContextPercent(percent: number | null | undefined): string {
	if (percent === null || percent === undefined || Number.isNaN(percent)) return "?%";
	const clamped = Math.max(0, Math.min(100, percent));
	return `${Math.round(clamped)}%`;
}

export function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;

	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));

	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

/**
 * Single-row footer under the editor:
 * left: `$34.89 • 31% • 12% • $0.12` (total/balance • Codex weekly remaining when active • context used • session cost)
 * right: `provider • unqualified-model • thinking`
 */
export class FooterComponent implements Component {
	private session: AgentSession;
	private footerData: ReadonlyFooterDataProvider;

	constructor(session: AgentSession, footerData: ReadonlyFooterDataProvider) {
		this.session = session;
		this.footerData = footerData;
	}

	setSession(session: AgentSession): void {
		this.session = session;
	}

	setAutoCompactEnabled(_enabled: boolean): void {
		// Simplified footer no longer surfaces auto-compact text; kept for call-site compatibility.
	}

	/**
	 * No-op: git branch caching now handled by provider.
	 * Kept for compatibility with existing call sites in interactive-mode.
	 */
	invalidate(): void {
		// No-op: git branch is cached/invalidated by provider
	}

	/**
	 * Clean up resources.
	 * Git watcher cleanup now handled by provider.
	 */
	dispose(): void {
		// Git watcher cleanup handled by provider
	}

	render(width: number): string[] {
		const maxMarginX = Math.max(0, Math.floor((width - 1) / 2));
		const marginX = Math.min(INTERACTIVE_HORIZONTAL_MARGIN, maxMarginX);
		const contentWidth = Math.max(1, width - marginX * 2);
		const outerPadding = " ".repeat(marginX);
		const state = this.session.state;

		// Context percent is model-relative via getContextUsage(); render as % only.
		const contextUsage = this.session.getContextUsage();
		const contextPercentValue = contextUsage?.percent ?? null;
		const provider = state.model?.provider;
		const moneyText = isVercelAiGatewayProvider(provider)
			? formatRemainingBalance(this.footerData.getAiGatewayBalance())
			: formatCost(this.footerData.getProviderSpend(provider ?? ""));
		const weeklyLimitText =
			provider === OPENAI_CODEX_PROVIDER ? this.footerData.getCodexWeeklyRemainingPercent() : null;
		const contextText = formatContextPercent(contextPercentValue);

		// Colorize context percentage based on usage.
		let contextColored = contextText;
		if (contextPercentValue !== null && contextPercentValue > 90) {
			contextColored = theme.fg("error", contextText);
		} else if (contextPercentValue !== null && contextPercentValue > 70) {
			contextColored = theme.fg("warning", contextText);
		}

		const sessionCostText = formatCost(this.session.getSessionStats().cost);

		const leftParts = [moneyText];
		if (weeklyLimitText !== null) leftParts.push(formatContextPercent(weeklyLimitText));
		leftParts.push(contextColored);
		leftParts.push(sessionCostText);
		let left = leftParts.join(" • ");
		let leftWidth = visibleWidth(left);
		if (leftWidth > contentWidth) {
			left = truncateToWidth(left, contentWidth, "...");
			leftWidth = visibleWidth(left);
		}

		const providerName = isVercelAiGatewayProvider(provider) ? "vercel" : provider || "no-provider";
		const modelName = state.model?.id.split("/").at(-1) || "no-model";
		const thinkingLevel = state.thinkingLevel || "off";
		const right = `${providerName} • ${modelName} • ${thinkingLevel}`;

		const minPadding = 2;
		const rightWidth = visibleWidth(right);
		const totalNeeded = leftWidth + minPadding + rightWidth;

		let line: string;
		if (totalNeeded <= contentWidth) {
			const padding = " ".repeat(contentWidth - leftWidth - rightWidth);
			line = left + padding + right;
		} else {
			const availableForRight = contentWidth - leftWidth - minPadding;
			if (availableForRight > 0) {
				const truncatedRight = truncateToWidth(right, availableForRight, "");
				const truncatedRightWidth = visibleWidth(truncatedRight);
				const padding = " ".repeat(Math.max(0, contentWidth - leftWidth - truncatedRightWidth));
				line = left + padding + truncatedRight;
			} else {
				line = left;
			}
		}

		line += " ".repeat(Math.max(0, contentWidth - visibleWidth(line)));

		// Dim left/right independently so colored context % survives.
		const dimLeft = theme.fg("dim", left);
		const remainder = line.slice(left.length);
		const dimRemainder = theme.fg("dim", remainder);
		return [`${outerPadding}${dimLeft}${dimRemainder}${outerPadding}`];
	}
}

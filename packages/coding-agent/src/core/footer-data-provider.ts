import { type ExecFileException, execFile, spawnSync } from "child_process";
import { existsSync, type FSWatcher, readFileSync, type Stats, statSync, unwatchFile, watchFile } from "fs";
import { dirname, join, resolve } from "path";
import { closeWatcher, FS_WATCH_RETRY_DELAY_MS, watchWithErrorHandler } from "../utils/fs-watch.ts";
import { fetchStoredCodexWeeklyRemainingPercent } from "./codex-usage.ts";
import { FileProviderSpendStore, type ProviderSpendStore } from "./provider-spend.ts";

export type GitPaths = {
	repoDir: string;
	commonGitDir: string;
	headPath: string;
};

/**
 * Find git metadata paths by walking up from cwd.
 * Handles both regular git repos (.git is a directory) and worktrees (.git is a file).
 */
export function findGitPaths(cwd: string): GitPaths | null {
	let dir = cwd;
	while (true) {
		const gitPath = join(dir, ".git");
		if (existsSync(gitPath)) {
			try {
				const stat = statSync(gitPath);
				if (stat.isFile()) {
					const content = readFileSync(gitPath, "utf8").trim();
					if (content.startsWith("gitdir: ")) {
						const gitDir = resolve(dir, content.slice(8).trim());
						const headPath = join(gitDir, "HEAD");
						if (!existsSync(headPath)) return null;
						const commonDirPath = join(gitDir, "commondir");
						const commonGitDir = existsSync(commonDirPath)
							? resolve(gitDir, readFileSync(commonDirPath, "utf8").trim())
							: gitDir;
						return { repoDir: dir, commonGitDir, headPath };
					}
				} else if (stat.isDirectory()) {
					const headPath = join(gitPath, "HEAD");
					if (!existsSync(headPath)) return null;
					return { repoDir: dir, commonGitDir: gitPath, headPath };
				}
			} catch {
				return null;
			}
		}
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

/** Ask git for the current branch. Returns null on detached HEAD or if git is unavailable. */
function resolveBranchWithGitSync(repoDir: string): string | null {
	const result = spawnSync("git", ["--no-optional-locks", "symbolic-ref", "--quiet", "--short", "HEAD"], {
		cwd: repoDir,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	const branch = result.status === 0 ? result.stdout.trim() : "";
	return branch || null;
}

/** Ask git for the current branch asynchronously. Returns null on detached HEAD or if git is unavailable. */
function resolveBranchWithGitAsync(repoDir: string): Promise<string | null> {
	return new Promise((resolvePromise) => {
		execFile(
			"git",
			["--no-optional-locks", "symbolic-ref", "--quiet", "--short", "HEAD"],
			{
				cwd: repoDir,
				encoding: "utf8",
			},
			(error: ExecFileException | null, stdout: string) => {
				if (error) {
					resolvePromise(null);
					return;
				}
				const branch = stdout.trim();
				resolvePromise(branch || null);
			},
		);
	});
}

function isWslEnvironment(): boolean {
	return process.platform === "linux" && !!(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);
}

function isWindowsMountedRepoPath(repoDir: string): boolean {
	return /^\/mnt\/[a-z](?:\/|$)/i.test(repoDir);
}

function shouldPollGitHead(repoDir: string): boolean {
	return isWslEnvironment() && isWindowsMountedRepoPath(repoDir);
}

const AI_GATEWAY_CREDITS_URL = "https://ai-gateway.vercel.sh/v1/credits";

export type FooterDataProviderOptions = {
	/** Override lifetime provider-spend store (tests). Defaults to ~/.dot/agent/provider-spend.json. */
	providerSpendStore?: ProviderSpendStore;
	/** Override Codex weekly-limit fetcher (tests). Defaults to the OAuth credential in auth.json. */
	codexWeeklyLimitFetcher?: () => Promise<number | null>;
};

/**
 * Provides git branch, provider balance/spend, Codex weekly usage, and extension statuses - data not otherwise
 * accessible to extensions. Token stats and model info are available via ctx.sessionManager and ctx.model.
 */
export class FooterDataProvider {
	private cwd: string;
	private static readonly WATCH_DEBOUNCE_MS = 500;
	/** Server re-sync interval. Live spend updates are applied optimistically between polls. */
	private static readonly BALANCE_REFRESH_MS = 30_000;
	/** Minimum interval between lazy Codex weekly-limit refreshes. */
	private static readonly CODEX_USAGE_REFRESH_MS = 60_000;
	/** Delayed re-syncs after local spend, so server lag does not leave the footer stale. */
	private static readonly BALANCE_RESYNC_DELAYS_MS = [1_500, 4_000] as const;

	private extensionStatuses = new Map<string, string>();
	private cachedBranch: string | null | undefined = undefined;
	private gitPaths: GitPaths | null | undefined = undefined;
	private headWatcher: FSWatcher | null = null;
	private headWatchFilePath: string | null = null;
	private headWatchFileListener: ((current: Stats, previous: Stats) => void) | null = null;
	private reftableWatcher: FSWatcher | null = null;
	private reftableTablesListWatcher: FSWatcher | null = null;
	private reftableTablesListPath: string | null = null;
	private branchChangeCallbacks = new Set<() => void>();
	private balanceChangeCallbacks = new Set<() => void>();
	private availableProviderCount = 0;
	/** undefined = not loaded yet, null = unavailable */
	private cachedAiGatewayBalance: number | null | undefined = undefined;
	/** undefined = not loaded yet, null = unavailable */
	private cachedCodexWeeklyRemainingPercent: number | null | undefined = undefined;
	/** Spend applied optimistically since the last successful server balance. */
	private localSpendSinceSync = 0;
	private lastCodexWeeklyRefreshAt = 0;
	private codexWeeklyRefreshInFlight = false;
	private refreshTimer: ReturnType<typeof setTimeout> | null = null;
	private gitWatcherRetryTimer: ReturnType<typeof setTimeout> | null = null;
	private balanceRefreshTimer: ReturnType<typeof setInterval> | null = null;
	private balanceResyncTimers: ReturnType<typeof setTimeout>[] = [];
	private balanceRefreshInFlight = false;
	private balanceRefreshPending = false;
	private refreshInFlight = false;
	private refreshPending = false;
	private disposed = false;
	private readonly providerSpendStore: ProviderSpendStore;
	private readonly codexWeeklyLimitFetcher: () => Promise<number | null>;

	constructor(cwd: string, options?: FooterDataProviderOptions) {
		this.cwd = cwd;
		this.providerSpendStore = options?.providerSpendStore ?? new FileProviderSpendStore();
		this.codexWeeklyLimitFetcher = options?.codexWeeklyLimitFetcher ?? fetchStoredCodexWeeklyRemainingPercent;
		this.gitPaths = findGitPaths(cwd);
		this.setupGitWatcher();
		void this.refreshAiGatewayBalance();
		this.balanceRefreshTimer = setInterval(() => {
			void this.refreshAiGatewayBalance();
		}, FooterDataProvider.BALANCE_REFRESH_MS);
		// Allow process exit without waiting on the poller.
		this.balanceRefreshTimer.unref?.();
	}

	/** Current git branch, null if not in repo, "detached" if detached HEAD */
	getGitBranch(): string | null {
		if (this.cachedBranch === undefined) {
			this.cachedBranch = this.resolveGitBranchSync();
		}
		return this.cachedBranch;
	}

	/** Remaining Vercel AI Gateway credit balance in USD, or null if unknown. */
	getAiGatewayBalance(): number | null {
		if (this.cachedAiGatewayBalance === undefined || this.cachedAiGatewayBalance === null) {
			return this.cachedAiGatewayBalance ?? null;
		}
		return Math.max(0, this.cachedAiGatewayBalance - this.localSpendSinceSync);
	}

	/** Codex weekly subscription percentage remaining, or null while unavailable. Refreshes lazily. */
	getCodexWeeklyRemainingPercent(): number | null {
		if (
			!this.disposed &&
			!this.codexWeeklyRefreshInFlight &&
			Date.now() - this.lastCodexWeeklyRefreshAt >= FooterDataProvider.CODEX_USAGE_REFRESH_MS
		) {
			void this.refreshCodexWeeklyLimit();
		}
		return this.cachedCodexWeeklyRemainingPercent ?? null;
	}

	/** Lifetime USD spent on a non-Vercel provider since first tracked use. Never resets. */
	getProviderSpend(provider: string): number {
		return this.providerSpendStore.getTotal(provider);
	}

	/**
	 * Permanently add spend for a non-Vercel provider and notify footer listeners.
	 * Totals only increase and survive restarts.
	 */
	addProviderSpend(provider: string, amount: number): void {
		if (this.disposed || !provider || !Number.isFinite(amount) || amount <= 0) return;
		const previous = this.providerSpendStore.getTotal(provider);
		const next = this.providerSpendStore.addSpend(provider, amount);
		if (next !== previous) {
			this.notifyBalanceChange();
		}
	}

	/** Extension status texts set via ctx.ui.setStatus() */
	getExtensionStatuses(): ReadonlyMap<string, string> {
		return this.extensionStatuses;
	}

	/** Subscribe to git branch changes. Returns unsubscribe function. */
	onBranchChange(callback: () => void): () => void {
		this.branchChangeCallbacks.add(callback);
		return () => this.branchChangeCallbacks.delete(callback);
	}

	/** Subscribe to provider balance, spend, and Codex weekly-limit changes. Returns unsubscribe function. */
	onBalanceChange(callback: () => void): () => void {
		this.balanceChangeCallbacks.add(callback);
		return () => this.balanceChangeCallbacks.delete(callback);
	}

	/** Internal: set extension status */
	setExtensionStatus(key: string, text: string | undefined): void {
		if (text === undefined) {
			this.extensionStatuses.delete(key);
		} else {
			this.extensionStatuses.set(key, text);
		}
	}

	/** Internal: clear extension statuses */
	clearExtensionStatuses(): void {
		this.extensionStatuses.clear();
	}

	/** Number of unique providers with available models (for footer display) */
	getAvailableProviderCount(): number {
		return this.availableProviderCount;
	}

	/** Internal: update available provider count */
	setAvailableProviderCount(count: number): void {
		this.availableProviderCount = count;
	}

	/**
	 * Immediately reduce the displayed remaining balance after a known spend.
	 * Used for real-time footer updates while the credits API catches up.
	 */
	applyLocalSpend(amount: number): void {
		if (this.disposed || !Number.isFinite(amount) || amount <= 0) return;
		if (this.cachedAiGatewayBalance === undefined || this.cachedAiGatewayBalance === null) return;

		const previousDisplay = this.getAiGatewayBalance();
		this.localSpendSinceSync += amount;
		const nextDisplay = this.getAiGatewayBalance();
		if (previousDisplay !== nextDisplay) {
			this.notifyBalanceChange();
		}
	}

	/** Refresh remaining AI Gateway balance from Vercel. Safe to call often. */
	async refreshAiGatewayBalance(): Promise<void> {
		if (this.disposed) return;
		if (this.balanceRefreshInFlight) {
			this.balanceRefreshPending = true;
			return;
		}
		this.balanceRefreshInFlight = true;
		try {
			const apiKey = process.env.AI_GATEWAY_API_KEY?.trim();
			if (!apiKey) {
				this.setAiGatewayBalanceFromApi(null);
				return;
			}

			const response = await fetch(AI_GATEWAY_CREDITS_URL, {
				headers: {
					Authorization: `Bearer ${apiKey}`,
					Accept: "application/json",
				},
			});
			if (!response.ok) {
				// Keep last known balance on transient failures after first success.
				if (this.cachedAiGatewayBalance === undefined) {
					this.setAiGatewayBalanceFromApi(null);
				}
				return;
			}

			const data = (await response.json()) as { balance?: string | number };
			const parsed = typeof data.balance === "number" ? data.balance : Number.parseFloat(String(data.balance ?? ""));
			if (!Number.isFinite(parsed)) {
				if (this.cachedAiGatewayBalance === undefined) {
					this.setAiGatewayBalanceFromApi(null);
				}
				return;
			}
			this.setAiGatewayBalanceFromApi(parsed);
		} catch {
			if (this.cachedAiGatewayBalance === undefined) {
				this.setAiGatewayBalanceFromApi(null);
			}
		} finally {
			this.balanceRefreshInFlight = false;
			if (this.balanceRefreshPending && !this.disposed) {
				this.balanceRefreshPending = false;
				void this.refreshAiGatewayBalance();
			}
		}
	}

	/** Refresh the cached Codex weekly percentage. Keeps the last success across transient failures. */
	async refreshCodexWeeklyLimit(): Promise<void> {
		if (this.disposed || this.codexWeeklyRefreshInFlight) return;
		this.codexWeeklyRefreshInFlight = true;
		this.lastCodexWeeklyRefreshAt = Date.now();
		try {
			const percent = await this.codexWeeklyLimitFetcher();
			if (!this.disposed) this.setCodexWeeklyRemainingPercent(percent);
		} catch {
			if (this.cachedCodexWeeklyRemainingPercent === undefined) {
				this.setCodexWeeklyRemainingPercent(null);
			}
		} finally {
			this.codexWeeklyRefreshInFlight = false;
		}
	}

	/** After a spend, re-sync immediately and again shortly after for API lag. */
	scheduleBalanceResyncAfterSpend(): void {
		if (this.disposed) return;
		void this.refreshAiGatewayBalance();
		for (const delayMs of FooterDataProvider.BALANCE_RESYNC_DELAYS_MS) {
			const timer = setTimeout(() => {
				this.balanceResyncTimers = this.balanceResyncTimers.filter((t) => t !== timer);
				if (!this.disposed) {
					void this.refreshAiGatewayBalance();
				}
			}, delayMs);
			timer.unref?.();
			this.balanceResyncTimers.push(timer);
		}
	}

	setCwd(cwd: string): void {
		if (this.cwd === cwd) {
			return;
		}

		this.cwd = cwd;
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.clearGitWatchers();
		this.cachedBranch = undefined;
		this.gitPaths = findGitPaths(cwd);
		this.setupGitWatcher();
		this.notifyBranchChange();
	}

	/** Internal: cleanup */
	dispose(): void {
		this.disposed = true;
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		if (this.balanceRefreshTimer) {
			clearInterval(this.balanceRefreshTimer);
			this.balanceRefreshTimer = null;
		}
		for (const timer of this.balanceResyncTimers) {
			clearTimeout(timer);
		}
		this.balanceResyncTimers = [];
		this.clearGitWatchers();
		this.branchChangeCallbacks.clear();
		this.balanceChangeCallbacks.clear();
	}

	private setAiGatewayBalanceFromApi(balance: number | null): void {
		const previousDisplay = this.getAiGatewayBalance();
		this.cachedAiGatewayBalance = balance;

		if (balance === null) {
			this.localSpendSinceSync = 0;
		} else if (previousDisplay !== null && balance > previousDisplay) {
			// Credits API can lag behind just-completed spend. Keep the lower optimistic remaining.
			this.localSpendSinceSync = balance - previousDisplay;
		} else {
			this.localSpendSinceSync = 0;
		}

		const nextDisplay = this.getAiGatewayBalance();
		if (previousDisplay !== nextDisplay) {
			this.notifyBalanceChange();
		}
	}

	private setCodexWeeklyRemainingPercent(percent: number | null): void {
		const normalized = percent === null || !Number.isFinite(percent) ? null : Math.max(0, Math.min(100, percent));
		const previous = this.cachedCodexWeeklyRemainingPercent ?? null;
		this.cachedCodexWeeklyRemainingPercent = normalized;
		if (previous !== normalized) this.notifyBalanceChange();
	}

	private notifyBranchChange(): void {
		for (const cb of this.branchChangeCallbacks) cb();
	}

	private notifyBalanceChange(): void {
		for (const cb of this.balanceChangeCallbacks) cb();
	}

	private scheduleRefresh(): void {
		if (this.disposed || this.refreshTimer) return;
		if (this.refreshInFlight) {
			this.refreshPending = true;
			return;
		}
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = null;
			void this.refreshGitBranchAsync();
		}, FooterDataProvider.WATCH_DEBOUNCE_MS);
	}

	private async refreshGitBranchAsync(): Promise<void> {
		if (this.disposed) return;
		if (this.refreshInFlight) {
			this.refreshPending = true;
			return;
		}

		this.refreshInFlight = true;
		try {
			const nextBranch = await this.resolveGitBranchAsync();
			if (this.disposed) return;
			if (this.cachedBranch !== undefined && this.cachedBranch !== nextBranch) {
				this.cachedBranch = nextBranch;
				this.notifyBranchChange();
				return;
			}
			this.cachedBranch = nextBranch;
		} finally {
			this.refreshInFlight = false;
			if (this.refreshPending && !this.disposed) {
				this.refreshPending = false;
				this.scheduleRefresh();
			}
		}
	}

	private resolveGitBranchSync(): string | null {
		try {
			if (!this.gitPaths) return null;
			const content = readFileSync(this.gitPaths.headPath, "utf8").trim();
			if (content.startsWith("ref: refs/heads/")) {
				const branch = content.slice(16);
				return branch === ".invalid" ? (resolveBranchWithGitSync(this.gitPaths.repoDir) ?? "detached") : branch;
			}
			return "detached";
		} catch {
			return null;
		}
	}

	private async resolveGitBranchAsync(): Promise<string | null> {
		try {
			if (!this.gitPaths) return null;
			const content = readFileSync(this.gitPaths.headPath, "utf8").trim();
			if (content.startsWith("ref: refs/heads/")) {
				const branch = content.slice(16);
				return branch === ".invalid"
					? ((await resolveBranchWithGitAsync(this.gitPaths.repoDir)) ?? "detached")
					: branch;
			}
			return "detached";
		} catch {
			return null;
		}
	}

	private clearGitWatchers(): void {
		closeWatcher(this.headWatcher);
		this.headWatcher = null;
		if (this.headWatchFilePath && this.headWatchFileListener) {
			unwatchFile(this.headWatchFilePath, this.headWatchFileListener);
			this.headWatchFilePath = null;
			this.headWatchFileListener = null;
		}
		closeWatcher(this.reftableWatcher);
		this.reftableWatcher = null;
		closeWatcher(this.reftableTablesListWatcher);
		this.reftableTablesListWatcher = null;
		if (this.reftableTablesListPath) {
			unwatchFile(this.reftableTablesListPath);
			this.reftableTablesListPath = null;
		}
		if (this.gitWatcherRetryTimer) {
			clearTimeout(this.gitWatcherRetryTimer);
			this.gitWatcherRetryTimer = null;
		}
	}

	private scheduleGitWatcherRetry(): void {
		if (this.disposed || this.gitWatcherRetryTimer) {
			return;
		}

		this.gitWatcherRetryTimer = setTimeout(() => {
			this.gitWatcherRetryTimer = null;
			this.setupGitWatcher();
		}, FS_WATCH_RETRY_DELAY_MS);
	}

	private handleGitWatcherError(): void {
		this.clearGitWatchers();
		this.scheduleGitWatcherRetry();
	}

	private setupGitWatcher(): void {
		this.clearGitWatchers();
		if (!this.gitPaths) return;

		const pollGitHead = shouldPollGitHead(this.gitPaths.repoDir);

		// Watch the directory containing HEAD, not HEAD itself.
		// Git uses atomic writes (write temp, rename over HEAD), which changes the inode.
		// fs.watch on a file stops working after the inode changes.
		this.headWatcher = watchWithErrorHandler(
			dirname(this.gitPaths.headPath),
			(_eventType, filename) => {
				if (!filename || filename === "HEAD") {
					this.scheduleRefresh();
				}
			},
			() => this.handleGitWatcherError(),
		);
		if (pollGitHead) {
			this.headWatchFilePath = this.gitPaths.headPath;
			this.headWatchFileListener = (current, previous) => {
				if (
					current.mtimeMs !== previous.mtimeMs ||
					current.ctimeMs !== previous.ctimeMs ||
					current.size !== previous.size
				) {
					this.scheduleRefresh();
				}
			};
			watchFile(this.headWatchFilePath, { interval: 1000 }, this.headWatchFileListener);
		}
		if (!this.headWatcher && !pollGitHead) {
			return;
		}

		// In reftable repos, branch switches update files in the reftable directory
		// instead of HEAD. Watch it separately so the footer picks up those changes.
		const reftableDir = join(this.gitPaths.commonGitDir, "reftable");
		if (existsSync(reftableDir)) {
			this.reftableWatcher = watchWithErrorHandler(
				reftableDir,
				() => {
					this.scheduleRefresh();
				},
				() => this.handleGitWatcherError(),
			);
			if (!this.reftableWatcher) {
				return;
			}

			const tablesListPath = join(reftableDir, "tables.list");
			if (existsSync(tablesListPath)) {
				this.reftableTablesListPath = tablesListPath;
				this.reftableTablesListWatcher = watchWithErrorHandler(
					tablesListPath,
					() => {
						this.scheduleRefresh();
					},
					() => this.handleGitWatcherError(),
				);
				if (!this.reftableTablesListWatcher) {
					return;
				}
				watchFile(tablesListPath, { interval: 250 }, (current, previous) => {
					if (
						current.mtimeMs !== previous.mtimeMs ||
						current.ctimeMs !== previous.ctimeMs ||
						current.size !== previous.size
					) {
						this.scheduleRefresh();
					}
				});
			}
		}
	}
}

/** Read-only view for extensions - excludes setExtensionStatus, setAvailableProviderCount and dispose */
export type ReadonlyFooterDataProvider = Pick<
	FooterDataProvider,
	| "getGitBranch"
	| "getAiGatewayBalance"
	| "getCodexWeeklyRemainingPercent"
	| "getProviderSpend"
	| "addProviderSpend"
	| "getExtensionStatuses"
	| "getAvailableProviderCount"
	| "onBranchChange"
	| "onBalanceChange"
	| "refreshAiGatewayBalance"
	| "refreshCodexWeeklyLimit"
	| "applyLocalSpend"
	| "scheduleBalanceResyncAfterSpend"
>;

import { type Model, modelsAreEqual } from "@dotkaio/dot-ai";
import {
	Container,
	type Focusable,
	fuzzyFilter,
	getKeybindings,
	Input,
	type MouseWheelDirection,
	Spacer,
	Text,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@dotkaio/dot-tui";
import {
	type ArtificialAnalysisScores,
	emptyArtificialAnalysisScores,
	getArtificialAnalysisIq,
	getCachedModelPickerMetadata,
	getModelMetadataCost,
	getModelPickerMetadata,
	getReleaseDate,
} from "../../../core/model-picker-metadata.ts";
import type { ModelRuntime } from "../../../core/model-runtime.ts";

export {
	ARTIFICIAL_ANALYSIS_CACHE_TTL_MS,
	decryptArtificialAnalysisPayload,
	isArtificialAnalysisCacheFresh,
	parseArtificialAnalysisDataManifests,
	parseArtificialAnalysisScores,
	resolveArtificialAnalysisIqForTest,
} from "../../../core/model-picker-metadata.ts";

import type { SettingsManager } from "../../../core/settings-manager.ts";
import { getModelSelectorSearchText } from "../model-search.ts";
import { highlightSelectedListItem, theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint } from "./keybinding-hints.ts";

interface ModelItem {
	provider: string;
	id: string;
	model: Model<any>;
}

interface ScopedModelItem {
	model: Model<any>;
	thinkingLevel?: string;
}

type ModelScope = "all" | "scoped";
type ModelSortDirection = "ascending" | "descending";
type ModelSortMode = "default" | "model" | "context" | "input" | "output" | "provider" | "iq" | "releaseDate";

const MODEL_SORT_MODES: ModelSortMode[] = [
	"default",
	"model",
	"context",
	"input",
	"output",
	"provider",
	"iq",
	"releaseDate",
];

const MODEL_SORT_DEFAULT_DIRECTIONS: Readonly<Record<Exclude<ModelSortMode, "default">, ModelSortDirection>> = {
	model: "ascending",
	context: "descending",
	input: "ascending",
	output: "ascending",
	provider: "ascending",
	iq: "descending",
	releaseDate: "descending",
};

const MODEL_SORT_LABELS: Record<ModelSortMode, string> = {
	default: "default",
	model: "model",
	context: "context",
	input: "input",
	output: "output",
	provider: "provider",
	iq: "IQ",
	releaseDate: "released",
};

type ModelTableColumn = Exclude<ModelSortMode, "default">;

interface ModelColumnLayout {
	key: ModelTableColumn;
	label: string;
	width: number;
	rightAligned?: boolean;
}

function getModelTableLayout(width: number): ModelColumnLayout[] {
	const available = Math.max(0, width - 2);
	const columns: ModelColumnLayout[] = [
		{ key: "model", label: "Model", width: Math.min(24, Math.floor(width * 0.4)) },
		{ key: "context", label: "Context", width: 9, rightAligned: true },
		{ key: "input", label: "Input", width: 9, rightAligned: true },
		{ key: "output", label: "Output", width: 9, rightAligned: true },
		{ key: "provider", label: "Provider", width: width < 60 ? 12 : 15 },
		{ key: "iq", label: "IQ", width: 6, rightAligned: true },
		{ key: "releaseDate", label: "Released", width: 12 },
	];
	// Preserve model identity and IQ first; omitted values remain in the selection details.
	for (const key of ["releaseDate", "context", "output", "input", "provider", "model"] as const) {
		const required = columns.reduce((total, column) => total + column.width, 0) + (columns.length - 1) * 2;
		if (required <= available) break;
		columns.splice(
			columns.findIndex((column) => column.key === key),
			1,
		);
	}
	const model = columns.find((column) => column.key === "model");
	if (model) {
		model.width =
			available -
			columns.reduce((total, column) => total + (column === model ? 0 : column.width), 0) -
			(columns.length - 1) * 2;
	} else {
		columns[0].width = available;
	}
	return columns;
}

function normalizeMaxVisible(maxVisible: number | undefined, fallback: number): number {
	if (maxVisible === undefined || maxVisible <= 0 || !Number.isFinite(maxVisible)) return fallback;
	return Math.max(1, Math.floor(maxVisible));
}

function formatTableCell(value: string, column: ModelColumnLayout): string {
	const text = truncateToWidth(value, column.width, "…");
	const padding = " ".repeat(Math.max(0, column.width - visibleWidth(text)));
	return column.rightAligned ? padding + text : text + padding;
}

function formatTokenCount(count: number): string {
	if (!Number.isFinite(count) || count <= 0) return "-";
	if (count >= 1_000_000) {
		const millions = count / 1_000_000;
		return millions % 1 === 0 ? `${millions}M` : `${millions.toFixed(1)}M`;
	}
	if (count >= 1_000) {
		const thousands = count / 1_000;
		return thousands % 1 === 0 ? `${thousands}K` : `${thousands.toFixed(1)}K`;
	}
	return count.toString();
}

function formatPrice(price: number): string {
	if (!Number.isFinite(price)) return "-";
	if (price === 0) return "$0/M";
	const digits = price < 0.01 ? 4 : price < 1 ? 3 : 2;
	return `$${price.toFixed(digits).replace(/\.0+$|(?<=\.\d*[1-9])0+$/u, "")}/M`;
}

function formatArtificialAnalysisIq(
	item: ModelItem,
	scores: ArtificialAnalysisScores,
	historicalScores: ArtificialAnalysisScores,
): string {
	const score = getArtificialAnalysisIq(item, scores);
	if (score !== undefined) return Math.round(score).toString();
	const historicalScore = getArtificialAnalysisIq(item, historicalScores);
	return historicalScore === undefined ? "N/A" : `${Math.round(historicalScore)}*`;
}

function formatModelTableRow(
	item: ModelItem,
	columns: readonly ModelColumnLayout[],
	vercelReleaseDates: ReadonlyMap<string, string>,
	vercelCosts: ReadonlyMap<string, Model<any>["cost"]>,
	artificialAnalysisScores: ArtificialAnalysisScores,
	historicalArtificialAnalysisScores: ArtificialAnalysisScores,
): string {
	const cost = getModelMetadataCost(item, vercelCosts);
	const values: Record<ModelTableColumn, string> = {
		model: item.model.name || item.id,
		context: formatTokenCount(item.model.contextWindow),
		input: formatPrice(cost.input),
		output: formatPrice(cost.output),
		provider: item.provider,
		iq: formatArtificialAnalysisIq(item, artificialAnalysisScores, historicalArtificialAnalysisScores),
		releaseDate: getReleaseDate(item, vercelReleaseDates),
	};
	return columns.map((column) => formatTableCell(values[column.key], column)).join("  ");
}

function getSortIndicator(sortMode: ModelSortMode, column: ModelSortMode, direction: ModelSortDirection): string {
	if (sortMode !== column) return "";
	return direction === "ascending" ? " ↑" : " ↓";
}

function formatModelTableHeader(
	columns: readonly ModelColumnLayout[],
	sortMode: ModelSortMode,
	direction: ModelSortDirection,
): string {
	return columns
		.map((column) => formatTableCell(`${column.label}${getSortIndicator(sortMode, column.key, direction)}`, column))
		.join("  ");
}

function compareText(a: string, b: string): number {
	return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function compareModelIdentity(a: ModelItem, b: ModelItem): number {
	return (
		compareText(a.provider, b.provider) ||
		compareText(a.model.name || a.id, b.model.name || b.id) ||
		compareText(a.id, b.id)
	);
}

function compareFiniteNumber(a: number, b: number, direction: "ascending" | "descending"): number {
	const aFinite = Number.isFinite(a);
	const bFinite = Number.isFinite(b);
	if (aFinite && !bFinite) return -1;
	if (!aFinite && bFinite) return 1;
	if (!aFinite && !bFinite) return 0;
	return direction === "ascending" ? a - b : b - a;
}

function getReleaseDateSortValue(item: ModelItem, vercelReleaseDates: ReadonlyMap<string, string>): number {
	const date = getReleaseDate(item, vercelReleaseDates);
	const match = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(date);
	if (!match) return Number.NEGATIVE_INFINITY;
	return Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2]));
}

/**
 * Component that renders a model selector with search
 */
export class ModelSelectorComponent extends Container implements Focusable {
	private searchInput: Input;

	// Focusable implementation - propagate to searchInput for IME cursor positioning
	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}
	private listContainer: Container;
	private allModels: ModelItem[] = [];
	private scopedModelItems: ModelItem[] = [];
	private activeModels: ModelItem[] = [];
	private filteredModels: ModelItem[] = [];
	private selectedIndex: number = 0;
	private currentModel?: Model<any>;
	private settingsManager: SettingsManager;
	private modelRuntime: ModelRuntime;
	private onSelectCallback: (model: Model<any>) => void;
	private onCancelCallback: () => void;
	private errorMessage?: string;
	private refreshStatusMessage = "Refreshing model catalogs…";
	private refreshStatusSuccess = false;
	private tui: TUI;
	private vercelReleaseDates: ReadonlyMap<string, string> = new Map();
	private vercelCosts: ReadonlyMap<string, Model<any>["cost"]> = new Map();
	private artificialAnalysisScores: ArtificialAnalysisScores = emptyArtificialAnalysisScores();
	private historicalArtificialAnalysisScores: ArtificialAnalysisScores = emptyArtificialAnalysisScores();
	private scopedModels: ReadonlyArray<ScopedModelItem>;
	private scope: ModelScope = "all";
	private sortMode: ModelSortMode = "default";
	private sortDirection: ModelSortDirection = "ascending";
	private scopeText?: Text;
	private scopeHintText?: Text;
	private sortHintText?: Text;
	private maxVisible = 10;
	private visibleRows = 10;
	private renderWidth = 120;
	private readonly refreshAbortController = new AbortController();
	private refreshTimeout?: ReturnType<typeof setTimeout>;
	private closed = false;

	constructor(
		tui: TUI,
		currentModel: Model<any> | undefined,
		settingsManager: SettingsManager,
		modelRuntime: ModelRuntime,
		scopedModels: ReadonlyArray<ScopedModelItem>,
		onSelect: (model: Model<any>) => void,
		onCancel: () => void,
		initialSearchInput?: string,
		maxVisible?: number,
	) {
		super();

		this.tui = tui;
		this.currentModel = currentModel;
		this.settingsManager = settingsManager;
		this.modelRuntime = modelRuntime;
		this.scopedModels = scopedModels;
		this.scope = scopedModels.length > 0 ? "scoped" : "all";
		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;
		this.maxVisible = normalizeMaxVisible(maxVisible, 10);
		this.visibleRows = this.maxVisible;

		// Add top border
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		// Add hint about model filtering
		if (scopedModels.length > 0) {
			this.scopeText = new Text(this.getScopeText(), 0, 0);
			this.addChild(this.scopeText);
			this.scopeHintText = new Text(this.getScopeHintText(), 0, 0);
			this.addChild(this.scopeHintText);
		} else {
			const hintText = "Only showing models from configured providers. Use /login to add providers.";
			this.addChild(new Text(theme.fg("warning", hintText), 0, 0));
		}
		this.sortHintText = new Text(this.getSortHintText(), 0, 0);
		this.addChild(this.sortHintText);
		this.addChild(
			new Text(
				theme.fg("muted", "IQ: AA Intelligence Index. * = v4.3 (different scale); N/A = no score available."),
				0,
				0,
			),
		);
		this.addChild(new Spacer(1));

		// Create search input
		this.searchInput = new Input();
		if (initialSearchInput) {
			this.searchInput.setValue(initialSearchInput);
		}
		this.searchInput.onSubmit = () => {
			// Enter on search input selects the first filtered item
			if (this.filteredModels[this.selectedIndex]) {
				this.handleSelect(this.filteredModels[this.selectedIndex].model);
			}
		};
		this.addChild(this.searchInput);

		// Create list container
		this.listContainer = new Container();
		this.addChild(this.listContainer);

		this.addChild(new Spacer(1));

		// Add bottom border
		this.addChild(new DynamicBorder());

		// Render the current snapshot immediately, then refresh catalogs + remote metadata in the background.
		const cachedMetadata = getCachedModelPickerMetadata();
		this.vercelReleaseDates = cachedMetadata.vercelReleaseDates;
		this.vercelCosts = cachedMetadata.vercelCosts;
		this.artificialAnalysisScores = cachedMetadata.artificialAnalysisScores;
		this.historicalArtificialAnalysisScores = cachedMetadata.historicalArtificialAnalysisScores;
		this.loadModelsFromSnapshot();
		if (initialSearchInput) this.filterModels(initialSearchInput);
		else this.updateList();
		this.tui.requestRender();
		void this.refreshModels();
		void this.loadRemoteModelMetadata();
	}

	private loadModelsFromSnapshot(): void {
		const query = this.searchInput.getValue();
		const selectedModel = this.filteredModels[this.selectedIndex]?.model ?? (query ? undefined : this.currentModel);
		const models = this.modelRuntime.getAvailableSnapshot().map((model: Model<any>) => ({
			provider: model.provider,
			id: model.id,
			model,
		}));
		this.allModels = this.sortModels(models);
		this.scopedModels = this.scopedModels.map((scoped) => {
			const refreshed = this.modelRuntime.getModel(scoped.model.provider, scoped.model.id);
			return refreshed ? { ...scoped, model: refreshed } : scoped;
		});
		this.scopedModelItems = this.scopedModels.map((scoped) => ({
			provider: scoped.model.provider,
			id: scoped.model.id,
			model: scoped.model,
		}));
		this.refreshFilteredModels(selectedModel, query);
	}

	private async loadRemoteModelMetadata(): Promise<void> {
		const { vercelReleaseDates, vercelCosts, artificialAnalysisScores, historicalArtificialAnalysisScores } =
			await getModelPickerMetadata();
		if (this.closed) return;
		this.vercelReleaseDates = vercelReleaseDates;
		this.vercelCosts = vercelCosts;
		this.artificialAnalysisScores = artificialAnalysisScores;
		this.historicalArtificialAnalysisScores = historicalArtificialAnalysisScores;
		this.refreshFilteredModels(this.filteredModels[this.selectedIndex]?.model, this.searchInput.getValue());
		this.tui.requestRender();
	}

	private async refreshModels(): Promise<void> {
		const timeoutMs = 15_000;
		let timedOut = false;
		this.refreshTimeout = setTimeout(() => {
			timedOut = true;
			this.refreshAbortController.abort();
		}, timeoutMs);
		try {
			const result = await this.modelRuntime.refresh({ signal: this.refreshAbortController.signal });
			if (this.closed) return;
			this.refreshStatusMessage = "";
			if (result.aborted && timedOut) {
				this.errorMessage = "Model refresh timed out; showing cached models.";
			} else if (result.errors.size === 1) {
				this.errorMessage = `Could not refresh ${result.errors.keys().next().value}; showing cached models.`;
			} else if (result.errors.size > 1) {
				this.errorMessage = `Could not refresh ${result.errors.size} model catalogs; showing cached models.`;
			} else {
				this.errorMessage = this.modelRuntime.getError();
				if (!this.errorMessage) {
					this.refreshStatusMessage = "Model catalogs refreshed.";
					this.refreshStatusSuccess = true;
				}
			}
			this.loadModelsFromSnapshot();
			this.tui.requestRender();
		} finally {
			if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
		}
	}

	private close(): void {
		this.closed = true;
		if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
		this.refreshAbortController.abort();
	}

	private sortModels(models: ModelItem[]): ModelItem[] {
		const sorted = [...models];
		// Sort: current model first, then by provider
		sorted.sort((a, b) => {
			const aIsCurrent = modelsAreEqual(this.currentModel, a.model);
			const bIsCurrent = modelsAreEqual(this.currentModel, b.model);
			if (aIsCurrent && !bIsCurrent) return -1;
			if (!aIsCurrent && bIsCurrent) return 1;
			return a.provider.localeCompare(b.provider);
		});
		return sorted;
	}

	private sortModelsForMode(models: ModelItem[]): ModelItem[] {
		if (this.sortMode === "default") return [...models];

		const sorted = [...models];
		sorted.sort((a, b) => {
			let result = 0;
			const textDirection = this.sortDirection === "ascending" ? 1 : -1;
			switch (this.sortMode) {
				case "model":
					result = compareText(a.model.name || a.id, b.model.name || b.id) * textDirection;
					break;
				case "context":
					result = compareFiniteNumber(a.model.contextWindow, b.model.contextWindow, this.sortDirection);
					break;
				case "input":
					result = compareFiniteNumber(
						getModelMetadataCost(a, this.vercelCosts).input,
						getModelMetadataCost(b, this.vercelCosts).input,
						this.sortDirection,
					);
					break;
				case "output":
					result = compareFiniteNumber(
						getModelMetadataCost(a, this.vercelCosts).output,
						getModelMetadataCost(b, this.vercelCosts).output,
						this.sortDirection,
					);
					break;
				case "provider":
					result = compareText(a.provider, b.provider) * textDirection;
					break;
				case "iq":
					result = compareFiniteNumber(
						getArtificialAnalysisIq(a, this.artificialAnalysisScores) ??
							getArtificialAnalysisIq(a, this.historicalArtificialAnalysisScores) ??
							Number.NEGATIVE_INFINITY,
						getArtificialAnalysisIq(b, this.artificialAnalysisScores) ??
							getArtificialAnalysisIq(b, this.historicalArtificialAnalysisScores) ??
							Number.NEGATIVE_INFINITY,
						this.sortDirection,
					);
					break;
				case "releaseDate":
					result = compareFiniteNumber(
						getReleaseDateSortValue(a, this.vercelReleaseDates),
						getReleaseDateSortValue(b, this.vercelReleaseDates),
						this.sortDirection,
					);
					break;
				case "default":
					break;
			}
			return result || compareModelIdentity(a, b);
		});
		return sorted;
	}

	private getScopeText(): string {
		const allText = this.scope === "all" ? theme.fg("accent", "all") : theme.fg("muted", "all");
		const scopedText = this.scope === "scoped" ? theme.fg("accent", "scoped") : theme.fg("muted", "scoped");
		return `${theme.fg("muted", "Scope: ")}${allText}${theme.fg("muted", " | ")}${scopedText}`;
	}

	private getScopeHintText(): string {
		return keyHint("tui.input.tab", "scope") + theme.fg("muted", " (all/scoped)");
	}

	private getSortHintText(): string {
		const directionHint = this.sortMode === "default" ? "" : ` ${this.sortDirection === "ascending" ? "↑" : "↓"}`;
		return `${keyHint("app.model.sort", "sort")} ${theme.fg("muted", `(${MODEL_SORT_LABELS[this.sortMode]}${directionHint})`)} · ${keyHint("app.model.sortByIq", "IQ")}`;
	}

	private getBaseModels(): ModelItem[] {
		return this.scope === "scoped" ? this.scopedModelItems : this.allModels;
	}

	private refreshFilteredModels(
		selectedModel: Model<any> | undefined,
		query: string,
		options: { resetSelection?: boolean } = {},
	): void {
		this.activeModels = this.sortModelsForMode(this.getBaseModels());
		const fuzzyMatches = query
			? fuzzyFilter(this.activeModels, query, ({ id, provider, model }) =>
					getModelSelectorSearchText({ id, provider, name: model.name }),
				)
			: this.activeModels;
		this.filteredModels = this.sortMode === "default" ? fuzzyMatches : this.sortModelsForMode(fuzzyMatches);

		if (options.resetSelection) {
			this.selectedIndex = 0;
		} else {
			const selectedIndex = selectedModel
				? this.filteredModels.findIndex((item) => modelsAreEqual(selectedModel, item.model))
				: -1;
			this.selectedIndex =
				selectedIndex >= 0
					? selectedIndex
					: Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1));
		}
		this.updateList();
	}

	private setSortMode(sortMode: ModelSortMode): void {
		if (sortMode === "default") {
			this.sortMode = "default";
		} else if (this.sortMode === sortMode) {
			this.sortDirection = this.sortDirection === "ascending" ? "descending" : "ascending";
		} else {
			this.sortMode = sortMode;
			this.sortDirection = MODEL_SORT_DEFAULT_DIRECTIONS[sortMode];
		}

		this.refreshFilteredModels(undefined, this.searchInput.getValue(), { resetSelection: true });
		if (this.sortHintText) {
			this.sortHintText.setText(this.getSortHintText());
		}
	}

	private cycleSortMode(): void {
		const currentIndex = MODEL_SORT_MODES.indexOf(this.sortMode);
		const nextMode = MODEL_SORT_MODES[(currentIndex + 1) % MODEL_SORT_MODES.length] ?? "default";
		this.setSortMode(nextMode);
	}

	private setScope(scope: ModelScope): void {
		if (this.scope === scope) return;
		const selectedModel = this.filteredModels[this.selectedIndex]?.model ?? this.currentModel;
		this.scope = scope;
		this.selectedIndex = 0;
		this.refreshFilteredModels(selectedModel, this.searchInput.getValue());
		if (this.scopeText) {
			this.scopeText.setText(this.getScopeText());
		}
	}

	private filterModels(query: string): void {
		// When filtering by a query, move the selector to the top row so the best
		// match in the chosen sort order is highlighted. Clearing the query keeps
		// the current position clamped to the restored list length.
		this.refreshFilteredModels(undefined, query, { resetSelection: query.length > 0 });
	}

	private updateList(): void {
		this.listContainer.clear();
		const columns = getModelTableLayout(this.renderWidth);
		const prefix = " ".repeat(Math.min(2, this.renderWidth));

		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(this.visibleRows / 2), this.filteredModels.length - this.visibleRows),
		);
		const endIndex = Math.min(startIndex + this.visibleRows, this.filteredModels.length);

		if (this.filteredModels.length > 0) {
			this.listContainer.addChild(
				new Text(
					theme.fg("muted", `${prefix}${formatModelTableHeader(columns, this.sortMode, this.sortDirection)}`),
					0,
					0,
				),
			);
		}

		// Show visible slice of filtered models
		for (let i = startIndex; i < endIndex; i++) {
			const item = this.filteredModels[i];
			if (!item) continue;

			const isSelected = i === this.selectedIndex;
			const line = `${prefix}${formatModelTableRow(
				item,
				columns,
				this.vercelReleaseDates,
				this.vercelCosts,
				this.artificialAnalysisScores,
				this.historicalArtificialAnalysisScores,
			)}`;
			const styledLine = isSelected ? highlightSelectedListItem(line) : line;

			this.listContainer.addChild(new Text(styledLine, 0, 0));
		}

		// Add scroll indicator if needed
		if (startIndex > 0 || endIndex < this.filteredModels.length) {
			const scrollInfo = theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredModels.length})`);
			this.listContainer.addChild(new Text(scrollInfo, 0, 0));
		}

		// Cached rows and their details stay usable when a catalog refresh fails.
		if (this.errorMessage) {
			// Show error in red
			const errorLines = this.errorMessage.split("\n");
			for (const line of errorLines) {
				this.listContainer.addChild(new Text(theme.fg("error", line), 0, 0));
			}
		}
		if (this.filteredModels.length === 0) {
			this.listContainer.addChild(new Text(theme.fg("muted", "  No matching models"), 0, 0));
		} else {
			const selected = this.filteredModels[this.selectedIndex];
			this.listContainer.addChild(new Spacer(1));
			this.listContainer.addChild(
				new Text(theme.fg("muted", `  ${selected.provider}/${selected.id} · ${selected.model.name}`), 0, 0),
			);
			const cost = getModelMetadataCost(selected, this.vercelCosts);
			const details: Partial<Record<ModelTableColumn, string>> = {
				context: `Context ${formatTokenCount(selected.model.contextWindow)}`,
				input: `Input ${formatPrice(cost.input)}`,
				output: `Output ${formatPrice(cost.output)}`,
				releaseDate: `Released ${getReleaseDate(selected, this.vercelReleaseDates)}`,
			};
			for (const column of columns) delete details[column.key];
			const omittedDetails = Object.values(details).join(" · ");
			if (omittedDetails) {
				this.listContainer.addChild(new Text(theme.fg("muted", `  ${omittedDetails}`), 0, 0));
			}
		}
		if (this.refreshStatusMessage) {
			this.listContainer.addChild(
				new Text(theme.fg(this.refreshStatusSuccess ? "success" : "muted", `  ${this.refreshStatusMessage}`), 0, 0),
			);
		}
	}

	render(width: number): string[] {
		this.renderWidth = width;
		this.visibleRows = Math.min(this.maxVisible, Math.max(1, this.filteredModels.length));
		this.updateList();
		let lines = super.render(width);
		const terminalRows = this.tui.terminal?.rows;
		if (terminalRows !== undefined && Number.isFinite(terminalRows)) {
			// Measure wrapped hints and details, leaving room for the surrounding footer.
			const rowBudget = Math.max(1, terminalRows - 2);
			while (lines.length > rowBudget && this.visibleRows > 1) {
				this.visibleRows = Math.max(1, this.visibleRows - (lines.length - rowBudget));
				this.updateList();
				lines = super.render(width);
			}
		}
		return lines;
	}

	handleMouseWheel(direction: MouseWheelDirection, lines: number): boolean {
		if (this.filteredModels.length === 0) return true;
		const delta = direction === "up" ? -lines : lines;
		this.selectedIndex = Math.max(0, Math.min(this.filteredModels.length - 1, this.selectedIndex + delta));
		this.updateList();
		return true;
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.input.tab")) {
			if (this.scopedModelItems.length > 0) {
				const nextScope: ModelScope = this.scope === "all" ? "scoped" : "all";
				this.setScope(nextScope);
				if (this.scopeHintText) {
					this.scopeHintText.setText(this.getScopeHintText());
				}
			}
			return;
		}
		if (kb.matches(keyData, "app.model.sortByModel")) {
			this.setSortMode("model");
			return;
		}
		if (kb.matches(keyData, "app.model.sortByContext")) {
			this.setSortMode("context");
			return;
		}
		if (kb.matches(keyData, "app.model.sortByInput")) {
			this.setSortMode("input");
			return;
		}
		if (kb.matches(keyData, "app.model.sortByOutput")) {
			this.setSortMode("output");
			return;
		}
		if (kb.matches(keyData, "app.model.sortByProvider")) {
			this.setSortMode("provider");
			return;
		}
		if (kb.matches(keyData, "app.model.sortByIq")) {
			this.setSortMode("iq");
			return;
		}
		if (kb.matches(keyData, "app.model.sortByReleaseDate")) {
			this.setSortMode("releaseDate");
			return;
		}
		if (kb.matches(keyData, "app.model.sort")) {
			this.cycleSortMode();
			return;
		}
		if (kb.matches(keyData, "tui.select.pageUp")) {
			if (this.filteredModels.length === 0) return;
			this.selectedIndex = Math.max(0, this.selectedIndex - this.visibleRows);
			this.updateList();
			return;
		}
		if (kb.matches(keyData, "tui.select.pageDown")) {
			if (this.filteredModels.length === 0) return;
			this.selectedIndex = Math.min(this.filteredModels.length - 1, this.selectedIndex + this.visibleRows);
			this.updateList();
			return;
		}
		// Up arrow - wrap to bottom when at top
		if (kb.matches(keyData, "tui.select.up")) {
			if (this.filteredModels.length === 0) return;
			this.selectedIndex = this.selectedIndex === 0 ? this.filteredModels.length - 1 : this.selectedIndex - 1;
			this.updateList();
		}
		// Down arrow - wrap to top when at bottom
		else if (kb.matches(keyData, "tui.select.down")) {
			if (this.filteredModels.length === 0) return;
			this.selectedIndex = this.selectedIndex === this.filteredModels.length - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
		}
		// Enter
		else if (kb.matches(keyData, "tui.select.confirm")) {
			const selectedModel = this.filteredModels[this.selectedIndex];
			if (selectedModel) {
				this.handleSelect(selectedModel.model);
			}
		}
		// Escape or Ctrl+C
		else if (kb.matches(keyData, "tui.select.cancel")) {
			this.close();
			this.onCancelCallback();
		}
		// Pass everything else to search input
		else {
			const previousQuery = this.searchInput.getValue();
			this.searchInput.handleInput(keyData);
			const query = this.searchInput.getValue();
			if (query !== previousQuery) this.filterModels(query);
		}
	}

	private handleSelect(model: Model<any>): void {
		this.close();
		// Save as new default
		this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
		this.onSelectCallback(model);
	}

	getSearchInput(): Input {
		return this.searchInput;
	}
}

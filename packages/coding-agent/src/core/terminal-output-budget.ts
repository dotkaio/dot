const DEFAULT_TERMINAL_COLUMNS = 80;
const DEFAULT_TERMINAL_ROWS = 24;

/** Editor, active status, and footer rows kept below assistant output. */
export const INTERACTIVE_CHROME_ROWS = 5;

/**
 * When enabled, assistant messages render without row truncation regardless of
 * the terminal budget (toggled by the app.output.toggleFull keybinding).
 */
let fullOutputMode = false;

export function isFullOutputMode(): boolean {
	return fullOutputMode;
}

export function toggleFullOutputMode(): boolean {
	fullOutputMode = !fullOutputMode;
	return fullOutputMode;
}

export interface TerminalSize {
	columns: number;
	rows: number;
}

export interface TerminalOutputBudget {
	columns: number;
	rows: number;
}

export function getTerminalOutputBudget(
	size: TerminalSize = {
		columns: process.stdout.columns || Number(process.env.COLUMNS) || DEFAULT_TERMINAL_COLUMNS,
		rows: process.stdout.rows || Number(process.env.LINES) || DEFAULT_TERMINAL_ROWS,
	},
): TerminalOutputBudget {
	const columns = Number.isFinite(size.columns) ? Math.max(1, Math.floor(size.columns)) : DEFAULT_TERMINAL_COLUMNS;
	const totalRows = Number.isFinite(size.rows) ? Math.max(1, Math.floor(size.rows)) : DEFAULT_TERMINAL_ROWS;
	return { columns, rows: Math.max(1, totalRows - INTERACTIVE_CHROME_ROWS) };
}
export function getCurrentTerminalSize(): TerminalSize | undefined {
	const columns = process.stdout.columns || Number(process.env.COLUMNS);
	const rows = process.stdout.rows || Number(process.env.LINES);
	if (!Number.isFinite(columns) || !Number.isFinite(rows) || columns <= 0 || rows <= 0) return undefined;
	return { columns, rows };
}

import { describe, expect, it } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

describe("full-height option lists", () => {
	it("derives selector capacity only from available terminal rows", () => {
		const getSelectorMaxVisible = (
			InteractiveMode as unknown as {
				prototype: {
					getSelectorMaxVisible(
						this: { ui: { terminal: { rows: number } } },
						reservedRows: number,
						fallback: number,
						rowsPerOption?: number,
					): number;
				};
			}
		).prototype.getSelectorMaxVisible;
		const context = { ui: { terminal: { rows: 60 } } };

		expect(getSelectorMaxVisible.call(context, 12, 10)).toBe(48);
		expect(getSelectorMaxVisible.call(context, 11, 10, 3)).toBe(16);
	});
});

import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBashTool } from "../src/core/tools/bash.ts";
import { createFindTool } from "../src/core/tools/find.ts";
import { createGrepTool } from "../src/core/tools/grep.ts";
import { createLsTool } from "../src/core/tools/ls.ts";
import { truncateLine } from "../src/core/tools/truncate.ts";

function getText(result: any): string {
	return (
		result.content
			?.filter((c: any) => c.type === "text")
			.map((c: any) => c.text)
			.join("\n") || ""
	);
}

describe("Tool limits and truncation edge cases", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `dot-tool-limits-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	describe("truncateLine", () => {
		it("should not split a non-BMP character in half when truncating", () => {
			// 600 emoji (2 UTF-16 code units each) truncated to 500 units must end on a pair boundary
			const line = "🚀".repeat(600);
			const { text, wasTruncated } = truncateLine(line, 500);
			expect(wasTruncated).toBe(true);
			expect(text.length).toBe(500 + "... [truncated]".length);
			// The character before the suffix must be a complete surrogate pair, not a lone surrogate
			const body = text.slice(0, 500);
			expect(body).toBe("🚀".repeat(250));
			expect(body.endsWith("🚀")).toBe(true);
		});

		it("should keep short lines intact", () => {
			expect(truncateLine("hello", 10)).toEqual({ text: "hello", wasTruncated: false });
		});
	});

	describe("ls tool", () => {
		it("should treat a limit below 1 as 1", async () => {
			for (const name of ["a.txt", "b.txt", "c.txt"]) {
				writeFileSync(join(testDir, name), "x");
			}
			const ls = createLsTool(testDir);
			const result = await ls.execute("ls-1", { limit: 0 });
			const lines = getText(result)
				.split("\n")
				.filter((l) => l && !l.startsWith("["));
			expect(lines.length).toBe(1);
			expect(result.details?.entryLimitReached).toBe(1);
		});

		it("should not report the entry limit when exactly limit entries exist", async () => {
			for (const name of ["a.txt", "b.txt", "c.txt"]) {
				writeFileSync(join(testDir, name), "x");
			}
			const ls = createLsTool(testDir);
			const result = await ls.execute("ls-2", { limit: 3 });
			expect(getText(result)).not.toContain("limit reached");
			expect(result.details?.entryLimitReached).toBeUndefined();
		});

		it("should report the entry limit when more entries exist", async () => {
			for (const name of ["a.txt", "b.txt", "c.txt", "d.txt"]) {
				writeFileSync(join(testDir, name), "x");
			}
			const ls = createLsTool(testDir);
			const result = await ls.execute("ls-3", { limit: 3 });
			expect(getText(result)).toContain("3 entries limit reached");
			expect(result.details?.entryLimitReached).toBe(3);
		});
	});

	describe("find tool", () => {
		it("should not report the result limit when exactly limit files match", async () => {
			for (const name of ["a.log", "b.log", "c.log"]) {
				writeFileSync(join(testDir, name), "x");
			}
			const find = createFindTool(testDir);
			const result = await find.execute("find-1", { pattern: "*.log", limit: 3 });
			const output = getText(result);
			expect(output.split("\n").filter(Boolean).length).toBe(3);
			expect(output).not.toContain("limit reached");
			expect(result.details?.resultLimitReached).toBeUndefined();
		});

		it("should report the result limit when more files exist and still return only limit results", async () => {
			for (const name of ["a.log", "b.log", "c.log", "d.log"]) {
				writeFileSync(join(testDir, name), "x");
			}
			const find = createFindTool(testDir);
			const result = await find.execute("find-2", { pattern: "*.log", limit: 3 });
			const output = getText(result);
			expect(output).toContain("3 results limit reached");
			expect(result.details?.resultLimitReached).toBe(3);
			const resultLines = output.split("\n\n[")[0].split("\n").filter(Boolean);
			expect(resultLines.length).toBe(3);
		});

		it("should tell exactly-N apart from more-than-N for custom glob operations", async () => {
			const files = ["a.ts", "b.ts"];
			const find = createFindTool(testDir, {
				operations: {
					exists: () => true,
					glob: (_pattern, _cwd, { limit }) => files.slice(0, limit),
				},
			});
			// Exactly 2 match: no notice. Custom ops are asked for limit + 1 and return 2.
			const exact = await find.execute("find-3", { pattern: "*.ts", limit: 2 });
			expect(getText(exact)).not.toContain("limit reached");
			// 3 available with limit 2: notice, and only 2 results returned.
			const more = createFindTool(testDir, {
				operations: {
					exists: () => true,
					glob: (_pattern, _cwd, { limit }) => ["x.ts", "y.ts", ...files].slice(0, limit),
				},
			});
			const over = await more.execute("find-4", { pattern: "*.ts", limit: 2 });
			const output = getText(over);
			expect(output).toContain("2 results limit reached");
			expect(output.split("\n\n[")[0].split("\n").filter(Boolean).length).toBe(2);
		});
	});

	describe("grep tool", () => {
		it("should not report the match limit when exactly limit matches exist", async () => {
			for (const i of [1, 2, 3]) {
				writeFileSync(join(testDir, `f${i}.txt`), `needle ${i}\nother\n`);
			}
			const grep = createGrepTool(testDir);
			const result = await grep.execute("grep-1", { pattern: "needle", limit: 3 });
			const output = getText(result);
			expect(output).not.toContain("limit reached");
			expect(result.details?.matchLimitReached).toBeUndefined();
			expect(output.split("\n").filter((l) => !l.startsWith("[")).length).toBe(3);
		});

		it("should report the match limit when more matches exist and keep only limit rows", async () => {
			for (const i of [1, 2, 3, 4]) {
				writeFileSync(join(testDir, `f${i}.txt`), `needle ${i}\nother\n`);
			}
			const grep = createGrepTool(testDir);
			const result = await grep.execute("grep-2", { pattern: "needle", limit: 3 });
			const output = getText(result);
			expect(output).toContain("3 matches limit reached");
			expect(result.details?.matchLimitReached).toBe(3);
			const resultLines = output.split("\n\n[")[0].split("\n").filter(Boolean);
			expect(resultLines.length).toBe(3);
		});

		it("should take context lines from ripgrep instead of reading matched files", async () => {
			writeFileSync(join(testDir, "ctx.txt"), "before1\nbefore2\nmatch here\nafter1\nafter2\n");
			const grep = createGrepTool(testDir);
			const result = await grep.execute("grep-3", { pattern: "match here", context: 1 });
			const output = getText(result);
			expect(output).toContain("ctx.txt:3: match here");
			expect(output).toContain("ctx.txt-2- before2");
			expect(output).toContain("ctx.txt-4- after1");
		});

		it("should match globs relative to the search path", async () => {
			mkdirSync(join(testDir, "migrations", "main"), { recursive: true });
			writeFileSync(join(testDir, "migrations", "main", "a.js"), "hit\n");
			writeFileSync(join(testDir, "migrations", "b.js"), "hit\n");
			const grep = createGrepTool(testDir);
			const result = await grep.execute("grep-4", {
				pattern: "hit",
				path: "migrations",
				glob: "main/*.js",
			});
			const output = getText(result);
			expect(output).toContain("main/a.js");
			expect(output).not.toContain("b.js");
		});

		it("should not fail on a glob with a leading ./", async () => {
			writeFileSync(join(testDir, "src.txt"), "hit\n");
			const grep = createGrepTool(testDir);
			const result = await grep.execute("grep-5", { pattern: "hit", glob: "./src.txt" });
			expect(getText(result)).toContain("src.txt");
		});
	});

	describe("bash tool", () => {
		it("should report the shell exit code when background processes keep writing past the timeout", async () => {
			const bash = createBashTool(testDir);
			// The shell exits immediately; a background loop keeps writing to the shared pipes
			// until the timeout fires, so the command's real result must still be reported.
			let error: unknown;
			try {
				await bash.execute("bash-1", {
					command: 'for i in $(seq 1 60); do echo "line $i"; sleep 0.05; done & exit 0',
					timeout: 1,
				});
			} catch (err) {
				error = err;
			}
			expect(error).toBeInstanceOf(Error);
			const message = (error as Error).message;
			expect(message).toContain("Command timed out after 1 seconds");
			expect(message).toContain("The shell exited with code 0 after");
			expect(message).toContain("but background processes it started kept writing output until the timeout");
		}, 15000);
	});
});

import { afterEach, describe, expect, test, vi } from "vitest";
import { getZshCompletion, handleCompletionCommand } from "../src/cli/completions.ts";

describe("completion command", () => {
	const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
	const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as never);

	afterEach(() => {
		exitSpy.mockClear();
		logSpy.mockClear();
		errorSpy.mockClear();
		writeSpy.mockClear();
	});

	describe("getZshCompletion", () => {
		test("starts with a compdef header", () => {
			const script = getZshCompletion("dot");
			expect(script.startsWith("#compdef dot\n")).toBe(true);
		});

		test("registers the completion function for dot", () => {
			const script = getZshCompletion("dot");
			expect(script).toContain("compdef _dot dot");
			expect(script).toContain('if [ "$funcstack[1]" = "_dot" ]');
		});

		test("covers every subcommand", () => {
			const script = getZshCompletion("dot");
			for (const command of ["install", "remove", "uninstall", "update", "list", "config", "auth", "completion"]) {
				expect(script).toContain(`'${command}:`);
			}
		});

		test("covers key options and value lists", () => {
			const script = getZshCompletion("dot");
			for (const option of [
				"--provider=",
				"--model=",
				"--mode=",
				"--thinking",
				"--ui-mode",
				"--export",
				"--session",
				"--fork",
				"off minimal low medium high xhigh max",
				"text json rpc",
				"regular fullscreen",
				"print-api-key",
				"print-bearer-token",
				"self dot",
			]) {
				expect(script).toContain(option);
			}
		});
	});

	describe("handleCompletionCommand", () => {
		test("ignores non-completion commands", () => {
			expect(handleCompletionCommand(["install", "npm:foo"])).toBe(false);
			expect(handleCompletionCommand(["--help"])).toBe(false);
			expect(exitSpy).not.toHaveBeenCalled();
		});

		test("prints the zsh script for `dot completion zsh` and exits 0", () => {
			expect(handleCompletionCommand(["completion", "zsh"])).toBe(true);
			expect(writeSpy).toHaveBeenCalledWith(getZshCompletion("dot"));
			expect(exitSpy).toHaveBeenCalledWith(0);
		});

		test("prints help when no shell is given", () => {
			handleCompletionCommand(["completion"]);
			expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Usage: dot completion <shell>"));
			expect(exitSpy).toHaveBeenCalledWith(0);
		});

		test("prints help for --help", () => {
			handleCompletionCommand(["completion", "--help"]);
			expect(logSpy).toHaveBeenCalled();
			expect(exitSpy).toHaveBeenCalledWith(0);
		});

		test("rejects unsupported shells with exit code 1", () => {
			handleCompletionCommand(["completion", "fish"]);
			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('unsupported shell "fish"'));
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
	});
});

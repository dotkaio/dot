import { describe, expect, it, vi } from "vitest";
import { formatTimeAwareStartupGreeting, InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

type SubmitContext = {
	defaultEditor: { onSubmit?: (text: string) => void };
	editor: {
		addToHistory?: (text: string) => void;
		setText: (text: string) => void;
	};
	session: {
		isCompacting: boolean;
		isStreaming: boolean;
		isBashRunning: boolean;
		prompt: (text: string, options?: unknown) => Promise<void>;
	};
	flushPendingBashComponents: () => void;
	showWarning: (message: string) => void;
	runtimePolicy?: { disabledCommands?: string[] };
	onInputCallback?: (text: string) => void;
	pendingUserInputs: string[];
};

type InputContext = {
	onInputCallback?: (text: string) => void;
	pendingUserInputs: string[];
};

type KeyHandlerContext = {
	defaultEditor: {
		onAction(action: string, handler: () => void): void;
		onEscape?: () => void;
		onCtrlD?: () => void;
		onChange?: (text: string) => void;
		onPasteImage?: () => void;
	};
	ui: { onDebug?: () => void };
	runtimePolicy?: { disabledCommands?: string[] };
	showWarning(message: string): void;
	runIfCommandEnabled(command: string, action: () => void): void;
	handleClearCommand(): Promise<void>;
	showSessionSelector(): void;
};

type InteractiveModePrivate = {
	setupEditorSubmitHandler(this: SubmitContext): void;
	setupKeyHandlers(this: KeyHandlerContext): void;
	runIfCommandEnabled(this: KeyHandlerContext, command: string, action: () => void): void;
	getUserInput(this: InputContext): Promise<string>;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrivate;

function createSubmitContext(): SubmitContext {
	return {
		defaultEditor: {},
		editor: {
			addToHistory: vi.fn(),
			setText: vi.fn(),
		},
		session: {
			isCompacting: false,
			isStreaming: false,
			isBashRunning: false,
			prompt: vi.fn(async () => {}),
		},
		flushPendingBashComponents: vi.fn(),
		showWarning: vi.fn(),
		pendingUserInputs: [],
	};
}

describe("time-aware startup greeting", () => {
	it("uses local morning, afternoon, and night boundaries", () => {
		expect(formatTimeAwareStartupGreeting(new Date(2026, 0, 1, 4, 59))).toBe("Good night, how can I help you today?");
		expect(formatTimeAwareStartupGreeting(new Date(2026, 0, 1, 5, 0))).toBe(
			"Good morning, how can I help you today?",
		);
		expect(formatTimeAwareStartupGreeting(new Date(2026, 0, 1, 12, 0))).toBe(
			"Good afternoon, how can I help you today?",
		);
		expect(formatTimeAwareStartupGreeting(new Date(2026, 0, 1, 18, 0))).toBe("Good night, how can I help you today?");
	});
});

describe("InteractiveMode startup input", () => {
	it("queues a normal prompt submitted before the input callback is installed", async () => {
		const context = createSubmitContext();
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.(" early prompt ");

		expect(context.pendingUserInputs).toEqual(["early prompt"]);
		expect(context.flushPendingBashComponents).toHaveBeenCalledTimes(1);
		expect(context.editor.addToHistory).toHaveBeenCalledWith("early prompt");
	});

	it("rejects a directly typed command disabled by runtime policy", async () => {
		const context = createSubmitContext();
		context.runtimePolicy = { disabledCommands: ["model"] };
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.("/model anthropic/claude-sonnet-4-5");

		expect(context.showWarning).toHaveBeenCalledWith("/model is disabled by runtime policy.");
		expect(context.editor.setText).toHaveBeenCalledWith("");
		expect(context.pendingUserInputs).toEqual([]);
		expect(context.session.prompt).not.toHaveBeenCalled();
	});

	it("rejects new and resume keybindings disabled by runtime policy", () => {
		const handlers = new Map<string, () => void>();
		const context: KeyHandlerContext = {
			defaultEditor: {
				onAction(action, handler) {
					handlers.set(action, handler);
				},
			},
			ui: {},
			runtimePolicy: { disabledCommands: ["new", "resume"] },
			showWarning: vi.fn(),
			runIfCommandEnabled: interactiveModePrototype.runIfCommandEnabled,
			handleClearCommand: vi.fn(async () => {}),
			showSessionSelector: vi.fn(),
		};
		interactiveModePrototype.setupKeyHandlers.call(context);

		handlers.get("app.session.new")?.();
		handlers.get("app.session.resume")?.();

		expect(context.showWarning).toHaveBeenNthCalledWith(1, "/new is disabled by runtime policy.");
		expect(context.showWarning).toHaveBeenNthCalledWith(2, "/resume is disabled by runtime policy.");
		expect(context.handleClearCommand).not.toHaveBeenCalled();
		expect(context.showSessionSelector).not.toHaveBeenCalled();
	});

	it("returns queued startup input before installing a new input callback", async () => {
		const context: InputContext = {
			pendingUserInputs: ["queued prompt"],
		};

		await expect(interactiveModePrototype.getUserInput.call(context)).resolves.toBe("queued prompt");
		expect(context.onInputCallback).toBeUndefined();
		expect(context.pendingUserInputs).toEqual([]);
	});
});

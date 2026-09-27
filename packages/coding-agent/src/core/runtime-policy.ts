import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Api, Model } from "@dotkaio/dot-ai";
import { getAgentDir } from "../config.ts";

export interface RuntimePolicy {
	footerLabel?: string;
	lockedModel?: {
		provider: string;
		id: string;
	};
	disabledCommands?: string[];
	disabledExtensions?: string[];
	cleanStartup?: boolean;
}

const SYSTEM_POLICY_PATH = "/Library/Application Support/Dot/runtime-policy.json";

export function getRuntimePolicyPath(): string {
	const override = process.env.DOT_RUNTIME_POLICY_PATH?.trim();
	if (override) return override;
	if (existsSync(SYSTEM_POLICY_PATH)) return SYSTEM_POLICY_PATH;
	return join(getAgentDir(), "runtime-policy.json");
}

export function loadRuntimePolicy(path: string = getRuntimePolicyPath()): RuntimePolicy | undefined {
	if (!existsSync(path)) return undefined;
	const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Invalid runtime policy at ${path}: expected an object`);
	}
	const policy = value as Record<string, unknown>;
	const footerLabel = typeof policy.footerLabel === "string" ? policy.footerLabel.trim() : undefined;
	const cleanStartup = policy.cleanStartup === true;
	const lockedModelValue = policy.lockedModel;
	let lockedModel: RuntimePolicy["lockedModel"];
	if (lockedModelValue !== undefined) {
		if (!lockedModelValue || typeof lockedModelValue !== "object" || Array.isArray(lockedModelValue)) {
			throw new Error(`Invalid runtime policy at ${path}: lockedModel requires string provider and id`);
		}
		const lockedModelRecord = lockedModelValue as Record<string, unknown>;
		if (typeof lockedModelRecord.provider !== "string" || typeof lockedModelRecord.id !== "string") {
			throw new Error(`Invalid runtime policy at ${path}: lockedModel requires string provider and id`);
		}
		lockedModel = {
			provider: lockedModelRecord.provider.trim(),
			id: lockedModelRecord.id.trim(),
		};
	}
	const disabledCommands = Array.isArray(policy.disabledCommands)
		? policy.disabledCommands
				.filter((command): command is string => typeof command === "string")
				.map((command) => command.replace(/^\//, "").trim())
				.filter(Boolean)
		: undefined;
	const disabledExtensions = Array.isArray(policy.disabledExtensions)
		? policy.disabledExtensions
				.filter((extension): extension is string => typeof extension === "string")
				.map((extension) => extension.trim())
				.filter(Boolean)
		: undefined;

	if (lockedModel && (!lockedModel.provider || !lockedModel.id)) {
		throw new Error(`Invalid runtime policy at ${path}: lockedModel requires provider and id`);
	}

	return {
		...(footerLabel && { footerLabel }),
		...(lockedModel && { lockedModel }),
		...(disabledCommands && { disabledCommands: [...new Set(disabledCommands)] }),
		...(disabledExtensions && { disabledExtensions: [...new Set(disabledExtensions)] }),
		...(cleanStartup && { cleanStartup: true }),
	};
}

export function isRuntimeCommandDisabled(command: string, policy: RuntimePolicy | undefined): boolean {
	return policy?.disabledCommands?.includes(command.replace(/^\//, "")) ?? false;
}

export function isRuntimeExtensionDisabled(extension: string, policy: RuntimePolicy | undefined): boolean {
	return policy?.disabledExtensions?.includes(extension) ?? false;
}

export function filterModelsByRuntimePolicy<T extends Model<Api>>(
	models: readonly T[],
	policy: RuntimePolicy | undefined,
): readonly T[] {
	const locked = policy?.lockedModel;
	if (!locked) return models;
	return models.filter((model) => model.provider === locked.provider && model.id === locked.id);
}

export function isRuntimeModelAllowed(model: Model<Api>, policy: RuntimePolicy | undefined): boolean {
	const locked = policy?.lockedModel;
	return !locked || (model.provider === locked.provider && model.id === locked.id);
}

export function formatRuntimeModelLock(policy: RuntimePolicy | undefined): string | undefined {
	const locked = policy?.lockedModel;
	return locked ? `${locked.provider}/${locked.id}` : undefined;
}

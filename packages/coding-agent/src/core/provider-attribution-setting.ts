import type { SettingsManager } from "./settings-manager.ts";

function isTruthyEnvFlag(value: string | undefined): boolean {
	if (!value) return false;
	return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

export function isProviderAttributionEnabled(
	settingsManager: SettingsManager,
	attributionEnv: string | undefined = process.env.DOT_PROVIDER_ATTRIBUTION,
): boolean {
	return attributionEnv !== undefined
		? isTruthyEnvFlag(attributionEnv)
		: settingsManager.getEnableProviderAttribution();
}

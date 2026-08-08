export function areExperimentalFeaturesEnabled(): boolean {
	return process.env.DOT_EXPERIMENTAL === "1";
}

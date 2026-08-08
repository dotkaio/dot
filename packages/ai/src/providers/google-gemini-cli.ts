import { googleGeminiCliApi } from "../api/google-gemini-cli.lazy.ts";
import { lazyOAuth } from "../auth/helpers.ts";
import { loadGoogleGeminiCliOAuth } from "../auth/oauth/load.ts";
import { createProvider, type Provider } from "../models.ts";
import { GOOGLE_GEMINI_CLI_MODELS } from "./google-gemini-cli.models.ts";

export function googleGeminiCliProvider(): Provider<"google-gemini-cli"> {
	return createProvider({
		id: "google-gemini-cli",
		name: "Google Gemini CLI",
		baseUrl: "https://cloudcode-pa.googleapis.com",
		auth: {
			oauth: lazyOAuth({ name: "Google AI Pro/Ultra (Gemini CLI)", load: loadGoogleGeminiCliOAuth }),
		},
		models: Object.values(GOOGLE_GEMINI_CLI_MODELS),
		api: googleGeminiCliApi(),
	});
}

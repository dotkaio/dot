import keenableWebSearchExtension, { KEENABLE_WEB_SEARCH_EXTENSION_NAME } from "@dotkaio/dot-keenable-web-search";
import type { InlineExtension } from "../core/extensions/types.ts";
import { isRuntimeExtensionDisabled, type RuntimePolicy } from "../core/runtime-policy.ts";
import llamaExtension from "./llama/index.ts";

const availableBuiltInExtensions: InlineExtension[] = [
	{ name: "llama.cpp", factory: llamaExtension, hidden: true },
	{ name: KEENABLE_WEB_SEARCH_EXTENSION_NAME, factory: keenableWebSearchExtension, hidden: true },
];

export function getBuiltInExtensions(policy: RuntimePolicy | undefined): InlineExtension[] {
	return availableBuiltInExtensions.filter((extension) => !isRuntimeExtensionDisabled(extension.name, policy));
}

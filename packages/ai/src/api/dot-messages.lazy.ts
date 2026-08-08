import type { ProviderStreams } from "../types.ts";
import { lazyApi } from "./lazy.ts";

export const dotMessagesApi = (): ProviderStreams => lazyApi(() => import("./dot-messages.ts"));

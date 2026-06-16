// Public API for @toony/providers: the provider-neutral image adapter contract,
// the manual-import provider, and ingest-time image utilities (format detection
// and metadata stripping).

export { ProviderError } from "./errors.js";
export { contentTypeFor, detectImageFormat, extensionFor } from "./format.js";
export { ManualImportProvider } from "./manual.js";
export { stripImageMetadata } from "./strip.js";
export type {
  AssetProvenance,
  ImageFormat,
  ImageProvider,
  ImageRequest,
  ProviderKind,
  ProviderResult,
} from "./types.js";
export { PROVIDER_KINDS } from "./types.js";

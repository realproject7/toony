// Provider-neutral contract for producing renderable image assets.
//
// Toony coordinates project structure, prompts, assets, and validation; it is
// not an image-generation model and must not let one provider's policy become
// the product boundary. This module defines the neutral adapter contract that
// every source — manual files, agent-produced files, local/remote providers,
// ComfyUI/custom providers, and constrained cloud providers — implements.

/**
 * Neutral provider/source kinds. These describe HOW an asset is produced, never
 * a specific vendor's policy. New kinds are added here so the boundary stays
 * provider-neutral.
 */
export const PROVIDER_KINDS = [
  "manual",
  "agent-produced",
  "local",
  "remote",
  "comfyui",
  "constrained-cloud",
  "custom",
] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** Image container formats this package can detect and ingest. */
export type ImageFormat = "png" | "jpeg" | "webp" | "gif";

/**
 * A provider-neutral request for an image asset. Manual import reads
 * `sourcePath`; generation providers (added later) use `prompt`/`options`.
 * Keeping one request shape avoids a vendor-specific call surface leaking into
 * consumers.
 */
export interface ImageRequest {
  /** Local source file to import (manual provider). */
  sourcePath?: string;
  /** Generation prompt (used by generation providers added later). */
  prompt?: string;
  /** Neutral generation/import options. Never carries credentials. */
  options?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Neutral provenance recorded with an ingested asset. Deliberately excludes
 * account ids, keys, token tails, private endpoints, private paths, and raw
 * provider logs — only the source kind, provider label, and content type.
 */
export interface AssetProvenance {
  source: ProviderKind;
  providerId: string;
  contentType: string;
}

/** The raw output of a provider, before ingest-time metadata stripping. */
export interface ProviderResult {
  bytes: Uint8Array;
  format: ImageFormat;
  provenance: AssetProvenance;
}

/**
 * A provider-neutral image source. `transmitsRemotely` is false for local
 * sources (manual/local/ComfyUI-on-localhost); any provider that would send
 * project content off the machine must set it true so callers can require an
 * explicit opt-in before using it (cloud/remote generation is opt-in by
 * default and must not transmit private content otherwise).
 */
export interface ImageProvider {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly transmitsRemotely: boolean;
  produce(request: ImageRequest): Promise<ProviderResult>;
}

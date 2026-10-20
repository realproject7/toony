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
  /**
   * A character's reference sheet to condition the render on (#327): the image
   * bytes and a file name for the upload. Attached only when the resolved
   * workflow declares a reference input; a provider that receives one for a
   * workflow without such an input refuses rather than dropping it silently.
   */
  reference?: { bytes: Uint8Array; name: string };
  /**
   * Two characters' references for a two-person picture, each kept to its
   * side of the frame. Sent through the engine's IP-Adapter nodes only; a
   * provider without them refuses rather than dropping one. When both carry a
   * `prompt` (that person alone in the setting) and nothing is edited, each
   * person is first drawn in their own half of the frame, so who stands where
   * is fixed before the whole picture is drawn together.
   */
  references?: Array<{
    bytes: Uint8Array;
    name: string;
    side: "left" | "right";
    prompt?: string;
  }>;
  /**
   * An existing image to edit instead of drawing from noise: the bytes, a file
   * name for the upload and the strength (0 to 1) the sampler may change it by.
   * The provider encodes it as the starting latent; the result keeps its size,
   * unless `size` is given (another cut's picture as a starting point): the
   * source is then scaled and cropped to that size first.
   */
  source?: {
    bytes: Uint8Array;
    name: string;
    strength: number;
    size?: { width: number; height: number };
  };
}

/**
 * Neutral provenance recorded with an ingested asset. Deliberately excludes
 * account ids, keys, token tails, private endpoints, private paths, and raw
 * provider logs — only the source kind, provider label, and content type.
 */
export interface AssetProvenance {
  /** SHA-256 of the graph actually submitted, without publishing the private graph. */
  submittedGraphDigest?: string;
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

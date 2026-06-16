// The manual-import provider: ingest a local image file the operator points to.
//
// This is a real, local-only provider — it never touches the network, so
// `transmitsRemotely` is false and it transmits no project content anywhere.
// Generation providers (Grok/xAI-style, ComfyUI, constrained cloud, custom) are
// added later against the same contract; remote ones set `transmitsRemotely`
// true so callers can gate them behind an explicit opt-in.

import { readFile } from "node:fs/promises";
import { ProviderError } from "./errors.js";
import { contentTypeFor, detectImageFormat } from "./format.js";
import type { ImageProvider, ImageRequest, ProviderResult } from "./types.js";

export class ManualImportProvider implements ImageProvider {
  readonly id = "manual";
  readonly kind = "manual" as const;
  readonly transmitsRemotely = false;

  async produce(request: ImageRequest): Promise<ProviderResult> {
    const sourcePath = request.sourcePath;
    if (sourcePath === undefined || sourcePath.length === 0) {
      throw new ProviderError("manual.no-source", "manual import requires a source file path.");
    }
    let bytes: Uint8Array;
    try {
      // Normalize the Buffer to a plain Uint8Array so the contract stays
      // backing-store agnostic for downstream consumers.
      bytes = new Uint8Array(await readFile(sourcePath));
    } catch {
      // The cause is not echoed: fs errors embed the absolute path, which must
      // not leak into logs or output.
      throw new ProviderError(
        "manual.read-failed",
        "could not read the source image (check the path and permissions).",
      );
    }
    const format = detectImageFormat(bytes);
    if (format === null) {
      throw new ProviderError(
        "manual.unknown-format",
        "source is not a recognized image (PNG, JPEG, WebP, or GIF).",
      );
    }
    return {
      bytes,
      format,
      provenance: { source: "manual", providerId: this.id, contentType: contentTypeFor(format) },
    };
  }
}

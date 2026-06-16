# @toony/providers

Provider-neutral image adapter contract, the manual-import provider, and
ingest-time image utilities. Toony coordinates assets; it is not an
image-generation model and must not let one provider's policy become the
product boundary.

## Contract

`ImageProvider`:

```ts
interface ImageProvider {
  readonly id: string;
  readonly kind: ProviderKind;          // manual | agent-produced | local | remote | comfyui | constrained-cloud | custom
  readonly transmitsRemotely: boolean;  // remote providers must be opt-in at the call site
  produce(request: ImageRequest): Promise<ProviderResult>;
}
```

`ProviderResult` carries raw `bytes`, the detected `format`, and neutral
`AssetProvenance` (`source`, `providerId`, `contentType`) — never account ids,
keys, endpoints, private paths, or provider logs.

## Manual provider

`ManualImportProvider` imports a local file the operator points to. It is
local-only (`transmitsRemotely: false`), never touches the network, and detects
the format from magic bytes. Read failures do not echo the path (fs errors embed
absolute paths, which must not leak).

Generation providers (Grok/xAI-style, ComfyUI, constrained cloud, custom) are
added later against the same contract. Remote ones set `transmitsRemotely: true`
so callers gate them behind an explicit opt-in; cloud/remote generation never
transmits private content by default.

## Metadata stripping

`stripImageMetadata(bytes, format)` removes privacy-bearing metadata by
container surgery (pixel data preserved byte-for-byte):

- **PNG** — drops `tEXt`/`iTXt`/`zTXt`/`eXIf`/`tIME` chunks.
- **JPEG** — drops APP1 (EXIF/XMP), APP13 (IPTC), and COM segments.
- **WebP** — drops `EXIF`/`XMP ` chunks and clears their VP8X flag bits.
- **GIF** — passed through (not an EXIF/GPS carrier).

This runs at ingest so assets are public-safe by construction before the repo's
#3 scanner enforces it.

## Commands

- `pnpm --filter @toony/providers build | typecheck | test`

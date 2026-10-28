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

The ComfyUI provider renders through a ComfyUI server against the same contract:
from noise, or from an existing image (`request.source`, image to image, where
the sampler starts from the encoded source at the requested strength). A
loopback endpoint keeps content on the machine; any other endpoint sets
`transmitsRemotely: true`, so callers gate it behind an explicit opt-in.

## ComfyUI configuration

Runtime settings stay outside `webtoon.json`. Set them in Studio's Settings
page, or use these environment variables:

| Variable | Value |
|---|---|
| `TOONY_COMFYUI_URL` | ComfyUI base address, such as `http://127.0.0.1:8188`. |
| `TOONY_COMFYUI_WORKFLOW` | Path to a workflow-graph JSON file. |
| `TOONY_COMFYUI_CHECKPOINT` | Checkpoint file name as ComfyUI lists it. |
| `TOONY_COMFYUI_CONFIG` | Path to a local JSON configuration file. |
| `TOONY_COMFYUI_TIMEOUT_MS` | Fixed generation deadline in milliseconds. |

The configuration file accepts `url`, `workflowPath` (a workflow file path) or
`workflow` (an inline workflow graph), `checkpoint`, `timeoutMs`,
`pollIntervalMs`, and `injectionMap` (node/input mappings). For example:

```json
{
  "url": "http://127.0.0.1:8188",
  "workflowPath": "./workflow.json",
  "checkpoint": "model.safetensors",
  "timeoutMs": 180000,
  "pollIntervalMs": 1000
}
```

Each field resolves independently: programmatic inline overrides take
precedence over environment variables, then the file named by
`TOONY_COMFYUI_CONFIG`, then the workspace's `.toony/config.json` saved by
Studio. A file's inline `workflow` takes precedence over its `workflowPath`.
An explicitly requested named workflow (`--workflow <name>`) takes precedence
over environment, file and workspace workflow choices. When no workflow source
is set, the bundled workflow is used; set the checkpoint it should load.

## ComfyUI deadlines and cancellation

The implicit generation deadline allows 180 seconds per megapixel of the
submitted workflow's mapped width and height, with a 180-second floor. This is
an allowance, not a performance prediction. If the graph's dimensions are not
literal positive integers, the floor applies. `TOONY_COMFYUI_TIMEOUT_MS` or an
explicit `timeoutMs` in configuration sets a fixed deadline and disables scaling.

On timeout, the provider requests cancellation through
`POST /api/jobs/{job_id}/cancel`, deletes only its own pending queue entry, and
checks that the job has left both queue lists. It never sends a global interrupt.
Servers without the job-specific cancellation route can still delete pending
jobs. If a running job cannot be confirmed stopped, the error is
`comfyui.timeout-unsettled` and `generate` / `produce run` leave remaining cuts
not reached. Check the server queue before retrying. Confirmed cleanup keeps the
existing `comfyui.timeout` error and allows the batch to continue.

Cancellation requests and queue checks are bounded. A successful cancellation
response alone is not proof that the worker stopped. This follows the
[job cancellation API](https://github.com/Comfy-Org/ComfyUI/pull/14493).

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

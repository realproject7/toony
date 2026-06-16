// Public API for @toony/providers: the provider-neutral image adapter contract,
// the manual-import provider, and ingest-time image utilities (format detection
// and metadata stripping).

export {
  type ComfyUIClientDeps,
  ComfyUIProvider,
  type FetchLike,
} from "./comfyui.js";
export {
  COMFYUI_DEFAULT_LOCAL_URL,
  COMFYUI_DEFAULT_TIMEOUT_MS,
  type ComfyUIConfig,
  type ComfyUIConfigSource,
  resolveComfyUIConfig,
} from "./comfyui-config.js";
export {
  buildPromptRequest,
  buildViewUrl,
  type ComfyImageRef,
  type HistoryStatus,
  type PromptRequestBody,
  parsePromptId,
  readHistory,
} from "./comfyui-protocol.js";
export {
  buildWorkflow,
  type ComfyWorkflowGraph,
  type ComfyWorkflowNode,
  DEFAULT_INJECTION_MAP,
  parseWorkflowGraph,
  type WorkflowInjectionMap,
  type WorkflowParams,
} from "./comfyui-workflow.js";
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

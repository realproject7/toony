// Public API for @toony/providers: the provider-neutral image adapter contract,
// the manual-import provider, and ingest-time image utilities (format detection
// and metadata stripping).

export {
  type ComfyUIClientDeps,
  ComfyUIProvider,
  type FetchLike,
  isLoopbackEndpoint,
  randomSeed,
} from "./comfyui.js";
export {
  COMFYUI_DEFAULT_LOCAL_URL,
  COMFYUI_DEFAULT_TIMEOUT_MS,
  type ComfyUIConfig,
  type ComfyUIConfigSource,
  resolveComfyUIConfig,
  type ToonyWorkspaceComfyConfig,
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
  HALF_LORA_NODE,
  HALF_SAMPLER_NODE,
  HALF_TEXT_NODE,
  HALVES_JOINED_NODE,
  type ImageRegion,
  LORA_NODE,
  type LoraUse,
  type PixelBox,
  parseWorkflowGraph,
  REFERENCE_ADAPTER_NODE,
  REFERENCE_APPLY_NODE,
  REFERENCE_DEFAULT,
  REFERENCE_LOAD_NODE,
  REFERENCE_START,
  REFERENCE_STRONG,
  REFERENCE_WEIGHT,
  REFERENCE_WEIGHT_TYPE,
  REGION_BACK_NODE,
  REGION_CONTEXT,
  REGION_CROP_NODE,
  REGION_MASK_NODE,
  REGION_PASTE,
  REGION_PASTE_NODE,
  REGION_WORK_SIDE,
  type ReferenceImage,
  regionBoxes,
  SIDE_BY_SIDE_BLEND,
  SIDE_BY_SIDE_LORA_WHOLE,
  type SideBySidePerson,
  type SideBySideSource,
  SOURCE_ENCODE_NODE,
  SOURCE_LOAD_NODE,
  SOURCE_SCALE_NODE,
  type WorkflowInjectionMap,
  type WorkflowParams,
  withLoras,
  withReferenceImage,
  withReferenceImages,
  withSideBySide,
  withSourceImage,
} from "./comfyui-workflow.js";
export { ProviderError } from "./errors.js";
export { contentTypeFor, detectImageFormat, extensionFor, readImageSize } from "./format.js";
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

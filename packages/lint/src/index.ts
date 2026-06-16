// Public API for @toony/lint: headless, deterministic production-readiness
// lints. Schema/sequence lints consume @toony/schema; image analysis is pure
// (no cloud, no third-party codecs).

export type { Finding, Severity } from "./findings.js";
export { finding, isClean, sortFindings } from "./findings.js";
export type { ImageAnalysisOptions } from "./image/analyze.js";
export {
  analyzeImageBuffer,
  analyzeRaster,
  DEFAULT_IMAGE_ANALYSIS_OPTIONS,
  estimateCompressibleBytes,
} from "./image/analyze.js";
export type { ImageDimensions, ImageFormat } from "./image/dimensions.js";
export { readImageDimensions } from "./image/dimensions.js";
export { decodePng, ImageDecodeError, isPng } from "./image/png.js";
export type { ChannelCount, Raster } from "./image/raster.js";
export { expectedByteLength, isRasterWellFormed, luma, lumaSamples } from "./image/raster.js";
export { lintProjectSchema } from "./schema-lint.js";

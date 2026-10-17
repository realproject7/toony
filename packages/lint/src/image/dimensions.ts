// Shared header-only reader. Export must bound native allocations before it
// decodes, and lint must report those same dimensions without importing a second
// parser. Keep this path compatible with existing lint callers.
export { type ImageDimensions, type ImageFormat, readImageDimensions } from "@toony/export";

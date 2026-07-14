// The deterministic reference render size for a portrait webtoon cut (#154).
//
// The craft lint (rhythm/density) lays bubbles out at a fixed, image-independent
// canvas so its findings are reproducible, and the overflow lint falls back to
// the same size for a cut with no readable image. Single-sourcing the value here
// keeps the two lints assuming the identical canvas — they cannot drift apart.
export const REFERENCE_RENDER = { width: 1200, height: 1600 } as const;

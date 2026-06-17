// Node-only entry for @toony/fonts: on-disk asset path resolution.
//
// Split from the main entry so the browser-safe registry/CSS can be imported by
// @toony/render and the studio's client components without pulling `node:url`
// into a webpack client bundle. Node-only consumers (e.g. @toony/export's canvas
// font registration, studio tooling that copies assets into `public/`) import
// from "@toony/fonts/node".

export { fontAssetPath, fontsAssetDir } from "./assets.js";

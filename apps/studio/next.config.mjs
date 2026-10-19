import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep development controls from covering the workspace navigation.
  devIndicators: false,
  // Emit a self-contained server under `.next/standalone` (its own minimal
  // `node_modules` + `server.js`). The Toony CLI bundles this output so
  // `toony studio` launches the web app from a single global install with no
  // monorepo present. `.next/static` and `public/` are copied alongside it by
  // the CLI packaging script (Next does not include them in the standalone dir).
  output: "standalone",
  // Collect the file trace from the monorepo root so standalone's bundled
  // `node_modules` resolves hoisted/workspace deps (`@toony/*`, react) correctly.
  outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), "..", ".."),
  // Reading project files happens in server components; nothing here uploads or
  // publishes. No wallet/account/publish/royalty surfaces exist in this app.
  //
  // `@napi-rs/canvas` (pulled in transitively via `@toony/export` for stitched
  // export rendering) ships a prebuilt native `.node` binary that webpack cannot
  // bundle. It is only ever used on the server, so externalize it: Next.js then
  // requires it at runtime instead of trying to bundle the binary.
  // Keep URL-relative native/font resolution in real ESM files. Bundling these
  // imports would turn their runtime URLs into nonportable build-time paths.
  serverExternalPackages: ["@napi-rs/canvas", "@toony/export"],
  outputFileTracingIncludes: {
    "/*": ["../../packages/fonts/assets/**/*"],
  },
  webpack: (config, { isServer }) => {
    // Shared server helpers also compile to ESM for the Node test runner.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    if (isServer) {
      // The native binary is resolved at runtime through `js-binding.js`'s
      // dynamic require; mark the whole package (and the resolved platform
      // `.node` file) as external so webpack never tries to parse the binary.
      const externals = Array.isArray(config.externals) ? config.externals : [config.externals];
      config.externals = [
        // Next's package opt-out matches node_modules paths. Workspace links
        // resolve outside that directory, so keep this ESM boundary explicitly.
        ({ request }, callback) => {
          if (request && /^@toony\/export(?:\/|$)/.test(request)) {
            return callback(null, `module ${request}`);
          }
          return callback();
        },
        ...externals.filter(Boolean),
        ({ request }, callback) => {
          if (request && /@napi-rs\/canvas/.test(request)) {
            return callback(null, `commonjs ${request}`);
          }
          return callback();
        },
      ];
    }
    return config;
  },
};

export default nextConfig;

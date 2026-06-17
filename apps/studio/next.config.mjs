/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Reading project files happens in server components; nothing here uploads or
  // publishes. No wallet/account/publish/royalty surfaces exist in this app.
  //
  // `@napi-rs/canvas` (pulled in transitively via `@toony/export` for stitched
  // export rendering) ships a prebuilt native `.node` binary that webpack cannot
  // bundle. It is only ever used on the server, so externalize it: Next.js then
  // requires it at runtime instead of trying to bundle the binary.
  serverExternalPackages: ["@napi-rs/canvas"],
  webpack: (config, { isServer }) => {
    if (isServer) {
      // The native binary is resolved at runtime through `js-binding.js`'s
      // dynamic require; mark the whole package (and the resolved platform
      // `.node` file) as external so webpack never tries to parse the binary.
      const externals = Array.isArray(config.externals) ? config.externals : [config.externals];
      config.externals = [
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

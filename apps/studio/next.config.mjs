/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Reading project files happens in server components; nothing here uploads or
  // publishes. No wallet/account/publish/royalty surfaces exist in this app.
};

export default nextConfig;

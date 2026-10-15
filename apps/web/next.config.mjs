/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The core package touches `node:fs` and must never be pulled into a client
  // bundle. Keeping it external also means Next does not try to re-bundle
  // already-compiled workspace output.
  serverExternalPackages: ['@job-queue/core'],
};

export default nextConfig;

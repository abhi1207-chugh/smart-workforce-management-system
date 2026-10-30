// The browser talks to same-origin /api/v1/*; Next proxies it to the Express
// backend, so no CORS setup is needed and the API URL stays server-side.
const backend = process.env.BACKEND_URL ?? "http://localhost:3001";

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${backend}/api/v1/:path*` }];
  },
};

export default nextConfig;

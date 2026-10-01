import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  // Prevent Next.js from bundling native/ESM-only packages — let Node.js handle them directly
  serverExternalPackages: ['mupdf', 'sharp', 'canvas'],

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = {
  ...nextConfig,
  allowedDevOrigins: ['192.168.68.69'],
  serverExternalPackages: ['mupdf', 'sharp', 'canvas'],
}

export default nextConfig;

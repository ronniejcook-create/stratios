import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // dev.stratios.app is a test site: tell search engines not to list any page.
  // Remove this (and `robots` in app/layout.tsx) when the public site launches.
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }]
  },
}

export default nextConfig

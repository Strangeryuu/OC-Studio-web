import type { NextConfig } from 'next'

// This Fork targets a protected server-rendered Web deployment. Keep upstream
// desktop/Android builds on main until a dedicated desktop build is restored.
const nextConfig: NextConfig = {
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/share/:path*',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      },
      {
        source: '/api/public-shares/:path*',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      },
    ]
  },
}

export default nextConfig

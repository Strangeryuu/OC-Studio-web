import type { NextConfig } from 'next'

// This Fork targets a protected server-rendered Web deployment. Keep upstream
// desktop/Android builds on main until a dedicated desktop build is restored.
const nextConfig: NextConfig = {
  output: 'standalone',
}

export default nextConfig

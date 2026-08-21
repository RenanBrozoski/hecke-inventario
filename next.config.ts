import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // O driver serverless do Neon usa `ws` (WebSocket) para o Pool do Prisma.
  // Sem isso, o bundler do Next empacota `ws` incorretamente em produção —
  // seu addon opcional nativo (bufferutil) quebra depois do bundle
  // (`TypeError: b.mask is not a function`), derrubando toda função que usa
  // o Prisma. Mantendo estes pacotes fora do bundle, eles são exigidos
  // normalmente do node_modules em runtime, preservando o binário nativo.
  serverExternalPackages: ['ws', 'bufferutil', 'utf-8-validate', '@neondatabase/serverless', '@prisma/adapter-neon'],
}

export default nextConfig

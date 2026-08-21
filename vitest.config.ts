import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vitest/config'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // JSX automático (sem precisar de `import React` em cada .tsx) — mesmo
  // runtime que o Next.js usa por padrão.
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    // Espelha o alias "@/*": ["./*"] do tsconfig.json — sem isso o Vitest não
    // resolve os imports "@/src/..." usados no código da Fase 1.
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
  test: {
    // Default 'node' (mais rápido, correto para a maior parte da suíte).
    // Testes de componente React usam `// @vitest-environment jsdom` no topo
    // do arquivo para trocar só ali.
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'app/**/*.test.{ts,tsx}'],
  },
})

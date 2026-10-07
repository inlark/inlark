import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  resolve: {
    alias: {
      electron: fileURLToPath(new URL('./tests/electron.stub.ts', import.meta.url)),
      '@inlark/crypto': fileURLToPath(new URL('./packages/crypto/src/index.ts', import.meta.url)),
      '@inlark/mime': fileURLToPath(new URL('./packages/mime/src/index.ts', import.meta.url)),
      '@inlark/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@inlark/jmap': fileURLToPath(new URL('./packages/jmap/src/index.ts', import.meta.url)),
      '@inlark/imap': fileURLToPath(new URL('./packages/imap/src/index.ts', import.meta.url)),
    },
  },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 15000, environment: 'node' },
})

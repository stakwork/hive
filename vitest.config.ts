import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: [
      'src/__tests__/unit/**/*.test.{js,ts}',
      'src/__tests__/integration/**/*.test.{js,ts}',
      'src/__tests__/e2e/**/*.test.{js,ts}'
    ],
    testTimeout: 10000, // Increased timeout for integration tests
    coverage: {
      include: [
        'src/app/api/**/*',
        'src/lib/**/*',
        'src/utils/**/*'
      ],
      exclude: [
        'src/__tests__/**/*',
        'src/**/*.test.{js,ts}',
        'src/**/*.spec.{js,ts}'
      ]
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})
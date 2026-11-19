import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      shared: path.resolve(rootDir, 'shared/src/index.ts')
    }
  },
  test: {
    include: ['shared/**/*.test.ts', 'server/**/*.test.ts', 'client/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['shared/src/**/*.ts'],
      exclude: ['shared/src/index.ts']
    }
  }
});
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'edge-runtime', include: ['apps/sidetone/convex/**/*.test.ts'], server: { deps: { inline: ['convex-test'] } } } });

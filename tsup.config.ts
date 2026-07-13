import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { asen: 'bin/asen.ts' },
  format: ['esm'],
  target: 'node18',
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
});

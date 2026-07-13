import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vite otherwise walks up past the repo and picks up whatever postcss config it finds in a
  // parent directory. There is no CSS here at all, so pin it to an empty config.
  css: { postcss: {} },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});

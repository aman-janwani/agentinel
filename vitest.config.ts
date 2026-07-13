import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vite otherwise walks up past the repo and picks up whatever postcss config it finds in a
  // parent directory. There is no CSS here at all, so pin it to an empty config.
  css: { postcss: {} },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // The command tests chdir into a temporary repo, since the commands resolve the repo from the
    // working directory. The default thread pool shares one process, so those chdir calls race
    // across test files. Forks give each file its own process and its own working directory.
    pool: 'forks',
  },
});

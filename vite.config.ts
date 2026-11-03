import { defineConfig } from 'vite-plus'

/**
 * Two artifacts, one command:
 *
 * - `host` — the Node/Electron half loaded through the package `exports` map by
 *   the Cordis loader in the profile this bundle is installed into.
 * - `client` — the browser half: an IIFE that calls `window.__ModuleLoader__.load`
 *   and registers the "ACP 模式" settings page. React arrives through the module
 *   loader's `require`, so it is never bundled here.
 */
export default defineConfig({
  pack: [
    {
      name: 'host',
      entry: { index: 'src/host/index.ts' },
      format: ['esm'],
      outDir: 'dist',
      platform: 'node',
      dts: true,
      sourcemap: true,
      clean: false,
    },
    {
      name: 'client',
      entry: { client: 'src/client/index.ts' },
      format: ['iife'],
      outDir: 'dist',
      platform: 'browser',
      target: 'es2022',
      minify: true,
      clean: false,
    },
  ],
  lint: {
    ignorePatterns: ['dist/**', 'coverage/**', 'node_modules/**', 'locale/**', 'scripts/**'],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
  fmt: {
    semi: false,
    singleQuote: true,
    printWidth: 100,
  },
})

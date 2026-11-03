import { build } from 'esbuild';

await build({
  entryPoints: ['src/browser/meteor.ts'],
  outfile: 'public/meteor.bundle.js',
  bundle: true,
  minify: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'mandateMeteor',
  target: 'es2022',
  define: { 'global': 'globalThis', 'process.env.NODE_ENV': '"production"' },
  inject: ['scripts/browser-shims.js'],
  logLevel: 'info'
});

import { defineConfig } from 'vite';
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

function copyRuntimeVendor() {
  return {
    name: 'copy-runtime-vendor',
    closeBundle() {
      const output = resolve('dist/vendor');
      mkdirSync(output, { recursive: true });
      copyFileSync(resolve('vendor/tone-14.8.49.js'), resolve(output, 'tone-14.8.49.js'));
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [copyRuntimeVendor()],
  build: { chunkSizeWarningLimit: 550 },
  server: { port: 5173, strictPort: true }
});

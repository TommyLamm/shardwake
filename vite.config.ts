import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// 平台成品格式：dist/ 根目錄必須直接是 game.json、index.html、cover.png、assets/。
// base 使用相對路徑，讓入口能在 /games/shardwake/<version>/ 與 /preview/... 子目錄運作。
export default defineConfig({
  base: './',
  publicDir: 'public',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    sourcemap: false,
    // Rapier compat 版把 WASM 以 base64 內嵌在 JS（rapier chunk 約 4.3 MB），屬預期；
    // 拆成獨立 chunk，遊戲程式更新時不必重新下載物理引擎與 three。
    chunkSizeWarningLimit: 5120,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'rapier', test: /[\\/]node_modules[\\/]@dimforge[\\/]/ },
            { name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  preview: {
    port: 4175,
    strictPort: false,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});

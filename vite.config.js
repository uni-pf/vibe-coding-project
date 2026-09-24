import { defineConfig } from 'vite'

export default defineConfig({
  // 纯静态项目：打包产物在 dist/，可原样丢到任意静态托管
  base: './',
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: 'dist',
    // 3D 模型与贴图体积较大，超过 1MB 不告警
    chunkSizeWarningLimit: 1500,
  },
})

import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

/**
 * 多页入口：index.html（3D 房间）+ catalog.html（物件清单）
 *
 * 为什么要显式声明 input（Day 17 加的）：
 *   Vite 默认只把 index.html 当入口，其他根目录下的 .html **不会被打包**。
 *   之前只有 `npm run dev` 能在 /catalog.html 打开清单页，
 *   一旦 build 上静态托管，那个地址就是 404 —— 因为产物里根本没有这个文件。
 *   显式列进来，两份 HTML 才会都进 dist/。
 *
 * 写法说明：本文件是 ESM（package.json 里 "type": "module"），
 * 没有 CommonJS 的 __dirname，路径要用 import.meta.url 推。
 */
const entry = (name) => fileURLToPath(new URL(`./${name}`, import.meta.url))

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
    rollupOptions: {
      input: {
        main: entry('index.html'),
        catalog: entry('catalog.html'),
      },
    },
  },
})

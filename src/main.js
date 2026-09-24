/**
 * 入口文件 —— 把各模块串成一条完整链路
 *
 * 开局：  加载遮罩 → 房间就绪 → 遮罩淡出（PRD F1.4）
 * 探索：  鼠标悬停 → 物件冒光尘（F2.3）；物件常驻呼吸式明暗（B4）
 * 点击：  射线检测判断点到谁（F2.4）→ 记下已解锁（F5.1）
 *          → ① 那件物件在 3D 里安静下来（A7，TECH_DESIGN §3.1 的回环）
 *          → ② 打开 DOM 内容页（F4）
 * 返回：  关闭内容页，房间状态原样保留（C2）
 * 收束：  三件看完、最后一个内容页关闭后 → 收束信号（F5.2 / A6）
 */
import './style.css'
import { objects as OBJECT_DEFS } from './data/objects.js'
import { createRoomScene } from './scene/room.js'
import { createAllObjects, setUnlockedVisual, updateMotes, updateBreathing } from './scene/objects.js'
import { createInteraction } from './scene/interaction.js'
import { createContentLayer } from './ui/content.js'
import { createEndLayer } from './ui/end.js'
import { createBootLayer } from './ui/boot.js'

const TOTAL = OBJECT_DEFS.length
const container = document.querySelector('#app')

// ── 0. 加载遮罩（必须在最前面，先盖住页面）──────────────────
const boot = createBootLayer()
boot.setProgress(10)

// ── 1. 立起房间 ────────────────────────────────────────────
const world = createRoomScene(container)
boot.setProgress(45)

// ── 2. 把物件放进房间（形状、位置、颜色全来自数据配置）────
const { group: objectGroup, list: objectList } = createAllObjects(OBJECT_DEFS)
world.scene.add(objectGroup)
boot.setProgress(75)

// ── 3. 解锁状态记录（PRD F5.1：当前会话内有效，刷新即丢）──
const unlocked = new Set()

// ── 4. 内容页 + 收束层 ─────────────────────────────────────
const content = createContentLayer()

const endLayer = createEndLayer({
  total: TOTAL,
  onReplay() {
    // "重新开始"：把解锁状态和物件外观一起复位
    // （PRD C3 说刷新回初始态可接受，但主动提供重来一次更完整）
    unlocked.clear()
    objectList.forEach((obj) => setUnlockedVisual(obj, false))
    content.close()
  },
})

// ── 5. 交互 ────────────────────────────────────────────────
const interaction = createInteraction({
  camera: world.camera,
  renderer: world.renderer,
  targets: objectList,
  onSelect(object3d) {
    const { objectId, definition } = object3d.userData
    const index = OBJECT_DEFS.findIndex((d) => d.id === objectId)

    unlocked.add(objectId)                        // 记下解锁
    setUnlockedVisual(object3d, true)             // 回写 3D 外观（PRD A7）
    content.open(definition, index, TOTAL)
  },
})

// 内容页关闭后：如果三件都看过了，才给收束信号。
// 放在"关闭之后"而不是"点击之后"，是为了不打断第三篇的阅读。
content.onClose(() => {
  if (unlocked.size === TOTAL && !endLayer.isOpen()) {
    // 稍等一下再弹，给返回房间留出过渡时间
    setTimeout(() => endLayer.show(), 520)
  }
})

// ── 6. 逐帧循环 ────────────────────────────────────────────
const startedAt = performance.now()

function loop() {
  const elapsed = (performance.now() - startedAt) / 1000
  interaction.update()
  updateBreathing(objectList, elapsed)                          // 常驻：让物件"活着"
  updateMotes(objectList, interaction.getHoveredId(), elapsed)  // 悬停：粒子飘散
  requestAnimationFrame(loop)
}

world.start()
loop()

// ── 7. 首帧画完之后收起遮罩 ────────────────────────────────
// 用两层 requestAnimationFrame：第一层等场景完成一次绘制，
// 第二层再让浏览器真正把画面提交上去 —— 这样遮罩淡出时，
// 后面已经是画好的房间，不会闪一下黑屏。
boot.setProgress(95)
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    boot.finish()
  })
})

// 开发期调试入口
if (import.meta.env.DEV) {
  window.__world = world
  window.__debug = { unlocked, objectList, content, interaction, endLayer }
}

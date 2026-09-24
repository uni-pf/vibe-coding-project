/**
 * 交互模块 —— PRD F2.3（悬停反馈）/ F2.4（点击命中判定）
 *
 * 核心是"射线检测"（Raycasting）：
 *   鼠标在屏幕上只有一个 2D 坐标。射线检测做的事，是从相机出发、
 *   经过鼠标指的那个点，往 3D 空间里射一条线，看这条线最早撞到哪个物体。
 *   撞到的那个，就是"用户点到了它"。
 *
 * 关于悬停反馈：本模块只负责"判断悬停在哪件物件上"，
 * 具体表现（粒子飘散）交给 objects.js 的 updateMotes 处理 —— 保持职责单一。
 *
 * 这个模块不认识"内容页"，也不认识"解锁进度"。
 * 它只负责判断"点到谁了"，然后把结果通过回调交出去。
 */
import * as THREE from 'three'

export function createInteraction({ camera, renderer, targets, onSelect }) {
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()

  let hoveredId = null        // 当前悬停的物件 id
  let pointerInside = false   // 鼠标是否在画布内

  // ── 把鼠标屏幕坐标换算成 -1 ~ 1 的"标准设备坐标" ────────
  // Raycaster 只认这个范围的坐标，(-1,-1) 是左下角，(1,1) 是右上角
  function updatePointer(event) {
    const rect = renderer.domElement.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  }

  /** 返回当前鼠标下面是哪个物件（没有就是 null） */
  function pick() {
    if (!pointerInside) return null
    raycaster.setFromCamera(pointer, camera)
    // recursive = true：物件是由多个零件拼的 group，要连子物体一起测
    const hits = raycaster.intersectObjects(targets, true)
    if (hits.length === 0) return null

    // 命中的是子零件，往上找到带 objectId 的那个 group
    let node = hits[0].object
    while (node && !node.userData.objectId) node = node.parent
    return node || null
  }

  // ── 每帧调用：更新悬停状态 ─────────────────────────────
  // 注意：不改变物件的缩放。悬停的"暗示"由粒子飘散承担（见 objects.js）。
  function update() {
    const hit = pick()
    const hitId = hit ? hit.userData.objectId : null

    if (hitId !== hoveredId) {
      hoveredId = hitId
      // 鼠标变成小手，这是"这里能点"最直接的第二信号（第一信号是自发光）
      renderer.domElement.style.cursor = hit ? 'pointer' : 'default'
    }
  }

  // ── 事件绑定 ───────────────────────────────────────────
  function onPointerMove(event) {
    pointerInside = true
    updatePointer(event)
  }

  function onPointerLeave() {
    pointerInside = false
  }

  function onClick() {
    // 注意：这里不重新用事件坐标算 pointer。
    // pointermove 已经把最新位置写进 pointer 了，直接用即可。
    // 用事件里重新计算会有一个隐患 —— 点击时如果页面刚滚动过，
    // getBoundingClientRect 的取值可能不是用户看到的那一帧，导致命中偏移。
    const hit = pick()
    // PRD C4：点击非交互区域无任何报错与误触发 —— 这里直接 return 掉
    if (!hit) return
    onSelect(hit)
  }

  const dom = renderer.domElement
  dom.addEventListener('pointermove', onPointerMove)
  dom.addEventListener('pointerleave', onPointerLeave)
  dom.addEventListener('click', onClick)

  // 首帧前先把鼠标位置初始化到屏幕外，避免误判
  pointer.set(-2, -2)

  return {
    update,
    getHoveredId: () => hoveredId,
    dispose() {
      dom.removeEventListener('pointermove', onPointerMove)
      dom.removeEventListener('pointerleave', onPointerLeave)
      dom.removeEventListener('click', onClick)
    },
  }
}

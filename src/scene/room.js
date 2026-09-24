/**
 * 房间场景 —— PRD F1.1 / F1.2 / F1.3 的实现
 *
 * 职责（只做这三件事，不管点击、不管内容页）：
 *   1. 建出地面、墙面、天花板、光照
 *   2. 让相机沿一条固定路线推进（滚轮驱动），并把视线依次交给三件物件 —— F1.2
 *   3. 提供一个逐帧循环，供尘埃等环境动效挂载 —— F1.3
 *
 * ⚠️ 相机运动在本次改版中换了方案：
 *   旧方案是「相机钉在原地，靠鼠标做 ±0.42m 的小幅平移」。实测看不出视差 ——
 *   因为 Z 轴不动就没有「走近」这件事，近处物件与远处墙面的速度差出不来。
 *   新方案是「相机沿固定曲线前进 + 视线沿第二条曲线依次转向」，即 TECH_DESIGN §2.4
 *   里原先被划掉的「重型视差」档（属本次定档变更，第 6 步回填技术文档）。
 *
 * 为什么拆成独立文件：3D 渲染和 UI 是两个域（TECH_DESIGN §2.4 的域界划分）。
 * 后续换 UI 框架时，这个文件可以原样搬走（TECH_DESIGN §2.7 预留的升级路径）。
 */
import * as THREE from 'three'
import { room as ROOM, palette, route as ROUTE } from '../data/objects.js'

/**
 * 现画一张尘埃用的圆形贴图
 *
 * 为什么不用图片文件：一张 64×64 的圆点渐变，代码几行就能生成，
 * 不必为此多一个网络请求、多一个素材文件要管。
 * 这是 3D 里很常见的做法 —— 程序化生成小贴图。
 */
function createDustTexture() {
  const SIZE = 64
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')

  // 从中心向外：白色不透明 → 全透明
  const gradient = ctx.createRadialGradient(
    SIZE / 2, SIZE / 2, 0,
    SIZE / 2, SIZE / 2, SIZE / 2
  )
  gradient.addColorStop(0.0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)')
  gradient.addColorStop(1.0, 'rgba(255,255,255,0)')

  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, SIZE, SIZE)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export function createRoomScene(container) {
  // ── 渲染器 ─────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)) // 限制到 2，避免高分屏拖垮帧率
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  container.appendChild(renderer.domElement)

  // ── 场景 + 雾 ──────────────────────────────────────────
  // 雾让远处墙面淡出，房间看起来"深"而不是"一个箱子"
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(palette.fog)
  scene.fog = new THREE.Fog(palette.fog, 4, 14)

  // ── 相机 ───────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(
    50,
    container.clientWidth / container.clientHeight,
    0.1,
    100
  )

  // ── 相机路线 ───────────────────────────────────────────
  // 两条曲线，关键点全部取自 data/objects.js 的 route 配置：
  //   camCurve  相机「站在哪」—— 推进时相机位置取这条线上的点
  //   lookCurve 相机「看向哪」—— 同一时刻视线落在这条线的对应点上
  //
  // 为什么用 CatmullRomCurve3 而不是折线：折线会在每个关键点处突然拐弯，
  // 而 Catmull-Rom 平滑地穿过每一个关键点，相机走起来才不像被人拽着走。
  // 默认的 centripetal 参数化能避免急弯处过冲打结，正适合相机路径。
  const toVec3List = (list) => list.map(([x, y, z]) => new THREE.Vector3(x, y, z))
  const camCurve = new THREE.CatmullRomCurve3(toVec3List(ROUTE.camera))
  const lookCurve = new THREE.CatmullRomCurve3(toVec3List(ROUTE.look))

  // ── 滚轮驱动 ───────────────────────────────────────────
  // 滚轮不直接推相机，而是推「目标进度」；相机每帧朝目标缓动逼近。
  // 这样滚一下会滑一段再停住，而不是随滚轮一格一格地跳。
  //
  // 手感由三个参数决定，放在一个对象里，为的是能在控制台实时调（见 tuneWheel）：
  //
  //   sign    方向。+1 = 向下滚 → 相机往房间深处推进
  //           （对应网页里「向下滚 = 看后面内容」的通用直觉）
  //           -1 = 反过来，向上滚才往深处推进。
  //           鼠标或系统若开了「自然滚动 / 反向滚动」，物理手感会与之相反，翻个号即可。
  //
  //   total   灵敏度。滚轮累积多少像素才走完全程。
  //           调大 → 更慢更从容；调小 → 更快，容易冲过头。
  //
  //   maxStep 单次事件的最大推进量（像素）。
  //           有的鼠标滚一格是 100、有的 120，带平滑滚动的设备一次能给到 300+，
  //           不限一下就会出现「滚一下就冲过半间屋子」。
  //           触控板那种连续小量的事件不受影响。
  //
  //   lastDeltaY 只用于排查方向对不对：记录最近一次滚动的原始 deltaY。
  //           怀疑方向反了时，滚一下再在控制台敲 __world.tuneWheel({}) 看它的符号。
  const wheel = {
    sign: 1,
    total: 10000,   // 滚一格（约 100px）≈ 相机前进 6.4cm，走完全程约 100 格
    maxStep: 120,
    lastDeltaY: null,
  }

  // 缓动强度（每秒的指数衰减系数）：调大更跟手，调小更飘
  const EASING = 9

  let progress = 0         // 相机实际所在的进度
  let targetProgress = 0   // 滚轮想要到达的进度
  const lookTarget = new THREE.Vector3()  // 复用同一个向量接视线目标，避免每帧新建对象

  const clamp01 = (v) => Math.max(0, Math.min(1, v))

  /**
   * 把当前的 progress 应用到相机上。
   *
   * 这里必须用 getPoint 而不是 getPointAt —— 是正确性问题，不是风格偏好：
   *   getPointAt 按「弧长」参数化，而两条曲线弧长不同（实测 7.31m vs 6.93m），
   *   同一个进度在两条线上对应的位置并不一样。实测相机走到 90% 路程时，
   *   视线已经滑到约 97%，结果物件被甩到画面边上。
   *   getPoint 按「控制点」等参数，第 i 个相机关键点正好对上第 i 个视线关键点。
   * 代价：长段走得快、短段走得慢。本路线各段长度相差约 1.8 倍，可以接受；
   * 若以后路线关键点拉得很不均匀，滚轮手感会忽快忽慢，届时再考虑加弧长补偿。
   */
  function applyCamera() {
    camera.position.copy(camCurve.getPoint(progress))
    camera.lookAt(lookCurve.getPoint(progress, lookTarget))
  }

  function onWheel(e) {
    // Firefox 的 deltaMode 可能是「行」或「页」而不是像素，先统一折算成像素 ——
    // 否则同一个页面在不同浏览器里的推进速度会差几十倍
    let dy = e.deltaY
    if (e.deltaMode === 1) dy *= 16        // 行
    else if (e.deltaMode === 2) dy *= 800  // 页

    wheel.lastDeltaY = e.deltaY   // 记录原始值，供排查方向用

    // 限幅：再大的单次滚动也只按 maxStep 计，避免一格就冲过去半间屋子
    dy = Math.max(-wheel.maxStep, Math.min(wheel.maxStep, dy))

    // TODO(后续 · 物件旁阻尼)：滚到某件物件的 routeRange 附近时，
    // 把这里的推进量乘一个小于 1 的系数（例如 0.35），让相机快到物件时慢下来、
    // 像被「粘」了一下，方便用户点中。本次不做，按用户要求留到后续。
    targetProgress = clamp01(targetProgress + (wheel.sign * dy) / wheel.total)
  }

  window.addEventListener('wheel', onWheel, { passive: true })

  applyCamera() // 先把相机放到路线起点

  // ── 房间几何体 ─────────────────────────────────────────
  const { width: W, depth: D, height: H } = ROOM

  const matFloor = new THREE.MeshStandardMaterial({
    color: palette.floor,
    roughness: 0.92,
    metalness: 0.02,
  })
  const matWall = new THREE.MeshStandardMaterial({
    color: palette.wall,
    roughness: 0.95,
    metalness: 0.0,
    side: THREE.DoubleSide, // 双面渲染：相机贴墙时不会看到"消失的墙"
  })

  // 地面
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), matFloor)
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)

  // 天花板
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D), matWall)
  ceiling.rotation.x = Math.PI / 2
  ceiling.position.y = H
  scene.add(ceiling)

  // 四面墙
  const wallDefs = [
    { pos: [0, H / 2, -D / 2], rotY: 0 },              // 北（正面）
    { pos: [0, H / 2, D / 2], rotY: Math.PI },         // 南（背后）
    { pos: [-W / 2, H / 2, 0], rotY: Math.PI / 2 },    // 西
    { pos: [W / 2, H / 2, 0], rotY: -Math.PI / 2 },    // 东
  ]
  wallDefs.forEach(({ pos, rotY }) => {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(W, H), matWall)
    wall.position.set(...pos)
    wall.rotation.y = rotY
    wall.receiveShadow = true
    scene.add(wall)
  })

  // ── 光照 ───────────────────────────────────────────────
  // 环境光：保证暗处还有细节，纯黑会让房间像坏掉
  scene.add(new THREE.AmbientLight(0x93A7BD, 0.55))

  // 主光：从右上角斜射，负责"这屋子有方向感"
  const keyLight = new THREE.DirectionalLight(0xFFE7C4, 1.15)
  keyLight.position.set(3.2, 4.6, 2.4)
  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(1024, 1024)
  keyLight.shadow.camera.left = -6
  keyLight.shadow.camera.right = 6
  keyLight.shadow.camera.top = 6
  keyLight.shadow.camera.bottom = -6
  scene.add(keyLight)

  // 补光：冷色，从左侧低角度补，避免背光面死黑
  const fillLight = new THREE.PointLight(0x5B9BD5, 0.9, 12, 2)
  fillLight.position.set(-3.0, 1.4, 1.2)
  scene.add(fillLight)

  // ── 环境动效：尘埃（F1.3）─────────────────────────────
  // 用 Points 画一堆微小亮点，让空间"不死"
  //
  // 关于"圆点"：PointsMaterial 默认画的是方形，屏幕上就是一个个小方块。
  // 做法是现画一张 64×64 的画布 —— 中心白、边缘渐变到黑 —— 当作每个点的贴图。
  // 再配合 transparent + alphaTest，黑边就被当作透明抠掉，点就成了柔和圆斑。
  const DUST_COUNT = 260
  const dustPositions = new Float32Array(DUST_COUNT * 3)
  const dustSpeed = new Float32Array(DUST_COUNT)
  for (let i = 0; i < DUST_COUNT; i++) {
    dustPositions[i * 3 + 0] = (Math.random() - 0.5) * W * 0.9
    dustPositions[i * 3 + 1] = Math.random() * H
    dustPositions[i * 3 + 2] = (Math.random() - 0.5) * D * 0.9
    dustSpeed[i] = 0.02 + Math.random() * 0.05
  }
  const dustGeo = new THREE.BufferGeometry()
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3))

  const dustTexture = createDustTexture()

  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({
      color: 0xBFD4EA,
      map: dustTexture,        // 用圆形贴图替换默认方块
      size: 0.018,             // 略小于之前的 0.022：氛围不该抢视线
      transparent: true,
      opacity: 0.35,           // 从 0.5 压到 0.35，存在感再降一档
      depthWrite: false,       // 尘埃不该互相遮挡
      blending: THREE.AdditiveBlending, // 叠加混合：重叠处自然变亮，更像光尘
    })
  )
  scene.add(dust)

  // 说明：旧的「鼠标驱动视角平移」整段已移除。
  // 原因是相机位置现在完全由路线决定，若在路线上再叠加鼠标位移，
  // 会让「相机是否走到某件物件跟前」这个判断失去准头（routeRange 按路线进度定）。
  // 若之后还想要一点「画面活着」的手感，正确做法是把微小偏移叠加到**视线点**上，
  // 而不是叠加到相机位置上 —— 等滚轮接好、看过实际观感再决定要不要加。

  // ── 逐帧循环 ───────────────────────────────────────────
  const clock = new THREE.Clock()
  let elapsed = 0   // 自己累加的运行时长，给尘埃这类「跟时间有关」的动效用
  let rafId = null

  function tick() {
    // 每帧只取一次 delta —— THREE.Clock 的 getDelta 与 getElapsedTime 共用同一个时间基准，
    // 同一帧里先后调用会把这段间隔算两遍（第二次接近 0），所以运行时长自己累加。
    const dt = clock.getDelta()
    elapsed += dt

    // 相机朝目标进度缓动逼近：滚一下会滑一段再停，而不是一格一格地跳
    const diff = targetProgress - progress
    if (Math.abs(diff) > 0.00005) {
      // 用指数衰减而不是固定比例，手感才不受帧率影响 ——
      // 固定比例在 120Hz 屏上会变成两倍速
      progress += diff * (1 - Math.exp(-EASING * dt))
      applyCamera()
    }

    // 尘埃缓慢上浮，浮到顶就绕回地面
    const arr = dustGeo.attributes.position.array
    for (let i = 0; i < DUST_COUNT; i++) {
      arr[i * 3 + 1] += dustSpeed[i] * 0.016
      if (arr[i * 3 + 1] > H) arr[i * 3 + 1] = 0
      // 加一点极缓慢的横向漂移，避免看起来像垂直下落的雨
      arr[i * 3 + 0] += Math.sin(elapsed * 0.3 + i) * 0.0004
    }
    dustGeo.attributes.position.needsUpdate = true

    renderer.render(scene, camera)
    rafId = requestAnimationFrame(tick)
  }

  function start() {
    if (rafId === null) {
      // 从此刻起算：建场景本身要花一点时间，若不重置，一开始就会直接跳过一段路程
      clock.start()
      tick()
    }
  }

  function dispose() {
    if (rafId !== null) cancelAnimationFrame(rafId)
    window.removeEventListener('wheel', onWheel)
    renderer.dispose()
  }

  // 窗口尺寸变化时同步相机与渲染器（F6.2 响应式的基础）
  function resize() {
    const w = container.clientWidth
    const h = container.clientHeight
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  }
  window.addEventListener('resize', resize)

  // setProgress / getProgress：控制台调试用。
  // setProgress 会同时改目标值，否则设完之后相机立刻被缓动拉回原处，看起来像没生效。
  return {
    scene,
    camera,
    renderer,
    start,
    dispose,
    resize,
    setProgress(p) {
      targetProgress = clamp01(p)
      progress = targetProgress
      applyCamera()
    },
    getProgress: () => progress,
    getTargetProgress: () => targetProgress,
    /** 控制台实时调滚轮手感，不用改代码重启：__world.tuneWheel({ total: 9000 }) */
    tuneWheel(partial) {
      Object.assign(wheel, partial)
      return { ...wheel }
    },
  }
}

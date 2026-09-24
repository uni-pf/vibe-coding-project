/**
 * 物件工厂 —— 把 data/objects.js 里的配置，变成场景里的 3D 物体
 *
 * 为什么要单独一个文件：这是 PRD E1 的落点。
 * 新增第 4、5 件物件时，只需要在 data/objects.js 里加一项、
 * 在这里的 GEOMETRY_BUILDERS 里加一个造型函数 —— 场景与交互代码一行都不用动。
 *
 * 关于"自发光"：Three.js 里让物体发光靠 emissive（自发光色）。
 * 它和 color（本色）是两回事：
 *   color     —— 物体被光照到时反射出来的颜色
 *   emissive  —— 物体自己发出的光，不需要任何外部光源
 * 房间是暗的，所以物件能被看见，靠的正是 emissive。
 */
import * as THREE from 'three'

/**
 * 造型表：每种 shape 对应一个几何体构造方式
 * 本期没有真模型（TECH_DESIGN §2.3 预留的"程序化几何体"路线）
 */
const GEOMETRY_BUILDERS = {
  // 台灯：一根细杆 + 一个灯罩（锥体）
  lamp({ radius, height }) {
    const group = new THREE.Group()
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.18, radius * 0.22, height, 12),
      null
    )
    pole.position.y = height / 2
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(radius * 1.5, radius * 1.4, 20, 1, true),
      null
    )
    shade.position.y = height + radius * 0.5
    group.add(pole, shade)
    return group
  },

  // 笔记本：一块扁长方体，微微张开
  book({ w, h, d }) {
    const group = new THREE.Group()
    const cover = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), null)
    const pages = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.92, h * 0.6, d * 0.86),
      null
    )
    pages.position.y = h * 0.6
    group.add(cover, pages)
    return group
  },

  // 唱片：一个扁圆柱
  disc({ radius, thickness }) {
    const group = new THREE.Group()
    const record = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, thickness, 32),
      null
    )
    // 唱片立着靠墙：转 90° 让圆面朝外
    record.rotation.x = Math.PI / 2
    record.rotation.z = Math.PI / 2
    group.add(record)
    return group
  },
}

/**
 * 造一件物件
 * @returns {THREE.Group} 挂好信息、材质已配好自发光
 */
export function createObject(definition) {
  const build = GEOMETRY_BUILDERS[definition.shape]
  if (!build) {
    throw new Error(`未知的物件形状：${definition.shape}（请检查 data/objects.js）`)
  }

  const group = build(definition.size)

  // 同一件物件下的所有零件共用一份材质 —— 自发光调节时一起变
  const material = new THREE.MeshStandardMaterial({
    color: definition.color,
    emissive: new THREE.Color(definition.color),
    emissiveIntensity: 0.75,   // 未解锁时的基础发光强度
    roughness: 0.45,
    metalness: 0.1,
  })

  group.traverse((child) => {
    if (child.isMesh) {
      child.material = material
      child.castShadow = true
      child.receiveShadow = true
    }
  })

  // 摆到配置指定的位置
  group.position.set(...definition.position)

  // 悬停时飘散的粒子（F2.3 的"暗示"改由粒子承担，不用缩放）
  const motes = createMoteField(definition.color)
  group.add(motes)

  // 把业务信息挂在 3D 物体上 —— 射线检测命中后，靠这里反查是哪件物件
  group.userData = {
    objectId: definition.id,
    definition,
    material,
    motes,
    motePhase: Math.random() * 10, // 每件物件的粒子错开相位，不会整齐划一
    unlocked: false,
  }

  return group
}

/**
 * 悬停时飘散的粒子簇
 *
 * 为什么用粒子代替"放大"：放大更像按钮的反馈，会把 3D 物件拉回"UI 控件"的感觉。
 * 暗房间里一簇光尘从物件身上缓缓升起，传达的是"这东西是活的"，
 * 也更贴近 PRD §1.4 那句"有几处微光"的氛围。
 */
const MOTE_COUNT = 18

function createMoteField(color) {
  const positions = new Float32Array(MOTE_COUNT * 3)
  const speeds = new Float32Array(MOTE_COUNT)
  const offsets = new Float32Array(MOTE_COUNT)

  for (let i = 0; i < MOTE_COUNT; i++) {
    // 从物件中心附近开始，散在一个小球里
    const r = Math.random() * 0.22
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = r * Math.cos(phi) * 0.6 + 0.15
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
    speeds[i] = 0.10 + Math.random() * 0.16
    offsets[i] = Math.random()
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))

  const material = new THREE.PointsMaterial({
    color: new THREE.Color(color),
    size: 0.05,
    transparent: true,
    opacity: 0,               // 默认不可见，悬停时才淡入
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  const points = new THREE.Points(geo, material)
  points.userData = { basePositions: positions.slice(), speeds, offsets }
  points.visible = false
  return points
}

/**
 * 造出全部物件，返回 { group, list }
 *   group —— 统一加进场景的容器
 *   list  —— 物件数组，交互模块要用
 *
 * 用一个容器包住全部物件，是为了将来加"整体旋转房间"之类的操作时，
 * 不会波及墙和地面。
 */
export function createAllObjects(definitions) {
  const group = new THREE.Group()
  group.name = 'interactive-objects'

  const list = definitions.map((definition) => {
    const obj = createObject(definition)
    group.add(obj)
    return obj
  })

  return { group, list }
}

/**
 * 更新一件物件的外观 —— 解锁状态改变时调用（TECH_DESIGN §3.1 的"回写"）
 * 未解锁：发光明亮，在暗房间里跳出来
 * 已解锁：发光减弱、颜色变淡，视觉上"安静下来"
 * 这就满足了 PRD A7「已解锁与未解锁在视觉上可区分」
 */
export function setUnlockedVisual(object3d, unlocked) {
  const { material } = object3d.userData
  const target = unlocked ? 0.12 : 0.75
  material.emissiveIntensity = target
  object3d.userData.unlocked = unlocked
}

/**
 * 每帧更新所有物件的悬停粒子
 *
 * @param {THREE.Object3D[]} objects 全部物件
 * @param {string|null} hoveredId    当前悬停的物件 id
 * @param {number} elapsed           已经过的时间（秒）
 *
 * 粒子的循环方式：从物件中心升起 → 淡出 → 回到起点重新升。
 * 让每个粒子的偏移量不同，看起来就是持续不断的一簇，而不是整齐的一排。
 */
export function updateMotes(objects, hoveredId, elapsed) {
  objects.forEach((obj) => {
    const { motes, motePhase, objectId } = obj.userData
    if (!motes) return

    const active = objectId === hoveredId
    const targetOpacity = active ? 0.9 : 0
    // 淡入快、淡出慢：悬停时立刻有反应，移开时缓缓消散
    const speed = active ? 0.18 : 0.06
    motes.material.opacity += (targetOpacity - motes.material.opacity) * speed

    if (motes.material.opacity < 0.01) {
      motes.visible = false
      return
    }
    motes.visible = true

    const arr = motes.geometry.attributes.position.array
    const { basePositions, speeds } = motes.userData

    for (let i = 0; i < MOTE_COUNT; i++) {
      // 每颗粒子有自己的一段时间：0 → 1 循环
      const cycle = ((elapsed * speeds[i] + motePhase * 0.1 + i * 0.13) % 1)
      // 升起高度：随时间线性上升，配合缓出让顶端变慢
      const rise = cycle * cycle * 0.85
      // 轻微横向摆动，避免看起来像垂直上升的直线
      const swayX = Math.sin(elapsed * 1.4 + i * 1.7) * 0.05 * cycle
      const swayZ = Math.cos(elapsed * 1.1 + i * 2.3) * 0.05 * cycle

      arr[i * 3 + 0] = basePositions[i * 3 + 0] + swayX
      arr[i * 3 + 1] = basePositions[i * 3 + 1] + rise
      arr[i * 3 + 2] = basePositions[i * 3 + 2] + swayZ
    }
    motes.geometry.attributes.position.needsUpdate = true
  })
}

/**
 * 呼吸式明暗起伏 —— PRD B4「首次进入的用户在 10 秒内能识别出有物件可以点击」的实现
 *
 * 为什么需要它：粒子只在悬停时出现，等于"你得先把鼠标挪上去才知道能点"。
 * 呼吸是常驻的，不需要任何操作，第一眼就能看到"那三个东西在动"。
 *
 * 手法：让 emissiveIntensity 在基准值上下缓缓起伏。
 *   - 频率取很低（约 6.5 秒一个来回），像呼吸而不是闪烁
 *   - 三件物件用不同相位和时间倍率，避免整齐划一（整齐会显得像故障灯）
 *   - 已解锁的不再呼吸 —— 它已经"安静下来"，这也是 A7 区分两态的一部分
 */
export function updateBreathing(objects, elapsed) {
  objects.forEach((obj, i) => {
    const { material, unlocked, motePhase } = obj.userData
    if (!material) return

    // 已解锁：直接落在暗值上，不参与呼吸
    if (unlocked) {
      material.emissiveIntensity += (0.12 - material.emissiveIntensity) * 0.08
      return
    }

    // 时间倍率各不相同（0.85 / 1.0 / 1.18），三件物件错开
    const rate = 0.85 + i * 0.165
    const wave = Math.sin(elapsed * rate + motePhase * 0.3)

    // 基准 0.75，上下浮动 ±0.28 → 0.47 ~ 1.03
    const target = 0.75 + wave * 0.28
    material.emissiveIntensity += (target - material.emissiveIntensity) * 0.12
  })
}

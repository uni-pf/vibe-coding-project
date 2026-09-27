import * as THREE from 'three'
import backdropUrl from '../../art/sea-wind-backdrop.png?url'
import gauzeUrl from '../../art/sea-wind-gauze.png?url'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const ease = (v) => { const t = clamp(v, 0, 1); return t * t * (3 - 2 * t) }

function wallTexture(source) {
  const canvas = document.createElement('canvas')
  canvas.width = 768
  canvas.height = 1024
  const ctx = canvas.getContext('2d')
  const strip = Math.round(source.width * 0.11)
  ctx.fillStyle = '#17201b'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.globalAlpha = 0.5
  ctx.filter = 'blur(8px)'
  ctx.drawImage(source, 0, 0, strip, source.height, 0, 0, canvas.width, canvas.height)
  ctx.filter = 'none'
  ctx.globalAlpha = 1
  ctx.fillStyle = 'rgba(6, 12, 10, 0.42)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  let seed = 8317
  for (let i = 0; i < 6800; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const x = seed / 4294967296 * canvas.width
    seed = (seed * 1664525 + 1013904223) >>> 0
    const y = seed / 4294967296 * canvas.height
    ctx.fillStyle = i % 3 ? 'rgba(214, 202, 166, 0.025)' : 'rgba(2, 6, 5, 0.045)'
    ctx.fillRect(x, y, 1 + (i % 3), 1 + (i % 5))
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function paintingEdgeMask() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  const image = ctx.createImageData(256, 256)
  for (let y = 0; y < 256; y += 1) {
    for (let x = 0; x < 256; x += 1) {
      const left = ease(x / 42)
      const right = ease((255 - x) / 12)
      const top = ease(y / 9)
      const bottom = ease((255 - y) / 9)
      const opacity = Math.round(255 * left * right * top * bottom)
      const index = (y * 256 + x) * 4
      image.data[index] = opacity
      image.data[index + 1] = opacity
      image.data[index + 2] = opacity
      image.data[index + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  return new THREE.CanvasTexture(canvas)
}

function startWind() {
  const AudioContext = window.AudioContext || window.webkitAudioContext
  if (!AudioContext) return null
  const context = new AudioContext()
  const buffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate)
  const samples = buffer.getChannelData(0)
  let low = 0
  for (let i = 0; i < samples.length; i += 1) {
    low = low * 0.985 + (Math.random() * 2 - 1) * 0.015
    samples[i] = low
  }
  const source = context.createBufferSource()
  source.buffer = buffer
  source.loop = true
  const filter = context.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 210
  filter.Q.value = 0.45
  const gain = context.createGain()
  gain.gain.value = 0
  const pan = context.createStereoPanner()
  pan.pan.value = 0.72
  source.connect(filter).connect(gain).connect(pan).connect(context.destination)
  source.start()
  context.resume()
  gain.gain.setTargetAtTime(0.24, context.currentTime, 1.6)
  return { context, source, gain, pan }
}

function createGauze(texture) {
  const width = 4.4
  const height = 3.04
  const geometry = new THREE.PlaneGeometry(width, height, 96, 68)
  const base = Float32Array.from(geometry.attributes.position.array)
  const material = new THREE.MeshBasicMaterial({
    map: texture, transparent: true, opacity: 0.43,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  })
  const cloth = new THREE.Mesh(geometry, material)
  cloth.position.z = 0.35
  cloth.frustumCulled = false

  function update(time, lift) {
    const positions = geometry.attributes.position
    for (let i = 0; i < positions.count; i += 1) {
      const j = i * 3
      const x = base[j]
      const y = base[j + 1]
      const u = (x + width / 2) / width
      const falloff = Math.pow((height / 2 - y) / height, 1.35)
      const wave = lift * falloff * Math.sin(time * 2.7 + u * 19 + y * 4.5)
      const ripple = lift * falloff * Math.sin(time * 4.1 + u * 36 - y * 2.4)
      const restShift = falloff * (u < 0.59 ? 0.7 : 0.25)
      positions.array[j] = x + (1 - lift) * restShift + wave * 0.026
      positions.array[j + 1] = y + wave * 0.012 + ripple * 0.005
      positions.array[j + 2] = falloff * (0.11 + 0.07 * Math.sin(u * 14)) + wave * 0.045
    }
    positions.needsUpdate = true
  }
  update(0, 0)
  return { cloth, update }
}

export function createRoomScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#111813')
  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 30)
  camera.position.set(0, 0, 4.15)

  const cue = document.createElement('button')
  cue.className = 'wind-cue'
  cue.type = 'button'
  cue.innerHTML = '<span class="wind-cue__mark" aria-hidden="true">◌</span><span>听风</span>'
  cue.setAttribute('aria-label', '听见窗边的海风')
  container.appendChild(cue)

  const story = document.createElement('div')
  story.className = 'wind-story'
  story.innerHTML = '<span class="wind-story__age">十八岁</span><p>她听见风，第一次想起远方。</p>'
  container.appendChild(story)

  /* 一次性提示条：贴在按钮正下方，把"生效了"用文字说出口 */
  const toast = document.createElement('div')
  toast.className = 'wind-toast'
  toast.setAttribute('role', 'status')
  container.appendChild(toast)

  let gauze = null
  let wind = null
  let phase = 'listen'
  let turnedAt = 0
  let time = 0
  let frameId = null
  let progress = 0
  let targetProgress = 0
  let lastTime = 0
  let dragStart = null

  const ready = Promise.all([
    new THREE.TextureLoader().loadAsync(backdropUrl),
    new THREE.TextureLoader().loadAsync(gauzeUrl),
  ]).then(([painting, clothTexture]) => {
    painting.colorSpace = THREE.SRGBColorSpace
    clothTexture.colorSpace = THREE.SRGBColorSpace
    painting.anisotropy = renderer.capabilities.getMaxAnisotropy()
    clothTexture.anisotropy = renderer.capabilities.getMaxAnisotropy()

    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 7),
      new THREE.MeshBasicMaterial({ map: wallTexture(painting.image), toneMapped: false }),
    )
    wall.position.set(-7.5, 0, -0.03)
    scene.add(wall)

    scene.add(new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 3.04),
      new THREE.MeshBasicMaterial({
        map: painting, alphaMap: paintingEdgeMask(), transparent: true,
        depthWrite: false, toneMapped: false,
      }),
    ))
    gauze = createGauze(clothTexture)
    scene.add(gauze.cloth)
  })

  /* 指尖反馈：压陷（<100ms）+ 涟漪。键盘触发时 detail 为 0，涟漪落在按钮中心 */
  function pressFeedback(event) {
    cue.classList.remove('is-pressed')
    void cue.offsetWidth
    cue.classList.add('is-pressed')
    setTimeout(() => cue.classList.remove('is-pressed'), 160)

    const centered = !event || event.detail === 0
    const rect = cue.getBoundingClientRect()
    const ripple = document.createElement('span')
    ripple.className = 'wind-cue__ripple'
    ripple.style.left = centered ? '50%' : `${event.clientX - rect.left}px`
    ripple.style.top = centered ? '50%' : `${event.clientY - rect.top}px`
    ripple.addEventListener('animationend', () => ripple.remove())
    cue.appendChild(ripple)
  }

  let toastTimer = null
  function showToast(text) {
    toast.textContent = text
    toast.classList.add('is-visible')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600)
  }

  function onCueClick(event) {
    if (phase === 'listen') {
      phase = 'turn'
      cue.innerHTML = '<span class="wind-cue__mark" aria-hidden="true">↶</span><span>风已起 · 循声转向</span>'
      cue.setAttribute('aria-label', '海风已起，循着风声转向窗户')
      cue.classList.add('is-listening')
      pressFeedback(event)
      showToast('海风已起 · 循声转向')
      try { wind = startWind() } catch (error) { console.warn('海风音效启动失败', error) }
      return
    }
    if (phase === 'turn') {
      phase = 'turned'
      turnedAt = time
      pressFeedback(event)
      showToast('窗纱动了 · 拖动前行')
      cue.classList.add('is-gone')
      cue.disabled = true
      document.body.classList.add('is-turned')
      story.classList.add('is-visible')
      if (wind) {
        wind.pan.pan.setTargetAtTime(0, wind.context.currentTime, 0.75)
        wind.gain.gain.setTargetAtTime(0.34, wind.context.currentTime, 2)
      }
    }
  }
  cue.addEventListener('click', onCueClick)

  function onWheel(event) {
    if (phase !== 'turned') return
    const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 600 : 1
    targetProgress = clamp(targetProgress + event.deltaY * multiplier / 2300, 0, 1)
  }
  window.addEventListener('wheel', onWheel, { passive: true })

  function onPointerDown(event) {
    if (phase !== 'turned') return
    dragStart = { y: event.clientY, progress: targetProgress }
    renderer.domElement.setPointerCapture(event.pointerId)
  }
  function onPointerMove(event) {
    if (!dragStart) return
    targetProgress = clamp(
      dragStart.progress + (dragStart.y - event.clientY) / Math.min(container.clientHeight, 700) * 0.7,
      0, 1,
    )
  }
  function onPointerEnd(event) {
    dragStart = null
    if (renderer.domElement.hasPointerCapture(event.pointerId)) {
      renderer.domElement.releasePointerCapture(event.pointerId)
    }
  }
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('pointerup', onPointerEnd)
  renderer.domElement.addEventListener('pointercancel', onPointerEnd)

  function resize() {
    const width = container.clientWidth
    const height = container.clientHeight
    if (!width || !height) return
    renderer.setSize(width, height)
    camera.aspect = width / height
    camera.fov = width / height < 0.85 ? 54 : 43
    camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', resize)
  resize()

  function tick(now) {
    const delta = Math.min((now - lastTime) / 1000 || 0, 0.05)
    lastTime = now
    time += delta
    progress += (targetProgress - progress) * (1 - Math.exp(-3.2 * delta))

    const turn = phase === 'turned' ? ease((time - turnedAt) / 2.1) : 0
    camera.position.z = 4.15 - turn * 0.35 - progress * 0.4
    camera.rotation.set(0, THREE.MathUtils.lerp(0.66, 0.11, turn), 0)
    /* 起风幅度只在转向之后才从 0 升到 1。
       之前没判 phase：turnedAt 初始为 0，导致点击前 lift 就已经是 1（窗纱一直在飘），
       转向那一帧又瞬间掉回 0，垂坠偏移被整块加回来 —— 看上去就是"卡了一下"。 */
    const lift = phase === 'turned' ? ease((time - turnedAt - 0.08) / 1.65) : 0
    if (gauze) gauze.update(time, lift)
    renderer.render(scene, camera)
    frameId = requestAnimationFrame(tick)
  }

  return {
    scene, camera, renderer, ready,
    start() { if (frameId === null) frameId = requestAnimationFrame(tick) },
    resize,
    dispose() {
      if (frameId !== null) cancelAnimationFrame(frameId)
      window.removeEventListener('resize', resize)
      window.removeEventListener('wheel', onWheel)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerEnd)
      renderer.domElement.removeEventListener('pointercancel', onPointerEnd)
      cue.removeEventListener('click', onCueClick)
      cue.remove()
      story.remove()
      clearTimeout(toastTimer)
      toast.remove()
      if (wind) { wind.source.stop(); wind.context.close() }
      renderer.dispose()
    },
    setProgress(value) { progress = targetProgress = clamp(value, 0, 1) },
    getProgress: () => progress,
    turnToWindow() { if (phase === 'listen') onCueClick(); if (phase === 'turn') onCueClick() },
  }
}

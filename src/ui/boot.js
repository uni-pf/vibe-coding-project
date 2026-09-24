/**
 * 加载遮罩 —— PRD F1.4「加载过程有进度反馈，加载期间不出现空白页」
 *
 * 为什么需要它：Three.js 的渲染器初始化、材质编译、首帧渲染都需要时间。
 * 这段时间页面上什么都没有，用户看到的就是"白屏/黑屏"，会以为页面坏了。
 * 盖一层提示，把这段不可避免的等待变成"有交代的等待"。
 *
 * 关于"进度条"的诚实说明：
 *   本项目全部资源都是程序化生成（几何体 + 画布贴图），没有网络请求，
 *   所以没有真实的"下载了多少"可以汇报。这里的进度是按阶段推进的：
 *   分几个真实存在的准备阶段，每完成一个推进一格。
 *   不假装它是"文件下载进度"。
 */
const STAGES = [
  { at: 0, text: '正在建立场景' },
  { at: 34, text: '正在准备光线' },
  { at: 62, text: '正在布置物件' },
  { at: 88, text: '即将呈现' },
]

export function createBootLayer() {
  const el = document.createElement('div')
  el.className = 'boot'
  el.innerHTML = `
    <div class="boot-bar"><span data-role="bar"></span></div>
    <p class="boot-text" data-role="text">正在建立场景</p>
  `
  document.body.appendChild(el)

  const bar = el.querySelector('[data-role="bar"]')
  const text = el.querySelector('[data-role="text"]')

  let value = 0
  let done = false

  return {
    /** 推进到某个百分比（0-100），文字跟着阶段变 */
    setProgress(next) {
      if (done) return
      value = Math.max(value, Math.min(next, 100))
      bar.style.width = `${value}%`
      const stage = [...STAGES].reverse().find((s) => value >= s.at)
      if (stage) text.textContent = stage.text
    },

    /** 全部就绪：淡出并移除 */
    finish() {
      if (done) return
      done = true
      this.setProgress(100)
      bar.style.width = '100%'
      text.textContent = '进入房间'
      // 等淡出动画走完再从 DOM 移除，避免残留一层挡住鼠标
      setTimeout(() => {
        el.classList.add('is-done')
        setTimeout(() => el.remove(), 520)
      }, 180)
    },
  }
}

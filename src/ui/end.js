/**
 * 收束信号 —— PRD F5.2 / A6「3 件全部解锁后，出现明确的收尾内容或收束信号」
 *
 * 为什么单独做一层：PRD §2.2 说明了解锁是软引导、顺序自由，
 * 所以叙事顺序要靠内容本身承担。收束信号是这套设计的最后一块 ——
 * 它保证"看完了"是一个**由系统给出的明确状态**，而不是让用户自己猜"还有没有别的"。
 *
 * 触发时机：第三件物件的内容页关闭之后才出现。
 * 不在点击第三件时立刻弹出 —— 那时用户正在读第三篇配文，
 * 突然盖上收尾层会打断阅读。
 */
export function createEndLayer({ total, onReplay }) {
  const el = document.createElement('div')
  el.className = 'end-layer'
  el.setAttribute('aria-hidden', 'true')
  el.innerHTML = `
    <div class="end-panel">
      <p class="end-eyebrow">${total} / ${total} · 已探索完</p>
      <h2 class="end-title">这个房间里的三件东西，你都看过了</h2>
      <p class="end-body">
        当前是第一版可运行的 MVP：房间、三件物件、点击打开内容页、返回，这条闭环已经通了。
        内容页里的文字和配图还是占位 —— 它们要等角色设定稿定下来才能写。
      </p>
      <p class="end-body end-body--muted">
        后续会补上的：电影式镜头推进、滚动视差、真实模型与素材、移动端适配。
      </p>
      <div class="end-actions">
        <button class="end-btn end-btn--primary" type="button" data-role="replay">重新开始</button>
        <button class="end-btn" type="button" data-role="stay">留在房间</button>
      </div>
    </div>
  `
  document.body.appendChild(el)

  const close = () => {
    el.classList.remove('is-open')
    el.setAttribute('aria-hidden', 'true')
    document.body.classList.remove('has-overlay', 'is-reading')
  }

  el.querySelector('[data-role="stay"]').addEventListener('click', close)
  el.querySelector('[data-role="replay"]').addEventListener('click', () => {
    close()
    onReplay && onReplay()
  })

  function onKeydown(e) {
    if (e.key === 'Escape' && el.classList.contains('is-open')) close()
  }
  window.addEventListener('keydown', onKeydown)

  return {
    show() {
      el.classList.add('is-open')
      el.setAttribute('aria-hidden', 'false')
      // 与内容页同样的处理：这一层打开时画布让出鼠标事件
      document.body.classList.add('has-overlay', 'is-reading')
    },
    isOpen: () => el.classList.contains('is-open'),
    dispose() {
      window.removeEventListener('keydown', onKeydown)
      el.remove()
    },
  }
}

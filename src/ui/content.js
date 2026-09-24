/**
 * 内容页 —— PRD F4 的实现
 *
 * 这里体现 TECH_DESIGN §2.4 的域界划分：
 *   3D 场景负责「探索」，DOM 层负责「阅读」。
 *   内容页是一层盖在画布上的 DOM，不是画在 3D 里的文字 ——
 *   这样文字清晰、可选中、可滚动，而且将来做视差也方便。
 *
 * 本期只做：标题 + 配文 + 配图占位 + 返回按钮（F4.1 / F4.4）
 * 滚动视差是 PRD F4.3 的定档内容，属于后续迭代。
 */
export function createContentLayer() {
  // 页面骨架只建一次，之后每次打开只换里面的内容
  const el = document.createElement('div')
  el.className = 'content-layer'
  el.setAttribute('aria-hidden', 'true')
  el.innerHTML = `
    <article class="content-panel">
      <button class="content-back" type="button" aria-label="返回房间">
        <span aria-hidden="true">←</span> 返回房间
      </button>

      <p class="content-eyebrow">物件 <span data-role="index">01</span></p>
      <h2 class="content-title" data-role="title"></h2>

      <figure class="content-figure">
        <div class="content-image" data-role="image">
          <span data-role="caption"></span>
        </div>
      </figure>

      <p class="content-body" data-role="body"></p>

      <p class="content-note" data-role="note"></p>
    </article>
  `
  document.body.appendChild(el)

  const $ = (role) => el.querySelector(`[data-role="${role}"]`)
  const els = {
    index: $('index'),
    title: $('title'),
    image: $('image'),
    caption: $('caption'),
    body: $('body'),
    note: $('note'),
    back: el.querySelector('.content-back'),
  }

  let onClose = null   // 外部可选注册的"关闭后"回调（用于附加副作用，不是关闭本身）

  /**
   * 真正执行关闭。
   *
   * 设计上的一个教训：上一版把关闭动作完全托付给外部注册的 onClose，
   * 结果 main.js 里漏写了一行 content.onClose(...) ，
   * 按钮点下去 onClose 是 null，什么都不发生 —— 表现就是"返回没反应"。
   *
   * 所以现在把 close() 定义在这里，按钮直接调它，外部注册的回调只是"额外通知"。
   * 这样即使外部一行都不写，关闭功能依然成立。
   */
  function closePanel() {
    if (!el.classList.contains('is-open')) return
    el.classList.remove('is-open')
    el.setAttribute('aria-hidden', 'true')
    document.body.classList.remove('has-overlay')
    document.body.classList.remove('is-reading')
    if (typeof onClose === 'function') onClose()
  }

  els.back.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    closePanel()
  })

  // 点击遮罩空白处也能返回 —— 阅读长文时不用专门去找按钮
  el.addEventListener('click', (e) => {
    if (e.target === el) closePanel()
  })

  // 按 Esc 也能返回 —— 键盘用户的顺手路径
  function onKeydown(e) {
    if (e.key === 'Escape') closePanel()
  }
  window.addEventListener('keydown', onKeydown)

  return {
    element: el,

    /** 打开内容页并填入某件物件的内容 */
    open(definition, index, total) {
      els.index.textContent = String(index + 1).padStart(2, '0')
      els.title.textContent = definition.content.title
      els.body.textContent = definition.content.body
      els.caption.textContent = definition.content.caption
      // 配图占位色：用物件自己的颜色，视觉上跟房间里那件对得上
      els.image.style.setProperty('--obj-color', definition.color)

      // 收束提示：看完最后一件时给一句额外的话（PRD F5.2 / A6 的雏形）
      els.note.textContent =
        index === total - 1
          ? '三件物件都看完了。这就是本期 MVP 的完整闭环。'
          : ''

      el.classList.add('is-open')
      el.setAttribute('aria-hidden', 'false')
      // 内容页有自己的滚动条，打开时允许它滚动
      document.body.classList.add('has-overlay')
      // 内容页打开期间让 3D 画布停止接收鼠标事件（见 style.css 的 body.is-reading）
      document.body.classList.add('is-reading')
    },

    close: closePanel,

    isOpen: () => el.classList.contains('is-open'),

    /** 注册"关闭后"的附加回调，可选的 */
    onClose(fn) {
      onClose = fn
    },

    dispose() {
      window.removeEventListener('keydown', onKeydown)
      el.remove()
    },
  }
}

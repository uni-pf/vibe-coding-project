/**
 * 物件清单页入口 —— Day 8 · 板块③（mock 数据渲染）
 *
 * 这一步要证明的事：
 *   页面上的卡片不是手写死的，而是由一个数据数组渲染出来的。
 *   改 src/data/objects.js 里一个字，页面就跟着变 —— 不需要碰任何 HTML 与逻辑代码。
 *   （对应 PRD E1「加物件不改架构」、E2「物件与内容以数据配置形式存在」）
 *
 * 为什么直接用 src/data/objects.js，而不是另造一份"mock 数据"：
 *   那份文件本来就是本地静态数据、不来自网络 —— 它现在就是 mock 数据。
 *   另造一份假的，等于让"真数据"与"假数据"两套并存，
 *   将来接上真实数据源时还得回来删一遍，多一道没意义的手工活。
 *
 * 四种状态（清单里要掌握的那个问题就落在这里）：
 *   loading 数据还没到手
 *   ready   数据到手、且有条目
 *   empty   请求成功了，但一条都没有     ← 最容易漏掉的那个
 *   error   读取失败，给重试入口
 *
 * 为什么要人为留出加载时间：见 DELAY 处注释。
 */

import { objects as RAW_OBJECTS } from '../data/objects.js'

/** 状态容器与列表容器 */
const surface = document.querySelector('[data-role="surface"]')
const listEl = document.querySelector('[data-role="list"]')
const summaryEl = document.querySelector('[data-role="summary"]')
const retryBtn = document.querySelector('.cat-retry')

/**
 * 人为延迟，单位毫秒。
 *
 * 为什么要加：真实数据会有网络往返（几十到几百毫秒），加载态天然就会出现。
 * 本项目的数据在本地文件里，读起来是 0 毫秒 —— 加载态会一闪而过、等于看不见，
 * 那这个状态就永远没被人检验过。留一段固定延迟，是让加载态**看得见**，
 * 而不是假装数据来自网络。
 *
 * 想让它立刻出现，把这里改成 0。
 */
const DELAY = 420

/**
 * 取出数据（本期＝把本地数组返回出去）。
 *
 * 用 Promise + setTimeout 包一层，是为了让"将来换成真实请求"这件事零成本：
 * 真实请求本来就是异步的，接口形状一样，到时候只改这个函数体，
 * 下面渲染四态的代码一行都不用动。
 */
function fetchObjects() {
  return new Promise((resolve) => {
    setTimeout(() => resolve(RAW_OBJECTS), DELAY)
  })
}

/* ── 四态的切换：只改 data-state，剩下的交给 CSS ────────── */

function setState(next) {
  surface.dataset.state = next
  // 让辅助技术知道这块内容变了（视觉上靠 CSS 切换，读屏靠这句）
  surface.setAttribute('aria-busy', next === 'loading' ? 'true' : 'false')
}

/**
 * 由一条数据生成一张卡片。
 *
 * ⚠️ 这里用 createElement + textContent 逐层建节点，而不是拼 innerHTML 字符串。
 * 原因不是"高级写法"，是安全：数据里的文字将来可能来自外部文件或用户输入，
 * 拼字符串时文字里的 < 会被浏览器当成标签解析（这就是 XSS 的入口）。
 * textContent 会把内容当纯文本塞进去，标签不会被解析。
 * 现在数据是自己写的，看不出区别；换数据源那天，这个选择就是安全与不安全的分界。
 */
function createCard(item, index) {
  const li = document.createElement('li')
  li.className = 'obj-card'
  li.dataset.objectId = item.id
  // 把物件颜色作为 CSS 变量传下去，交给样式表决定怎么用
  li.style.setProperty('--obj-color', item.color)

  const thumb = document.createElement('div')
  thumb.className = 'obj-card__thumb'
  thumb.setAttribute('aria-hidden', 'true')

  const body = document.createElement('div')
  body.className = 'obj-card__body'

  const eyebrow = document.createElement('p')
  eyebrow.className = 'obj-card__index'
  eyebrow.textContent = `物件 ${String(index + 1).padStart(2, '0')}`

  const name = document.createElement('h2')
  name.className = 'obj-card__name'
  name.textContent = item.name

  const excerpt = document.createElement('p')
  excerpt.className = 'obj-card__excerpt'
  excerpt.textContent = item.content?.body ?? ''

  body.append(eyebrow, name, excerpt)
  li.append(thumb, body)
  return li
}

/** 把一批数据渲染成卡片列表 */
function renderList(items) {
  // 先清空：重试时会再走一遍这条路，不清会重复堆卡片
  listEl.replaceChildren()
  const frag = document.createDocumentFragment()
  items.forEach((item, index) => frag.appendChild(createCard(item, index)))
  listEl.appendChild(frag)
}

function renderSummary(count) {
  summaryEl.textContent = `共 ${count} 件`
}

/* ── 主流程 ─────────────────────────────────────────────── */

async function load() {
  setState('loading')

  try {
    const items = await fetchObjects()

    if (!Array.isArray(items) || items.length === 0) {
      // 请求没出错，但没东西可显示 —— 这是"空态"，不是错误
      renderSummary(0)
      setState('empty')
      return
    }

    renderList(items)
    renderSummary(items.length)
    setState('ready')
  } catch (err) {
    // 出错时把原因显示出来，而不是只给一句"出错了" —— 排障时省一半时间
    document.querySelector('[data-role="error-text"]').textContent =
      `数据读取失败：${err?.message ?? '未知原因'}。可以重试一次；若仍不行，请检查数据文件是否完整。`
    console.error('[catalog] 读取物件清单失败', err)
    setState('error')
  }
}

retryBtn.addEventListener('click', load)

/* ── 调试入口 ───────────────────────────────────────────────
   四种状态里，空态和错误态在正常数据下永远不会出现 ——
   换句话说，不故意制造一次，就永远没检验过它们。
   控制台里跑下面几行可以一个个看过：

     __catalog.setState('loading')   看加载态
     __catalog.setState('empty')     看空态
     __catalog.setState('error')     看错误态（重试按钮可点）
     __catalog.reload()              回到正常

   想永久地看空态：把 src/data/objects.js 里的数组清成 []，保存即生效。
──────────────────────────────────────────────────────────── */
window.__catalog = { setState, reload: load }

load()

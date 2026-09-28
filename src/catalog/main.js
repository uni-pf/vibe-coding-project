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

/* ── 筛选相关（Day 12）── */
const searchForm = document.querySelector('[data-role="search"]')
const inputEl = document.querySelector('#cat-q')
const clearBtn = document.querySelector('[data-role="clear"]')
const emptyTitleEl = document.querySelector('[data-role="empty-title"]')
const emptyTextEl = document.querySelector('[data-role="empty-text"]')

/**
 * 完整数据与当前关键词 —— 筛选用到的全部状态就这两个。
 *
 * 为什么要把"全集"单独存一份：
 *   筛选的本质是从全集里挑子集，挑完还要能挑回来。
 *   如果直接拿上次的结果继续筛（在筛过的结果里再筛），
 *   清空关键词时就回不到最初那 3 件了 —— 那是筛选功能最常见的坏法。
 *   所以：allItems 永远是不动的原始数据，每次筛选都从它重新开始。
 */
let allItems = []
let keyword = ''

/** 两种空态的文案。分开写，是为了不让"没数据"和"筛不到"混成一句话 */
const EMPTY_COPY = {
  none: {
    title: '这里还什么都没有',
    text: '物件清单是空的。往数据文件里加一件物件，它就会出现在这里——不需要改页面代码。',
  },
  noMatch: {
    title: '没有匹配的物件',
    // 恢复路径写在文案里：不然用户只知道"没了"，不知道下一步该干什么
    text: (kw) => `没有名字或配文里含「${kw}」的物件。换个词，或者清空关键词看全部。`,
  },
}

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
 * 把一段文字填进元素，命中关键词的部分套一层 <mark> 高亮。
 *
 * 为什么还要自己切字符串：筛选完一眼能看出"它是因为哪个词被留下来的"，
 * 否则三张卡片长得一样，用户得自己去猜匹配规则。
 *
 * ⚠️ 安全规则和下面 createCard 里一样：切出来的每一片都用
 * createTextNode / textContent 塞进去，不拼 innerHTML 字符串。
 * 数据里的文字将来可能带 < 之类的字符，拼字符串会被浏览器当标签解析。
 */
function fillHighlighted(el, text, kw) {
  el.replaceChildren()
  if (!kw) {
    el.textContent = text
    return
  }

  const haystack = text.toLowerCase()
  const needle = kw.toLowerCase()
  let cursor = 0
  let at = haystack.indexOf(needle, cursor)

  if (at === -1) {
    el.textContent = text
    return
  }

  const frag = document.createDocumentFragment()
  while (at !== -1) {
    if (at > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, at)))
    const mark = document.createElement('mark')
    mark.className = 'cat-mark'
    mark.textContent = text.slice(at, at + kw.length)
    frag.appendChild(mark)
    cursor = at + kw.length
    at = haystack.indexOf(needle, cursor)
  }
  if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)))
  el.appendChild(frag)
}

/**
 * 由一条数据生成一张卡片。
 *
 * @param index 这件物件在**原始全集**里的序号，不是筛选结果里的序号。
 *   为什么用原始序号：「物件 03」是这件东西在房间里的编号，是它自己的属性；
 *   筛掉前两件之后把它叫成「物件 01」，等于编号跟着筛选结果乱跳。
 *   两种做法都能解释得通，但必须明确选一种 —— 这里选"跟着物件走"。
 *
 * ⚠️ 这里用 createElement + textContent 逐层建节点，而不是拼 innerHTML 字符串。
 * 原因不是"高级写法"，是安全：数据里的文字将来可能来自外部文件或用户输入，
 * 拼字符串时文字里的 < 会被浏览器当成标签解析（这就是 XSS 的入口）。
 * textContent 会把内容当纯文本塞进去，标签不会被解析。
 * 现在数据是自己写的，看不出区别；换数据源那天，这个选择就是安全与不安全的分界。
 */
function createCard(item, index, kw = '') {
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
  fillHighlighted(name, item.name, kw)

  const excerpt = document.createElement('p')
  excerpt.className = 'obj-card__excerpt'
  excerpt.textContent = item.content?.body ?? ''

  body.append(eyebrow, name, excerpt)
  li.append(thumb, body)
  return li
}

/** 把筛选结果渲染成卡片列表。hits 形如 [{ item, index }]，index 是原始序号 */
function renderList(hits) {
  // 先清空：重试时会再走一遍这条路，不清会重复堆卡片
  listEl.replaceChildren()
  const frag = document.createDocumentFragment()
  hits.forEach(({ item, index }) => frag.appendChild(createCard(item, index, keyword)))
  listEl.appendChild(frag)
}

/**
 * 计数只在这一处生成。
 * 有筛选时给出"总数 / 命中数"两个数：只给命中数的话，
 * 用户看不出自己是在 3 件里筛出了 1 件，还是总共就 1 件。
 */
function renderSummary(total, shown, filtering) {
  summaryEl.textContent = filtering ? `共 ${total} 件 · 筛出 ${shown} 件` : `共 ${total} 件`
}

/** 一条数据算不算命中：名字或配文里含关键词就算，大小写不分 */
function matches(item, kw) {
  if (!kw) return true
  const haystack = `${item.name} ${item.content?.body ?? ''}`
  return haystack.toLowerCase().includes(kw.toLowerCase())
}

/**
 * 筛选的唯一入口：数据变了、关键词变了，都走这里重算一遍。
 *
 * 为什么只留一个入口而不是"输入时筛一次、清空时再写一遍恢复逻辑"：
 *   两条路径各写一遍，迟早有一边漏掉某个状态（典型是：清空后空态没消失）。
 *   统一成"读两个变量 → 重算全部可见内容"，任何一次变化都只是改变量再调它。
 *
 * 关于"快速输入再快速删除会不会错乱"：
 *   这里是同步计算、同步渲染，没有网络请求，不存在后发先至的竞态，
 *   所以敲多快结果都是最后一次输入对应的那一份。
 *   将来换成真实接口时，这一步要加请求序号或 AbortController。
 */
function applyFilter() {
  const hits = []
  allItems.forEach((item, index) => {
    if (matches(item, keyword)) hits.push({ item, index })
  })

  // 供 CSS 决定"计数行"在空态下要不要露出来（筛完没有匹配时也要显示"筛出 0 件"）
  surface.dataset.filtering = keyword ? 'on' : 'off'

  // 情况 A · 数据本来就是空的 —— 跟"筛不到"不是一回事，文案分开
  if (allItems.length === 0) {
    emptyTitleEl.textContent = EMPTY_COPY.none.title
    emptyTextEl.textContent = EMPTY_COPY.none.text
    renderSummary(0, 0, false)
    setState('empty')
    return
  }

  // 情况 B · 数据有，但这个词筛不出任何一件
  if (hits.length === 0) {
    emptyTitleEl.textContent = EMPTY_COPY.noMatch.title
    emptyTextEl.textContent = EMPTY_COPY.noMatch.text(keyword)
    renderSummary(allItems.length, 0, true)
    setState('empty')
    return
  }

  // 情况 C · 筛出结果
  renderList(hits)
  renderSummary(allItems.length, hits.length, Boolean(keyword))
  setState('ready')
}

/* ── 主流程 ─────────────────────────────────────────────── */

async function load() {
  setState('loading')

  try {
    const items = await fetchObjects()

    // 拿到全集之后，可见内容一律交给 applyFilter 决定 ——
    // 数据为空、筛不出、筛得出三种情况它都覆盖了，这里不要再分支一次
    allItems = Array.isArray(items) ? items : []
    applyFilter()
  } catch (err) {
    // 出错时把原因显示出来，而不是只给一句"出错了" —— 排障时省一半时间
    document.querySelector('[data-role="error-text"]').textContent =
      `数据读取失败：${err?.message ?? '未知原因'}。可以重试一次；若仍不行，请检查数据文件是否完整。`
    console.error('[catalog] 读取物件清单失败', err)
    setState('error')
  }
}

retryBtn.addEventListener('click', load)

/* ── 筛选交互 ─────────────────────────────────────────────── */

/** 把关键词清空并回到全集。点"清空"和按 Esc 走的是同一条路，行为不会分叉 */
function resetFilter() {
  inputEl.value = ''
  keyword = ''
  clearBtn.hidden = true
  applyFilter()
  // 焦点留在输入框：列表被整块重渲染之后，焦点很容易掉到 body，
  // 那样的话接着敲键盘就什么都没有了
  inputEl.focus()
}

// 输入即筛，不做防抖 —— 本地同步过滤，加防抖只会让手感变迟钝。
// （"输入事件"用 input 而不是 keyup：粘贴、输入法候选、鼠标右键粘贴都能覆盖到）
inputEl.addEventListener('input', () => {
  keyword = inputEl.value.trim()
  clearBtn.hidden = inputEl.value === ''
  applyFilter()
})

// Esc 清空：type="search" 的原生清除按钮各家浏览器行为不一致，自己补一个确定的
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && inputEl.value !== '') {
    e.preventDefault()
    resetFilter()
  }
})

// 表单里只有一个输入框时，回车会触发 submit 并刷新页面 —— 这里拦掉
searchForm.addEventListener('submit', (e) => {
  e.preventDefault()
})

clearBtn.addEventListener('click', resetFilter)

/* ── 调试入口 ───────────────────────────────────────────────
   四种状态里，空态和错误态在正常数据下永远不会出现 ——
   换句话说，不故意制造一次，就永远没检验过它们。
   控制台里跑下面几行可以一个个看过：

     __catalog.setState('loading')   看加载态
     __catalog.setState('empty')     看空态
     __catalog.setState('error')     看错误态（重试按钮可点）
     __catalog.reload()              回到正常

   想永久地看空态：把 src/data/objects.js 里的数组清成 []，保存即生效。

   筛选用（Day 12）：
     __catalog.filter('灯')          按关键词筛一次
     __catalog.filter('')            清空，回到全集
──────────────────────────────────────────────────────────── */
window.__catalog = {
  setState,
  reload: load,
  filter(kw) {
    inputEl.value = kw ?? ''
    keyword = inputEl.value.trim()
    clearBtn.hidden = inputEl.value === ''
    applyFilter()
  },
}

load()

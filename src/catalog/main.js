/**
 * 物件清单页入口 —— Day 8 建骨架 · Day 12 加筛选 · Day 17 改接真实接口
 *
 * 这一步要证明的事：
 *   页面上的卡片不是手写死的，而是由一个数据数组渲染出来的。
 *   改数据源里一个字，页面就跟着变 —— 不需要碰任何 HTML 与逻辑代码。
 *   （对应 PRD E1「加物件不改架构」、E2「物件与内容以数据配置形式存在」）
 *
 * ── Day 17 的变化：数据不再来自本地文件，而是来自 CloudBase 数据库 ──
 *   数据源换成了 /api/objects（云函数 haifeng-api 读 PostgreSQL，
 *   见 api-contract.md）。字段翻译集中在 src/data/api.js，
 *   本文件里渲染四态的那部分代码**一行都没动** ——
 *   这正是 Day 8 当初把取数包成 fetchObjects() 的用意：
 *   换数据源只替换这一个函数体。
 *
 *   接口不通时会降级到本地 src/data/objects.js，并在页面上标明"示例数据"。
 *
 * 四种状态（清单里要掌握的那个问题就落在这里）：
 *   loading 数据还没到手
 *   ready   数据到手、且有条目
 *   empty   请求成功了，但一条都没有     ← 最容易漏掉的那个
 *   error   读取失败，给重试入口
 */

import { loadObjects } from '../data/api.js'

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

/* ── 数据来源标识（Day 17）── */
const sourceEl = document.querySelector('[data-role="source"]')

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
    // Day 17：数据源已经从本地文件换成数据库，所以"往哪儿加"的说法也得跟着改 ——
    // 文案里指向一个已经不存在的地方（"数据文件"），比不说更误事
    text: '数据库里一件物件都没有。往 objects 表里插一行，刷新页面它就会出现——不需要改页面代码。',
  },
  noMatch: {
    title: '没有匹配的物件',
    // 恢复路径写在文案里：不然用户只知道"没了"，不知道下一步该干什么
    text: (kw) => `没有名字或配文里含「${kw}」的物件。换个词，或者清空关键词看全部。`,
  },
}

/**
 * 数据来源的文案。三种取值对应 api.js 返回的 source，外加读取中的初始态。
 *
 * 为什么要单独一处定义：这句话是"这张截图算不算证据"的判据。
 * 散着拼字符串，某天改了一处没改另一处，就会出现页面标"示例数据"但其实是真数据（或反过来）。
 */
const SOURCE_COPY = {
  loading: '数据来源：读取中…',
  api: '数据来源：CloudBase 数据库 · 实时读取 /api/objects',
  local: '数据来源：本地示例数据（接口不可用，已降级）',
}

function renderSource(source) {
  sourceEl.textContent = SOURCE_COPY[source] ?? SOURCE_COPY.local
  sourceEl.dataset.source = source
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
  // Day 17：接口 JOIN 出了所属阶段（chapters 表），这里一并显示。
  // 本地降级数据里没有 chapter 字段，所以加了判断 —— 降级时只是少一段字，不会报错。
  // 附带好处：这行字本身就是"数据来自数据库"的视觉证据 —— 本地数据压根没有它。
  eyebrow.textContent = item.chapter
    ? `物件 ${String(index + 1).padStart(2, '0')} · ${item.chapter.title} · ${item.chapter.subtitle}`
    : `物件 ${String(index + 1).padStart(2, '0')}`

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
  renderSource('loading')

  let result
  try {
    result = await loadObjects()
  } catch (err) {
    // api.js 内部已经把网络失败兜成"降级到本地数据"了，正常走不到这里。
    // 留着这条分支，是为了防"降级路径本身也炸了"——那种情况下坚决报错，
    // 不许把空列表当成"没有物件"展示出来（那是最容易骗过自己的假成功）。
    document.querySelector('[data-role="error-text"]').textContent =
      `数据读取失败：${err?.message ?? '未知原因'}。可以重试一次；若仍不行，请检查网络连接。`
    console.error('[catalog] 读取物件清单失败', err)
    setState('error')
    return
  }

  const { items, source } = result
  renderSource(source)

  // 拿到全集之后，可见内容一律交给 applyFilter 决定 ——
  // 数据为空、筛不出、筛得出三种情况它都覆盖了，这里不要再分支一次
  allItems = Array.isArray(items) ? items : []
  applyFilter()
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

   想永久地看空态：把 objects 表清空（Day 17 起数据来自数据库），刷新即生效。

   筛选用（Day 12）：
     __catalog.filter('灯')          按关键词筛一次
     __catalog.filter('')            清空，回到全集

   查数据来源（Day 17）：
     __catalog.source()              返回 'api' 或 'local'
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
  /** 当前数据来自接口还是本地降级 —— 判定"截图里的数据是不是真的"就看这个 */
  source() {
    return surface.ownerDocument.querySelector('[data-role="source"]').dataset.source
  },
}

load()

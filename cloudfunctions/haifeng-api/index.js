/**
 * haifeng-api —— 《海风》物件与收藏接口
 *
 * 归属：Day 17（读接口：GET /api/objects、GET /api/favorites）
 *       Day 18（写接口：POST /api/favorites）
 *       Day 22（改 / 删：PATCH /api/objects/:code、DELETE /api/objects/:code）
 *
 * 接口形状以项目根的 api-contract.md 为准；本文件与它不一致时，以契约文件为对的一方。
 *
 * ── Day 22 的两个设计决定（今天要掌握的就是它们）──
 * 1) DELETE 是**软删除**：不执行 SQL DELETE，只把 is_deleted 翻成 true，
 *    并记下 deleted_at。硬删除一旦执行，值就真的不在库里了 —— 页面上少一条，
 *    到底是有意删的还是误删的，事后无从判断。软删除把"不可逆"变成"可逆"。
 * 2) DELETE 还要**显式确认**（请求体里必须带 confirm: true）。
 *    软删除兜住"删错了"，确认兜住"手滑 / 重复触发"。
 *    两者不重叠：前者是存储层，后者是接口层。
 *
 * ── 为什么是「Event 函数 + 网关路由」而不是 HTTP 函数 ──
 *   两种函数类型的区别见 TECH_DESIGN：HTTP 函数要自己起 web server、监听 9000 端口、
 *   自带 scf_bootstrap，且**必须显式注入凭据**才能调 CloudBase 资源。
 *   而 Event 函数有免密运行路径，直接用 @cloudbase/node-sdk 就能读写库。
 *   本接口只是三个简单的读写端点，没有长连接、没有流式响应，
 *   所以选 Event 函数更省事，也少一处存凭据的地方（少一处泄密面）。
 *
 * ── 事件对象长什么样 ──
 *   经网关转发进来时，event 形如：
 *     {
 *       path: '/api/objects',        // 请求路径（可能带 ?limit=2）
 *       httpMethod: 'GET',
 *       queryStringParameters: { limit: '2' },
 *       headers: {...},
 *       body: '{"object_code":"obj-02"}',   // POST 时才有，是字符串
 *       isBase64Encoded: false,
 *     }
 *   返回值形如 { statusCode, headers, body }，body 必须是字符串。
 *   注意：**不要 return 整个 event / context / process.env** ——
 *   网关会在请求头里注入临时凭据，把它们回显出去等于泄密。
 *   本文件只回显自己挑选过的字段。
 */

'use strict'

const cloudbase = require('@cloudbase/node-sdk')

/* ── 数据库连接 ────────────────────────────────────────────
   只在冷启动后第一次请求时建连接，之后复用（函数实例会被复用，
   每次请求都 init 一遍是白开销）。
   环境 ID 的取值顺序：
     TCB_ENV / SCF_NAMESPACE —— 云函数运行时自动注入的环境变量
     SYMBOL_CURRENT_ENV     —— SDK 提供的"当前环境"占位符
   三个兜底是为了应对不同运行时版本注入的变量名差异。 */
const ENV_ID =
  process.env.TCB_ENV || process.env.SCF_NAMESPACE || cloudbase.SYMBOL_CURRENT_ENV

let rdb = null
function getDb() {
  if (!rdb) {
    const app = cloudbase.init({ env: ENV_ID })
    /**
     * ⚠️ 这里必须传 { database: 'public' }，不能写成 app.rdb()。
     *
     * 踩过的坑（实测报错 DATABASE_PGRST106 / Invalid schema: <环境ID>）：
     *   node-sdk 源码 src/cloudbase.ts 里 rdb 的实现是
     *     const { instance = 'default', database = envId } = options || {}
     *   也就是说，**不传 options 时 database 会默认取「环境 ID」**，
     *   然后被放进请求头 `Accept-Profile: <环境ID>` 发给 PostgREST。
     *   而 Accept-Profile 要的是 **schema 名**，CloudBase 的 REST 层只开放 public，
     *   于是服务端直接拒掉：Invalid schema: example-d3gz7b0wea9b8bb2e。
     *
     *   官方文档那页只写了 app.rdb()，照抄会 100% 复现这个错 ——
     *   文档漏了参数，实际调用必须带上 schema。这也说明：
     *   库怎么读，最后要看真实的 SDK 源码与运行时报错，不能只看文档示例。
     */
    rdb = app.rdb({ database: 'public' })
  }
  return rdb
}

/* ── 响应外壳 ───────────────────────────────────────────── */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  // Day 22：PATCH / DELETE 必须出现在这里。浏览器预检会拿这张表跟实际请求方法比对，
  // 少一个就跨域失败 —— 而 curl 不受影响，所以会出现"命令行 200、页面报 CORS"的迷惑现象。
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  // 验收动作里有"改库后刷新看变化"，任何缓存都会让这条验收失真
  'Cache-Control': 'no-store',
}

function respond(statusCode, payload) {
  return {
    isBase64Encoded: false,
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
    body: JSON.stringify(payload),
  }
}

/** 成功：{ ok: true, data } —— 契约 §0.2 */
function ok(data, statusCode = 200) {
  return respond(statusCode, { ok: true, data })
}

/** 失败：{ ok: false, error: { code, message } }，message 一定是中文 */
function fail(statusCode, code, message) {
  return respond(statusCode, { ok: false, error: { code, message } })
}

/* ── 服务端日志（Day 18 余力加练）─────────────────────────
   为什么打成一行 JSON 而不是散着 console.log：
   排查时要按 requestId 把"这一次请求"的几条日志串起来，
   一行一条记录，日志检索里可以直接按字段过滤。
   只记业务字段，不记请求头与完整请求体 —— 前者含凭据、后者可能含用户输入。 */
function logLine(fields) {
  try {
    console.log('[haifeng-api] ' + JSON.stringify(fields))
  } catch (e) {
    console.log('[haifeng-api] log failed')
  }
}

/* ── 入参解析 ───────────────────────────────────────────── */

/** 把请求路径归一成路由名：/api/objects、/objects 都得到 /objects */
function resolveRoute(event) {
  const raw = String(
    event.path || event.rawPath || (event.requestContext && event.requestContext.path) || '/'
  )
  let path = raw.split('?')[0]
  // 网关是否剥掉 /api 前缀取决于 EnablePathTransmission，
  // 两种都可能出现，所以两种都认 —— 少一个分支就会变成"路由都 404"
  if (path === '/api' || path.startsWith('/api/')) path = path.slice(4)
  path = path.replace(/\/+$/, '')
  return path === '' ? '/' : path
}

function resolveMethod(event) {
  const m =
    event.httpMethod || (event.requestContext && event.requestContext.httpMethod) || 'GET'
  return String(m).toUpperCase()
}

/**
 * 把归一化后的路径切成段：'/objects/obj-01' → ['objects', 'obj-01']
 * Day 22 需要路径参数（:code）才有了这个函数 —— 之前只判断"整条路径等于什么"，
 * 认不出 /objects/xxx 这种带尾巴的地址。
 * decodeURIComponent 包了 try：地址里出现孤立的 % 会抛 URIError，
 * 不接住就会变成 500（其实是调用方发错了地址，应当是 404）。
 */
function splitPath(path) {
  return String(path)
    .split('/')
    .filter((s) => s !== '')
    .map((s) => {
      try {
        return decodeURIComponent(s)
      } catch (e) {
        return s
      }
    })
}

/** 查询参数：优先用网关解析好的，其次从 path 里自取 */
function resolveQuery(event) {
  const out = {}
  const qs = event.queryStringParameters
  if (qs && typeof qs === 'object') {
    Object.keys(qs).forEach((k) => {
      if (qs[k] !== undefined && qs[k] !== null) out[k] = qs[k]
    })
  }
  const raw = String(event.path || event.rawPath || '')
  const at = raw.indexOf('?')
  if (at >= 0) {
    new URLSearchParams(raw.slice(at + 1)).forEach((v, k) => {
      out[k] = v
    })
  }
  return out
}

/** limit 参数：省略或非法一律视为"不限制"（契约 §1 请求参数） */
function parseLimit(raw) {
  if (raw === undefined || raw === null || raw === '') return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) return null
  return Math.min(n, 100)
}

/** 开关型 query 参数：只有 '1' / 'true' 算开，其它（含省略）都算关 —— 契约 §1 */
function isTruthyFlag(raw) {
  if (raw === undefined || raw === null) return false
  const s = String(raw).trim().toLowerCase()
  return s === '1' || s === 'true'
}

/** 解析请求体；返回 { parsed: boolean, value } */
function resolveBody(event) {
  let raw = event.body
  if (raw === undefined || raw === null || raw === '') return { parsed: true, value: {} }
  if (typeof raw === 'object') return { parsed: true, value: raw }
  if (event.isBase64Encoded) {
    try {
      raw = Buffer.from(String(raw), 'base64').toString('utf8')
    } catch (e) {
      return { parsed: false, value: null }
    }
  }
  try {
    const v = JSON.parse(raw)
    // 顶层必须是对象：JSON.parse('3') 合法但取不到字段，早点拦住比后面报 undefined 好
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      return { parsed: false, value: null }
    }
    return { parsed: true, value: v }
  } catch (e) {
    return { parsed: false, value: null }
  }
}

/* ── 字段转换 ───────────────────────────────────────────── */

/**
 * NUMERIC / SMALLINT 这类列经 PG 的 REST 层返回时可能是字符串
 * （实测 pos_x 回来是 "-1.900"）。
 * 直接把它当数字用，会让 Three.js 的坐标运算悄悄变成 NaN ——
 * 这种错不报错、只是画面上东西不见了，最难查。所以统一在这里转一次。
 */
function toNum(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const OBJECT_COLUMNS = [
  'id',
  'chapter_id',
  'code',
  'name',
  'shape',
  'pos_x',
  'pos_y',
  'pos_z',
  'route_start',
  'route_end',
  'color',
  'memory_title',
  'memory_body',
  'memory_caption',
  'sort_order',
  'is_deleted',
  'deleted_at',
].join(', ')

const CHAPTER_COLUMNS = 'id, slug, title, subtitle, painting_name, painting_year, status, sort_order'

function mapChapter(c) {
  return c
    ? {
        slug: c.slug,
        title: c.title,
        subtitle: c.subtitle,
        paintingName: c.painting_name,
        paintingYear: toNum(c.painting_year),
        status: c.status,
      }
    : null
}

function mapObject(row, chapterById) {
  const c = chapterById.get(row.chapter_id) || null
  return {
    code: row.code,
    name: row.name,
    shape: row.shape,
    color: row.color,
    position: [toNum(row.pos_x), toNum(row.pos_y), toNum(row.pos_z)],
    routeRange: [toNum(row.route_start), toNum(row.route_end)],
    sortOrder: toNum(row.sort_order),
    // Day 22：软删除状态。正常查询里恒为 false / null（过滤掉了），
    // 只有 include_deleted=1 时才会看到 true —— 那一行就是"数据还在，只是被标记了"的证据。
    isDeleted: row.is_deleted === true,
    deletedAt: row.deleted_at || null,
    // 说明：这里**没有** size 字段。objects 表没有对应列，接口不能凭空造 —— 见 api-contract.md §1 已知差异 1
    content: {
      title: row.memory_title,
      body: row.memory_body,
      caption: row.memory_caption,
    },
    chapter: mapChapter(c),
  }
}

/** 拿全 chapter 表做一个 id → chapter 的映射（两张表都是个位数行，多查一次比 JOIN 稳） */
async function loadChapterMap() {
  const chRes = await getDb().from('chapters').select(CHAPTER_COLUMNS).order('sort_order', { ascending: true })
  if (chRes.error) return { error: chRes.error }
  return { map: new Map((chRes.data || []).map((c) => [c.id, c])) }
}

/* ── 数据库错误识别 ─────────────────────────────────────── */

/** 唯一约束冲突（PG SQLSTATE 23505）—— 重复收藏的最终防线 */
function isUniqueViolation(err) {
  if (!err) return false
  const code = err.code || err.errorCode || (err.error && err.error.code)
  if (code === '23505') return true
  const msg = String(err.message || '')
  return msg.includes('duplicate key') || msg.includes('uq_favorites_object')
}

/**
 * 把数据库层的错误转成契约里的中文提示。
 *
 * 注意这里**只回显中文**，英文原文一律不进响应：
 * postgrest 的错误里会带 schema 名、表名、约束名等内部结构，
 * 公开暴露等于给扫描器送情报。原始错误走 logLine 进服务端日志。
 *
 * 排查期曾经临时把原始错误带回响应（否则日志服务未开通时完全盲调），
 * 定位完必须撤掉 —— 详见 memory 日志 2026-10-06 的记录。
 */
function dbFail(err) {
  return fail(500, 'DB_ERROR', '读取数据失败，请稍后重试。')
}

/* ── 各路由的处理函数 ───────────────────────────────────── */

async function listObjects(query) {
  const limit = parseLimit(query.limit)
  const includeDeleted = isTruthyFlag(query.include_deleted)

  let q = getDb()
    .from('objects')
    .select(OBJECT_COLUMNS)
    .order('sort_order', { ascending: true })
  // Day 22：默认把软删除的行挡掉。这一步是软删除能不能成立的关键 ——
  // 只在写入端打标记、不在读取端过滤，等于没删。
  if (!includeDeleted) q = q.eq('is_deleted', false)
  if (limit !== null) q = q.limit(limit)

  const objRes = await q
  if (objRes.error) {
    logLine({ step: 'listObjects.query', error: objRes.error.message, code: objRes.error.code })
    return dbFail(objRes.error)
  }

  const ch = await loadChapterMap()
  if (ch.error) {
    logLine({ step: 'listObjects.chapters', error: ch.error.message, code: ch.error.code })
    return dbFail(ch.error)
  }

  // 用代码做关联，而不是让数据库做 JOIN：
  // 两张表各只有个位数行数，多一次查询换来的是「不依赖 REST 层的嵌套语法」——
  // 一旦关联写法不被支持，报的错会很难看懂。简单可靠优先。
  const data = (objRes.data || []).map((row) => mapObject(row, ch.map))

  return ok(data)
}

async function listFavorites(query) {
  const limit = parseLimit(query.limit)

  let q = getDb()
    .from('favorites')
    .select('id, object_code, created_at')
    .order('created_at', { ascending: false })
  if (limit !== null) q = q.limit(limit)

  const favRes = await q
  if (favRes.error) {
    logLine({ step: 'listFavorites.query', error: favRes.error.message, code: favRes.error.code })
    return dbFail(favRes.error)
  }

  const rows = favRes.data || []
  if (rows.length === 0) return ok([])

  // 只查收藏涉及的那几件物件，不把整表拉回来
  const codes = Array.from(new Set(rows.map((r) => r.object_code)))
  const objRes = await getDb()
    .from('objects')
    .select('code, name, color, memory_title')
    .in('code', codes)
  if (objRes.error) {
    logLine({ step: 'listFavorites.objects', error: objRes.error.message, code: objRes.error.code })
    return dbFail(objRes.error)
  }
  const byCode = new Map((objRes.data || []).map((o) => [o.code, o]))

  const data = rows.map((r) => {
    const o = byCode.get(r.object_code) || null
    return {
      id: toNum(r.id),
      objectCode: r.object_code,
      objectName: o ? o.name : null,
      color: o ? o.color : null,
      createdAt: r.created_at,
    }
  })

  return ok(data)
}

async function createFavorite(event) {
  const bodyResult = resolveBody(event)
  if (!bodyResult.parsed) {
    return fail(400, 'INVALID_JSON', '请求体不是合法的 JSON，请检查后再提交。')
  }
  const body = bodyResult.value || {}

  const rawCode = body.object_code
  // 缺字段 / 空串归为同一类：对用户来说都是"没填"，不必区分
  if (rawCode === undefined || rawCode === null || String(rawCode).trim() === '') {
    return fail(400, 'MISSING_FIELD', '缺少必填字段：object_code（物件编码）。')
  }
  if (typeof rawCode !== 'string') {
    return fail(400, 'INVALID_FIELD_TYPE', '字段 object_code 必须是字符串。')
  }
  const code = rawCode.trim()

  // 第 1 层防线：先查物件是否存在 —— 不存在的编码直接存进去，
  // 会让 favorites 变成一堆指向虚空的指针（外键其实会拦，但报的是英文约束错误）
  const objRes = await getDb()
    .from('objects')
    .select('code, name, color')
    .eq('code', code)
    .limit(1)
  if (objRes.error) {
    logLine({ step: 'createFavorite.objectCheck', error: objRes.error.message, code: objRes.error.code })
    return dbFail(objRes.error)
  }
  const target = (objRes.data || [])[0]
  if (!target) {
    return fail(400, 'OBJECT_NOT_FOUND', `物件不存在：${code}。请从物件清单里选择一个。`)
  }

  // 第 2 层防线（体验层）：先查重，好给出带物件名的友好提示。
  // 注意它不是最终保障 —— 并发下两个请求可能都通过这一层，兜底的是下面的唯一约束。
  const dupRes = await getDb()
    .from('favorites')
    .select('id')
    .eq('object_code', code)
    .limit(1)
  if (dupRes.error) {
    logLine({ step: 'createFavorite.dupCheck', error: dupRes.error.message, code: dupRes.error.code })
    return dbFail(dupRes.error)
  }
  if ((dupRes.data || []).length > 0) {
    return fail(409, 'DUPLICATE_FAVORITE', `「${target.name}」已经在收藏里了，请勿重复提交。`)
  }

  // 写入。不传 _openid：身份由服务端/数据库决定，不由客户端上报
  // （匿名访客走列默认值 ''，与 api-contract.md §3 的口径一致）
  const insRes = await getDb()
    .from('favorites')
    .insert({ object_code: code })
    .select()
  if (insRes.error) {
    // 第 3 层防线：唯一约束 uq_favorites_object(object_code, _openid)
    if (isUniqueViolation(insRes.error)) {
      return fail(409, 'DUPLICATE_FAVORITE', `「${target.name}」已经在收藏里了，请勿重复提交。`)
    }
    logLine({ step: 'createFavorite.insert', error: insRes.error.message, code: insRes.error.code })
    return dbFail(insRes.error)
  }

  const row = (insRes.data || [])[0] || {}
  return ok({
    id: toNum(row.id),
    objectCode: code,
    objectName: target.name,
    createdAt: row.created_at || new Date().toISOString(),
  })
}

/* ── Day 22 · PATCH 的字段白名单 ────────────────────────────
   为什么用白名单而不是"过滤掉不该改的字段"：
   黑名单式过滤（删掉 id / code / chapter_id）防不住将来新增的敏感列，
   而且字段名拼错时症状是"接口 200 但值没变"—— 不报错、只是没生效，最难查。
   白名单 + 出现表外字段直接 400，把这两类问题都堵在第一道门。
   顺带明确：id / code / chapter_id / _openid 都不在表里，所以都改不了。 */
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/

function textField(name, maxLen) {
  return function (v) {
    if (v === null) return null // 允许置空：VARCHAR / TEXT 列都可空
    if (typeof v !== 'string') return ['INVALID_FIELD_TYPE', `字段 ${name} 必须是字符串或 null。`]
    if (maxLen && v.trim().length > maxLen) {
      return ['INVALID_FIELD_VALUE', `字段 ${name} 长度不能超过 ${maxLen} 个字符。`]
    }
    return null
  }
}

const PATCH_FIELDS = {
  name(v) {
    if (typeof v !== 'string') return ['INVALID_FIELD_TYPE', '字段 name 必须是字符串。']
    const s = v.trim()
    if (s.length < 1 || s.length > 64) {
      return ['INVALID_FIELD_VALUE', '字段 name 长度需在 1–64 个字符之间。']
    }
    return null
  },
  color(v) {
    if (typeof v !== 'string') return ['INVALID_FIELD_TYPE', '字段 color 必须是字符串。']
    if (!COLOR_RE.test(v)) return ['INVALID_FIELD_VALUE', '字段 color 必须是 #RRGGBB 形式，例如 #FFC97A。']
    return null
  },
  memory_title: textField('memory_title', 64),
  memory_body: textField('memory_body', null),
  memory_caption: textField('memory_caption', 128),
  sort_order(v) {
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      return ['INVALID_FIELD_TYPE', '字段 sort_order 必须是整数。']
    }
    if (v < 0 || v > 32767) return ['INVALID_FIELD_VALUE', '字段 sort_order 需在 0–32767 之间。']
    return null
  },
  is_deleted(v) {
    if (typeof v !== 'boolean') {
      return ['INVALID_FIELD_TYPE', '字段 is_deleted 必须是布尔值 true 或 false。']
    }
    return null
  },
}

/** 改完之后回写整条记录，调用方不必"再 GET 一次确认" */
async function updateObject(event, code) {
  const bodyResult = resolveBody(event)
  if (!bodyResult.parsed) {
    return fail(400, 'INVALID_JSON', '请求体不是合法的 JSON，请检查后再提交。')
  }
  const body = bodyResult.value || {}

  const keys = Object.keys(body)
  const unknown = keys.filter((k) => !Object.prototype.hasOwnProperty.call(PATCH_FIELDS, k))
  if (unknown.length > 0) {
    return fail(400, 'UNKNOWN_FIELD', `不支持修改字段：${unknown[0]}。`)
  }
  if (keys.length === 0) {
    return fail(400, 'MISSING_FIELD', '没有需要修改的字段，请至少提供一个。')
  }

  const patch = {}
  for (const key of keys) {
    const err = PATCH_FIELDS[key](body[key])
    if (err) return fail(400, err[0], err[1])
    const v = body[key]
    // 文本字段顺手去首尾空白（memory_body 除外：正文里的换行与缩进可能是有意的）
    patch[key] = typeof v === 'string' && key !== 'memory_body' ? v.trim() : v
  }

  // 软删除标记与删除时间必须成对维护，否则会出现"标记为已删除但没有删除时间"的脏状态。
  // 找回（is_deleted: false）时要把 deleted_at 清回 NULL，
  // 否则统计数据会把一条活着的记录算成"删过"。
  if (patch.is_deleted === true) patch.deleted_at = new Date().toISOString()
  else if (patch.is_deleted === false) patch.deleted_at = null

  const updRes = await getDb()
    .from('objects')
    .update(patch)
    .eq('code', code)
    .select(OBJECT_COLUMNS)
  if (updRes.error) {
    logLine({ step: 'updateObject.update', error: updRes.error.message, code: updRes.error.code })
    return dbFail(updRes.error)
  }

  // 注意：这里**不带** is_deleted 过滤 —— 已软删除的行仍然可以被改，
  // 否则"找回"这条路就被自己堵死了。改不存在的 code 才是 404。
  const row = (updRes.data || [])[0]
  if (!row) return fail(404, 'OBJECT_NOT_FOUND', `物件不存在：${code}。`)

  const ch = await loadChapterMap()
  if (ch.error) {
    logLine({ step: 'updateObject.chapters', error: ch.error.message, code: ch.error.code })
    return dbFail(ch.error)
  }
  return ok(mapObject(row, ch.map))
}

/* ── Day 22 · DELETE（软删除 + 显式确认）────────────────────
   三层防护，缺一不可（契约 §5 有完整说明）：
     ① 接口层 confirm:true —— 防手滑、防重复触发
     ② 存储层 UPDATE is_deleted —— 不执行 SQL DELETE，留可逆余地
     ③ 读取层 GET 过滤 —— 让"已删除"在正常查询里真的消失 */
async function deleteObject(event, code) {
  const bodyResult = resolveBody(event)
  if (!bodyResult.parsed) {
    return fail(400, 'INVALID_JSON', '请求体不是合法的 JSON，请检查后再提交。')
  }
  const body = bodyResult.value || {}

  // 必须是布尔 true。写成字符串 "true"、数字 1 都不放过 ——
  // 确认这件事上，"差不多算确认"就等于没有确认。
  if (body.confirm !== true) {
    return fail(400, 'CONFIRM_REQUIRED', '删除需要确认：请在请求体里传 {"confirm": true}。')
  }

  // 先读一次：拿到 name 用于回执，同时把"不存在"和"已删除"分开判断。
  // 已删除的再删一次返回 404 —— 第二次什么也没发生，按 HTTP 语义就该报"要删的东西不在"。
  const curRes = await getDb()
    .from('objects')
    .select('code, name, is_deleted')
    .eq('code', code)
    .limit(1)
  if (curRes.error) {
    logLine({ step: 'deleteObject.select', error: curRes.error.message, code: curRes.error.code })
    return dbFail(curRes.error)
  }
  const target = (curRes.data || [])[0]
  if (!target || target.is_deleted === true) {
    return fail(404, 'OBJECT_NOT_FOUND', `物件不存在或已删除：${code}。`)
  }

  const deletedAt = new Date().toISOString()
  const updRes = await getDb()
    .from('objects')
    .update({ is_deleted: true, deleted_at: deletedAt })
    .eq('code', code)
    .select('code, name, is_deleted, deleted_at')
  if (updRes.error) {
    logLine({ step: 'deleteObject.update', error: updRes.error.message, code: updRes.error.code })
    return dbFail(updRes.error)
  }
  const row = (updRes.data || [])[0] || {}

  return ok({
    code,
    name: target.name,
    deleted: true,
    // 明确告诉调用方"这是软删除，可以撤销" —— 让调用方有据可依，而不是靠猜
    softDeleted: true,
    deletedAt: row.deleted_at || deletedAt,
  })
}

/* ── 入口 ───────────────────────────────────────────────── */

exports.main = async (event, context) => {
  const started = Date.now()
  const method = resolveMethod(event)
  const route = resolveRoute(event)
  const requestId =
    (context && (context.request_id || context.requestId)) || event.requestId || null

  // 预检请求：网关把 OPTIONS 也转进来了，必须由函数自己答，否则浏览器直接判定跨域失败
  if (method === 'OPTIONS') {
    return { isBase64Encoded: false, statusCode: 204, headers: CORS_HEADERS, body: '' }
  }

  let res
  try {
    // Day 22：路由从"整条路径相等"改成"按段匹配"，
    // 因为要看 /objects/:code 这种带路径参数的地址。
    const seg = splitPath(route)
    const head = seg[0] || ''
    const isCollection = seg.length === 1
    const isItem = seg.length === 2
    const code = head === 'objects' && isItem ? seg[1] : null

    if (route === '/' && method === 'GET') {
      // 根路径给一份路由清单：接口调不通时，先访问它就能确认"函数活着没有"
      res = ok({
        service: 'haifeng-api',
        routes: [
          { method: 'GET', path: '/api/objects', note: '物件清单，支持 ?limit=n 与 ?include_deleted=1' },
          { method: 'GET', path: '/api/favorites', note: '收藏列表，支持 ?limit=n' },
          { method: 'POST', path: '/api/favorites', note: '新增收藏，body: { object_code }' },
          { method: 'PATCH', path: '/api/objects/:code', note: '修改物件，body: 白名单字段（见 api-contract §4）' },
          { method: 'DELETE', path: '/api/objects/:code', note: '软删除物件，body: { confirm: true }' },
        ],
      })
    } else if (head === 'objects' && isCollection && method === 'GET') {
      res = await listObjects(resolveQuery(event))
    } else if (head === 'favorites' && isCollection && method === 'GET') {
      res = await listFavorites(resolveQuery(event))
    } else if (head === 'favorites' && isCollection && method === 'POST') {
      res = await createFavorite(event)
    } else if (code && method === 'PATCH') {
      res = await updateObject(event, code)
    } else if (code && method === 'DELETE') {
      res = await deleteObject(event, code)
    } else if (head === 'objects' && isItem && (method === 'PUT' || method === 'POST')) {
      // PUT 不在契约里：整体替换与 PATCH 的"只改提到的字段"是两种语义，
      // 混用会让人误以为没提到的字段也会被清空。明确拒绝比含糊接受好。
      res = fail(405, 'METHOD_NOT_ALLOWED', `路径 ${route} 不支持 ${method} 方法，修改请用 PATCH。`)
    } else if ((head === 'objects' || head === 'favorites') && seg.length <= 2) {
      // 路径认得、方法不认 —— 405 比 404 准确：能让调用方分清"我打错地址了"
      // 还是"我方法用错了"
      res = fail(405, 'METHOD_NOT_ALLOWED', `路径 ${route} 不支持 ${method} 方法。`)
    } else {
      res = fail(404, 'ROUTE_NOT_FOUND', `接口不存在：${route}。`)
    }
  } catch (err) {
    // 兜底：任何没被上面接住的异常都在这里转成契约里的 500，不让函数直接抛栈
    logLine({
      step: 'unhandled',
      error: err && err.message,
      stack: err && err.stack ? String(err.stack).split('\n').slice(0, 3).join(' | ') : null,
    })
    res = fail(500, 'INTERNAL_ERROR', '服务端处理失败，请稍后重试。')
  }

  logLine({
    requestId,
    method,
    route,
    status: res.statusCode,
    ms: Date.now() - started,
    ok: res.statusCode < 400,
  })

  return res
}

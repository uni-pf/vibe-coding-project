/**
 * haifeng-api —— 《海风》物件与收藏接口
 *
 * 归属：Day 17（读接口：GET /api/objects、GET /api/favorites）
 *       Day 18（写接口：POST /api/favorites）
 *
 * 接口形状以项目根的 api-contract.md 为准；本文件与它不一致时，以契约文件为对的一方。
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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
].join(', ')

const CHAPTER_COLUMNS = 'id, slug, title, subtitle, painting_name, painting_year, status, sort_order'

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
    // 说明：这里**没有** size 字段。objects 表没有对应列，接口不能凭空造 —— 见 api-contract.md §1 已知差异 1
    content: {
      title: row.memory_title,
      body: row.memory_body,
      caption: row.memory_caption,
    },
    chapter: c
      ? {
          slug: c.slug,
          title: c.title,
          subtitle: c.subtitle,
          paintingName: c.painting_name,
          paintingYear: toNum(c.painting_year),
          status: c.status,
        }
      : null,
  }
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

  let q = getDb()
    .from('objects')
    .select(OBJECT_COLUMNS)
    .order('sort_order', { ascending: true })
  if (limit !== null) q = q.limit(limit)

  const objRes = await q
  if (objRes.error) {
    logLine({ step: 'listObjects.query', error: objRes.error.message, code: objRes.error.code })
    return dbFail(objRes.error)
  }

  const chRes = await getDb()
    .from('chapters')
    .select(CHAPTER_COLUMNS)
    .order('sort_order', { ascending: true })
  if (chRes.error) {
    logLine({ step: 'listObjects.chapters', error: chRes.error.message, code: chRes.error.code })
    return dbFail(chRes.error)
  }

  // 用代码做关联，而不是让数据库做 JOIN：
  // 两张表各只有个位数行数，多一次查询换来的是「不依赖 REST 层的嵌套语法」——
  // 一旦关联写法不被支持，报的错会很难看懂。简单可靠优先。
  const chapterById = new Map((chRes.data || []).map((c) => [c.id, c]))
  const data = (objRes.data || []).map((row) => mapObject(row, chapterById))

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
    if (route === '/' && method === 'GET') {
      // 根路径给一份路由清单：接口调不通时，先访问它就能确认"函数活着没有"
      res = ok({
        service: 'haifeng-api',
        routes: [
          { method: 'GET', path: '/api/objects', note: '物件清单，支持 ?limit=n' },
          { method: 'GET', path: '/api/favorites', note: '收藏列表，支持 ?limit=n' },
          { method: 'POST', path: '/api/favorites', note: '新增收藏，body: { object_code }' },
        ],
      })
    } else if (route === '/objects' && method === 'GET') {
      res = await listObjects(resolveQuery(event))
    } else if (route === '/favorites' && method === 'GET') {
      res = await listFavorites(resolveQuery(event))
    } else if (route === '/favorites' && method === 'POST') {
      res = await createFavorite(event)
    } else if (route === '/objects' || route === '/favorites') {
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

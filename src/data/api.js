/**
 * 数据源适配层 —— Day 17 · 板块①（前端接接口）
 *
 * 这个文件只干一件事：把「接口返回的那一行」翻译成「页面认得的那个物件对象」。
 *
 * ── 为什么要单独一个文件，而不直接在 main.js 里 fetch ──
 *   因为接口的字段名与表结构对不上、和前端本地数据的字段名也对不上，
 *   这层翻译必然存在。放在 main.js 里会让「渲染逻辑」和「字段映射」缠在一起，
 *   以后接口加一个字段，要在一堆 DOM 操作中间找那一行。
 *
 * ── 三套名字，一张对照表（Day 17 要掌握的那个"对不上"就在这）──
 *
 *   | 语义       | 数据库列                    | 接口字段                          | 前端字段        |
 *   |------------|-----------------------------|-----------------------------------|-----------------|
 *   | 物件编号   | objects.code                | code                              | id              |
 *   | 三维坐标   | pos_x / pos_y / pos_z       | position: [x, y, z]               | position: [...]  |
 *   | 交互区间   | route_start / route_end     | routeRange: [a, b]                | routeRange: [..] |
 *   | 回忆标题   | memory_title                | content.title                     | content.title    |
 *   | 回忆正文   | memory_body                 | content.body                      | content.body     |
 *   | 回忆配图   | memory_caption              | content.caption                   | content.caption  |
 *   | 尺寸参数   | ❌ 表里没有这一列            | ❌ 接口不返回                      | size: {...}      |
 *
 *   最后一行是真的"缺"：前端 3D 场景要用 size 建几何体，
 *   但建表时漏了这个字段，接口无从提供。它现在只能是 undefined。
 *   这不是映射能解决的问题，得靠一次 ALTER TABLE 补列 —— 记入待办。
 */

import { objects as LOCAL_FALLBACK } from './objects.js'

/**
 * 接口地址。
 *
 * 域名是环境 example-d3gz7b0wea9b8bb2e 的默认 HTTP 网关域名，
 * /api 是由网关路由指到云函数 haifeng-api 的前缀（见 api-contract.md §0.1）。
 *
 * 为什么写死在这里而不是 import.meta.env：
 *   这个域名不含密钥，公开可见无害；而且它跟着"环境"走，
 *   换环境时本来就要改配置。等有了正式域名再接环境变量更合适。
 */
export const API_BASE =
  'https://example-d3gz7b0wea9b8bb2e-1500064837.ap-shanghai.app.tcloudbase.com/api'

/** 把接口的一条物件转成前端认得的形状 */
function toLocalObject(row) {
  return {
    id: row.code, // 接口叫 code，前端叫 id
    name: row.name,
    shape: row.shape,
    color: row.color,
    position: row.position, // 接口已把 pos_x/y/z 合成数组，且已转成数字
    routeRange: row.routeRange,
    // size：表里没有对应列，接口不返回 → 只能是 undefined（见文件头对照表）
    size: undefined,
    content: {
      title: row.content?.title ?? row.name,
      body: row.content?.body ?? '',
      caption: row.content?.caption ?? '',
    },
    // chapter 是接口 JOIN 出来的，本地数据里原本没有这一项
    chapter: row.chapter ?? null,
  }
}

/** 请求接口；任何一步不对就抛错，交给调用方决定降级 */
async function fetchFromApi() {
  const res = await fetch(`${API_BASE}/objects`, { headers: { Accept: 'application/json' } })

  // 注意：不能只看 res.ok。HTTPS 200 也可能是业务失败（ok: false），
  // 所以状态码和响应体两个都要验，少一个就会出现"接口报错但页面显示 0 件"的假成功。
  if (!res.ok) throw new Error(`接口返回 HTTP ${res.status}`)

  const payload = await res.json()

  // 形状校验：契约里成功一定是 { ok: true, data: [...] }
  // 这里拦一道，是为了让"接口偷偷改了形状"在接缝处就暴露，
  // 而不是等到渲染时某个字段是 undefined、页面上少一段文字，没人发现
  if (!payload || payload.ok !== true || !Array.isArray(payload.data)) {
    throw new Error('接口返回的形状与 api-contract.md 不一致')
  }

  return payload.data.map(toLocalObject)
}

/**
 * 取物件清单。返回 { items, source }，source 为 'api' | 'local'。
 *
 * 降级策略（对应任务清单里的"卡住降级"）：
 *   接口不通时用本地 src/data/objects.js 兜底，页面照常显示，
 *   但会明确标出"示例数据" —— 静默吞掉错误比报错更糟：
 *   看页面的人会以为看到的是真数据。
 */
export async function loadObjects() {
  try {
    const items = await fetchFromApi()
    return { items, source: 'api', error: null }
  } catch (error) {
    console.warn('[data] 接口读取失败，降级到本地示例数据：', error)
    return { items: LOCAL_FALLBACK, source: 'local', error }
  }
}

/**
 * Day 23 · 三类错误提示统一 —— 实测脚本
 *
 * 跑法（项目根目录）：node evidence/day23-error-cases.mjs
 * 原理：monkeypatch global.fetch，把「断网 / 接口 500 / 返回形状不对」三类故障
 *       依次注入给 src/data/api.js 的 loadObjects()，看它抛出的 message 是不是中文。
 * 这不是模拟测试替身取代真接口 —— 真接口的三类服务端错误已由 api-contract 的
 * 21 用例覆盖（Day 22 证据）；这里验的是前端适配层对三类故障的对外文案。
 */
import { loadObjects } from '../src/data/api.js'

const realFetch = globalThis.fetch
const cases = [
  {
    name: '① 网络层失败（断网 / DNS 失败，浏览器原文 Failed to fetch）',
    fake: () => Promise.reject(new TypeError('Failed to fetch')),
  },
  {
    name: '② 接口返回 HTTP 500（服务端错误）',
    fake: () => Promise.resolve(new Response('server down', { status: 500 })),
  },
  {
    name: '③ 返回 200 但形状与契约不符（ok:false）',
    fake: () =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: false, error: { code: 'DB_ERROR', message: 'x' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
  },
]

let pass = 0
for (const c of cases) {
  globalThis.fetch = c.fake
  const r = await loadObjects()
  const msg = r.error ? r.error.message : '(没有 error)'
  // 判定：message 以中文开头、不含浏览器英文原文（Failed to fetch）即算中文提示。
  // 「接口返回 HTTP 500」里的 HTTP 500 是状态码本体，属于要保留的信息，不算英文报错。
  const ok = r.source === 'local' && /^[\u4e00-\u9fa5]/.test(msg) && !/Failed to fetch/i.test(msg)
  // 英文原文应只进 cause，不进 message
  const causeKept = r.error?.cause ? '（英文原文已留在 error.cause）' : ''
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}\n      message → ${msg} ${causeKept}\n      source  → ${r.source}`)
  if (ok) pass++
}
globalThis.fetch = realFetch
console.log(`\n${pass}/${cases.length} 类错误提示均为中文`)
process.exit(pass === cases.length ? 0 : 1)

# Day 21 · 第 3 周验收表 + 同伴交叉验证 + 演示提纲

> 验收日期：2026-10-07 22:17–22:45（所有证据均为当日实测取回，非推断）
> 被测对象：《海风》物件清单 + CloudBase 后端（EnvId `example-d3gz7b0wea9b8bb2e`）
> 周范围口径：本仓库本周实际产出 = Day 16（数据库）/ Day 17（读接口）/ Day 18（写接口）；Day 19–20 无产物，如实标记
> 图例：✅ 通过 ｜ ⚠️ 部分/降级 ｜ ❌ FAIL

---

## 区块一 · 周验收表（逐项有证据）

| # | 验收项 | 状态 | 证据 |
|---|---|---|---|
| W1 | 数据库表结构建成：3 表 + 外键 + 唯一约束 | ✅ | `db/schema.sql`；`cloudbase/migrations/20261006191008_create_core_schema.sql`；2026-10-07 只读 SQL 实测行数 **chapters=5 / objects=5 / favorites=5** |
| W2 | 种子数据可重复执行（幂等） | ✅ | `db/seed.sql`（`ON CONFLICT` 写法）；Day 16 实测重跑后行数 5/5/2 未翻倍 |
| W3 | 权限双层 GRANT + RLS（含匿名访客） | ✅ | `cloudbase/migrations/20261006191200_grant_and_rls.sql`；`cloudbase/migrations/20261006192353_grant_favorites_anon.sql` |
| W4 | 接口公网可访问（GET 读） | ✅ | `https://example-d3gz7b0wea9b8bb2e-1500064837.ap-shanghai.app.tcloudbase.com/api/objects` → **HTTP 200**；`day21-01-api-objects.json`（5 条真实物件） |
| W5 | 真实写入 → 落库 → 读回（毫秒级一致） | ✅ | `day21-04-post-new.json`：**id=6，createdAt=2026-10-07T22:17:14.043172+08:00** → `day21-05-favorites-after.json` 读回同一行同一毫秒；DB 行数 4→5 |
| W6 | 重复写入拦截：409 + 中文提示 | ✅ | `day21-06-post-duplicate.json`：`「朝海的窗（预告）」已经在收藏里了，请勿重复提交。` |
| W7 | 缺字段校验：400 + 中文提示 | ✅ | `day21-07-post-missing.json`：`缺少必填字段：object_code（物件编码）。` |
| W8 | 路径/方法兜底：404 / 405 中文 | ✅ | `day21-08-404.json`；`day21-09-405.json` |
| W9 | 前端接通真实数据（来源徽标 + JOIN 字段上屏） | ✅ | `day21-11-page-public.png`（共 5 件 · 数据来源：CloudBase 数据库）；`day21-12-page-dom.html`（渲染后 DOM） |
| W10 | 接口契约先行（先改契约再改代码） | ✅ | `api-contract.md` §0.2（状态码与 ok 一致的硬规则）、§4（错误码总表） |
| W11 | 页面运行无报错 | ⚠️ 部分 | `day21-13-page-console.txt`：**无 JS 异常**；唯一一条 404 来自浏览器自动请求 `/favicon.ico`（页面 4 个资源全部 200，见 day21-http-status.txt）→ **记入下周**，今日不修 |
| W12 | `objects` 表补 `size` 列（Day 17 发现的真实缺字段） | ❌ FAIL | 未做：需 `ALTER TABLE`，属改表结构、未获授权。影响：接口不返回 `size`，3D 场景按 undefined 处理 |
| W13 | Day 19–20 产出 | ❌ FAIL | 仓库无 Day 19/20 的任何文件与提交（最后一次提交为 Day 18 `7a25911`）→ **未执行** |
| W14 | 同伴（真人）交叉验证 | ⚠️ 降级 | 无真人同伴参与；由**独立 AI 复核**替代（见区块二），对应今日清单「卡住降级」路径 |
| W15 | 演示提纲写出并完整走通一遍 | ✅ | 见区块三；四段全部实际执行，走通记录附于提纲末尾 |

### 当日接口实测状态码（day21-http-status.txt 全文）

```
GET /api/objects                       | 200 | 2.27s
GET /api/objects?limit=2               | 200 | 0.58s
GET /api/favorites (写入前)             | 200 | 0.59s
POST /api/favorites obj-05 (新)         | 200 | 0.64s
GET /api/favorites (写入后读回)         | 200 | 0.54s
POST obj-05 (重复)                      | 409 | 0.52s
POST {} (缺字段)                        | 400 | 0.52s
GET /api/nope                          | 404 | 0.58s
DELETE /api/objects                    | 405 | 0.40s
GET catalog.html                       | 200 | 0.82s
```

10/10 状态码与 `api-contract.md` 的约定一致，无任何 5xx。

---

## 区块二 · 同伴交叉验证（三行结论）

> 复核人：**独立 AI 会话**（全新上下文，未读取主执行方的任何结论与证据文件，独立执行 curl 取证后给出结论）。
> **如实说明：本次无真人同伴参与**，属今日清单「卡住降级」条款的替代路径；若后续有同学复核，可在本表追加一行真人结论。

| 结论 | 判定 | 一句证据（复核人实际执行的命令 + 关键返回） |
|---|---|---|
| 可打开 | **PASS** | `curl -s -o /dev/null -w "%{http_code}" .../catalog.html` → `200`；`curl -s .../catalog.html \| grep -o "<title>[^<]*</title>"` → `<title>物件清单 · 3D 探索房间</title>` |
| 可读写 | **PASS** | `GET /api/favorites` 含 `{"id":6,"objectCode":"obj-05","createdAt":"2026-10-07T22:17:14.043172+08:00"}`（确为当天写入并落库）；`POST {"object_code":"obj-05"}` → `HTTP 409` + `DUPLICATE_FAVORITE` 中文提示 |
| 无报错 | **PASS** | `GET /api/objects` → `ok:true`，`code/name/position/chapter.title` 各 5 条齐全；批量探测 `200/200/200/409`，全程无 5xx |

复核人「意外发现」栏：**无**。

---

## 区块三 · 演示提纲（四段结构）

### ① 用户问题
《海风》是一个 3D 探索房间作品。此前物件的名称、坐标、配文全部**写死在前端本地假数据里**——改一行文案要改代码重新打包；「收藏」这类需要记住用户操作的功能，纯静态页面根本做不了。
→ 这周要解决的是：**页面显示真实可维护的数据，且用户的写操作能真正存下来。**

### ② 核心流程
```
浏览器（catalog.html）
   │  GET /api/objects                        读：物件清单（JOIN 出阶段名与年代）
   ▼
公网网关 /api ──► 云函数 haifeng-api ──► PostgreSQL（chapters / objects / favorites）
   ▲                                          ▲
   │  POST /api/favorites {"object_code":…}   写：先查重（友好提示），唯一约束兜底（真拦截）
   └──────────────────────────────────────────┘
读取失败时：前端降级到本地数据，并用「来源徽标」标明 api / local，不静默吞错
```

### ③ 提示词改写（原始一句话 → 可执行的任务约束）

| 原始需求（课程清单原样） | 改写后（落到本项目的约束） |
|---|---|
| 「接真实热搜 + 收藏」 | 项目里没有热搜资源 → 映射为**项目自己的资源**：`/api/hot` → `/api/objects`，收藏原样保留 |
| （未提错误处理） | 硬规则三条：HTTP 状态码必须与 `ok` 一致；`error.message` 必须是可直接展示的中文；错误码集中在契约 §4，代码不许出现表外语码 |
| （未提数据口径） | 匿名访客统一 `_openid=''`； favorites 需对 `anon` 授权 + RLS 策略，否则接口**静默返回空数组** |
| （未提协作方式） | **先改 `api-contract.md` 再改代码**；代码与契约不一致时，以契约为准 |

### ④ 验证方式（每条都已实际执行）

| 步骤 | 动作 | 结果 |
|---|---|---|
| 1 | 真实浏览器打开公网页面（穿透测试域名确认页） | 5 件真数据上屏，来源徽标 = CloudBase 数据库 → `day21-11-page-public.png` |
| 2 | `GET /api/objects?limit=2` | 200，正好 2 条 → `day21-02-api-objects-limit2.json` |
| 3 | `POST obj-05` → `GET /api/favorites` 读回 | 200 → 读回 id=6、createdAt 逐毫秒一致 → `day21-04/05` |
| 4 | 重复 `POST obj-05`、`POST {}`、`GET /api/nope`、`DELETE /api/objects` | 409 / 400 / 404 / 405，全部中文 → `day21-06/07/08/09` |
| 5 | 控制台报错收集（CDP） | 无 JS 异常；1 条 `/favicon.ico` 404（记入下周）→ `day21-13-page-console.txt` |

**走通结论：四段提纲按 1→5 完整走了一遍，全部有据。**

---

## 附：证据文件索引（本目录内可直接点开）

| 文件 | 内容 |
|---|---|
| `day21-http-status.txt` | 10 条用例的状态码与耗时 |
| `day21-01-api-objects.json` | GET /api/objects 全量（5 条） |
| `day21-02-api-objects-limit2.json` | limit=2 参数生效 |
| `day21-03-favorites-before.json` | 写入前收藏列表（4 行） |
| `day21-04-post-new.json` | POST 成功（id=6） |
| `day21-05-favorites-after.json` | 写入后读回（5 行，含 id=6） |
| `day21-06-post-duplicate.json` | 409 重复收藏（中文） |
| `day21-07-post-missing.json` | 400 缺字段（中文） |
| `day21-08-404.json` / `day21-09-405.json` | 路径/方法兜底（中文） |
| `day21-10-page.html` | 公网页面原始 HTML（curl 取回） |
| `day21-11-page-public.png` | 公网页面真实渲染截图（穿透网关后） |
| `day21-12-page-dom.html` | 渲染后 DOM 快照 |
| `day21-13-page-console.txt` | 浏览器控制台记录（1 条 favicon 404，无 JS 异常） |

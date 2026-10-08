# 接口契约 · 《海风》物件与收藏

> 归属：Day 17（读接口）建立，Day 18（写接口 POST）续写，Day 22（PATCH / DELETE）补完
> 维护规则：**先改本文件，再改代码**。接口形状以本文件为准；代码与本文不一致，以本文为错的一方。
> 实现位置：云函数 `haifeng-api`（`cloudfunctions/haifeng-api/index.js`）

---

## 0. 通用约定

### 0.1 基础地址

| 项 | 值 |
|---|---|
| 环境 | `example-d3gz7b0wea9b8bb2e`（体验版 · 上海） |
| 网关域名 | `https://example-d3gz7b0wea9b8bb2e-1500064837.ap-shanghai.app.tcloudbase.com` |
| 路径前缀 | `/api` |
| 路由方式 | 网关 `path=/api` → 云函数 `haifeng-api`，`EnablePathTransmission=true` |

所以完整地址形如：`https://<上面的域名>/api/objects`

### 0.2 统一响应外壳

**成功**（HTTP 200）：

```json
{ "ok": true, "data": [ ... ] }
```

**失败**（HTTP 4xx / 5xx）：

```json
{
  "ok": false,
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "给用户看的中文说明"
  }
}
```

三条硬规则：

1. **HTTP 状态码要与 `ok` 一致** —— 失败绝不用 200 伪装成功。前端只看 `ok` 会漏掉状态码，只看状态码会漏掉错误分类，所以两者都要求。
2. **`error.message` 必须是中文**，且要能直接展示给用户（Day 18 完成标准明确要求"提示是中文"）。英文原文只进日志，不进 `message`。
3. **错误码表集中在本文件 §4**，代码里不许出现表外的错误码。

### 0.3 跨域

函数返回 `Access-Control-Allow-Origin: *`，并处理 `OPTIONS` 预检（返回 204）。
允许的方法：`GET, POST, PATCH, DELETE, OPTIONS`（Day 22 起补上 PATCH / DELETE ——
这两个方法名**必须写进 `Access-Control-Allow-Methods`**，否则浏览器预检直接拦掉，
而 curl 不受影响 —— 典型的"命令行通、页面不通"）。
原因：静态托管站在 `*.tcloudbaseapp.com`，接口在 `*.app.tcloudbase.com`，是跨域请求。

### 0.4 缓存

所有响应带 `Cache-Control: no-store`。
原因：本项目的验收动作之一是"在控制台改一行数据，刷新后返回跟着变"。任何一层缓存都会让这条验收失真。

---

## 1. `GET /api/objects`

物件清单（物品 → 所属阶段 的一次关联查询）。

### 请求

| 参数 | 位置 | 必填 | 说明 |
|---|---|---|---|
| `limit` | query | 否 | 返回条数上限，正整数。省略或非法则返回全部 |
| `include_deleted` | query | 否 | 取值为 `1` / `true` 时**连已软删除的行一起返回**；省略或其它值只返回未删除的行 |

示例：`GET /api/objects?limit=2`、`GET /api/objects?include_deleted=1`

**默认只返回未删除的行**（Day 22 起）。原因：软删除的意义就是"删掉的数据不再出现在正常查询里"，
如果默认把 `is_deleted = true` 的行也吐出来，软删除等于没做。
`include_deleted` 是给**管理员视角 / 找回**用的后门参数，不是给前端正常渲染用的。

### 成功响应 `200`

```json
{
  "ok": true,
  "data": [
    {
      "code": "obj-01",
      "name": "一盏没关的台灯",
      "shape": "lamp",
      "color": "#FFC97A",
      "position": [-1.9, 0, -0.5],
      "routeRange": [0.2, 0.47],
      "sortOrder": 1,
      "isDeleted": false,
      "deletedAt": null,
      "content": {
        "title": "一盏没关的台灯",
        "body": "……",
        "caption": "占位配图 · 待替换"
      },
      "chapter": {
        "slug": "sea-wind",
        "title": "十八岁",
        "subtitle": "一九六八 · 夏",
        "paintingName": "Wind from the Sea",
        "paintingYear": 1967,
        "status": "in_progress"
      }
    }
  ]
}
```

`isDeleted` / `deletedAt` 是 Day 22 新增的两个只读字段：
- 正常查询（不带 `include_deleted`）里它们**恒为 `false` / `null`**，
  （因为过滤后回来的行不可能已删除）；
- 带上 `include_deleted=1` 时才会看到 `true` —— 这一条就是"数据其实还在，只是被标记了"的证据。

字段来源对照（**这一列是本接口最要紧的部分** —— Day 17「要掌握」问的就是它）：

| 响应字段 | 来源列 | 备注 |
|---|---|---|
| `code` | `objects.code` | 表里叫 `code`，前端本地数据里叫 `id` —— **名字对不上** |
| `position` | `objects.pos_x` / `pos_y` / `pos_z` | 三列合成一个数组 —— **形状对不上** |
| `routeRange` | `objects.route_start` / `route_end` | 同上 |
| `content.*` | `objects.memory_title` / `memory_body` / `memory_caption` | 表里统一带 `memory_` 前缀 —— **名字对不上** |
| `chapter.*` | `chapters.*` | JOIN 而来，表里没有 `chapter` 这个 JSON 列 |
| `shape` / `color` / `name` / `sortOrder` | 同名或近似列 | 一一对应 |

**两处已知的"对不上"，实现时必须显式处理，不许悄悄过去：**

1. **`size` 无对应列**（真实缺字段）。
   前端 `src/data/objects.js` 里每件物件有 `size: { radius, height }` 之类的尺寸参数，3D 场景要拿它建几何体。
   数据库 `objects` 表**没有这个字段** —— 建表时漏了。
   本接口**不返回 `size`**，前端读取时按 `undefined` 处理（这是唯一的处理方式：接口不能凭空造数据）。
   → 记入待办：需要一次 `ALTER TABLE` 补列，属于"改表结构"，不在 Day 17/18 范围内。

2. **`NUMERIC` 列会以字符串返回**（类型对不上）。
   `pos_x` 等列类型是 `NUMERIC(6,3)`，PG 的 REST 层会把它序列化成字符串 `"-1.900"`，不是数字。
   直接塞给 Three.js 会让坐标运算出 NaN。
   本接口在函数里显式 `Number()` 转换后再输出，所以**外部看到的一定是数字**。

---

## 2. `GET /api/favorites`

收藏列表（收藏 → 物件 的一次关联查询）。

### 请求

| 参数 | 位置 | 必填 | 说明 |
|---|---|---|---|
| `limit` | query | 否 | 返回条数上限，正整数 |

### 成功响应 `200`

```json
{
  "ok": true,
  "data": [
    {
      "id": 1,
      "objectCode": "obj-01",
      "objectName": "一盏没关的台灯",
      "color": "#FFC97A",
      "createdAt": "2026-10-06T11:12:00.000Z"
    }
  ]
}
```

空收藏是**成功**，返回 `{ "ok": true, "data": [] }` —— 不是 404，也不是错误。

### 说明

`objectName` / `color` 来自 `objects` 表的关联查询。前端拿到收藏列表后不需要再请求一次物件清单。

---

## 3. `POST /api/favorites`

新增一条收藏。

### 请求

```json
{ "object_code": "obj-02" }
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `object_code` | string | 是 | 要收藏的物件编码，必须是 `objects.code` 里已存在的值 |

**为什么请求里没有 `_openid`**：身份由服务端决定，不由客户端上报。客户端能自己填的所有者字段等于没有校验（这也是不信任前端的第一课）。
当前项目没有登录，匿名访客统一记为 `_openid = ''`。

### 成功响应 `200`

```json
{
  "ok": true,
  "data": {
    "id": 3,
    "objectCode": "obj-02",
    "objectName": "摊开的笔记本",
    "createdAt": "2026-10-06T11:30:00.000Z"
  }
}
```

### 失败响应

| 场景 | HTTP | `error.code` | `error.message`（中文，可直接展示） |
|---|---|---|---|
| 请求体不是合法 JSON | 400 | `INVALID_JSON` | 请求体不是合法的 JSON，请检查后再提交。 |
| 缺 `object_code` 或为空串 | 400 | `MISSING_FIELD` | 缺少必填字段：object_code（物件编码）。 |
| `object_code` 不是字符串 | 400 | `INVALID_FIELD_TYPE` | 字段 object_code 必须是字符串。 |
| `object_code` 在物件表里查不到 | 400 | `OBJECT_NOT_FOUND` | 物件不存在：`<值>`。请从物件清单里选择一个。 |
| 同一物件重复收藏 | 409 | `DUPLICATE_FAVORITE` | 「`<物件名>`」已经在收藏里了，请勿重复提交。 |
| 其它未预期错误 | 500 | `INTERNAL_ERROR` | 服务端处理失败，请稍后重试。 |

### 重复提交是怎么拦住的（两层，缺一不可）

| 层 | 手段 | 作用 |
|---|---|---|
| 1 | 插入前 `SELECT` 一次 | 能给出**友好的中文提示**（含物件名），用户体验层 |
| 2 | 数据库唯一约束 `uq_favorites_object (object_code, _openid)` | **真正拦住**。并发下两次请求可能都通过第 1 层，只有约束能兜住 |

第 2 层捕获到 PG 错误码 `23505` 时，同样转成 409 + `DUPLICATE_FAVORITE`。
只做第 1 层 = 有竞态；只做第 2 层 = 提示生硬。两层都要有。

---

## 4. `PATCH /api/objects/:code`（Day 22 新增 · 改）

修改一件物件的字段。`:code` 是路径参数，取值 = `objects.code`，如 `/api/objects/obj-02`。

**为什么用 PATCH 而不是 PUT**：PATCH = 局部更新，只改请求体里出现的字段，没提到的字段保持原样；
PUT = 整体替换，没提到的字段要按"置空"处理。本项目要改的是"一句话改一句话"，
用 PUT 会逼着调用方每次把整条记录凑齐再发，很容易把没想到的字段误清空。

### 请求

```json
{ "memory_caption": "占位配图 · Day 22 已可改", "color": "#FF8A5B" }
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 否 | 物件名，1–64 字符 |
| `color` | string | 否 | 未解锁自发光色，必须形如 `#RRGGBB` |
| `memory_title` | string \| null | 否 | 内容页标题 |
| `memory_body` | string \| null | 否 | 回忆正文 |
| `memory_caption` | string \| null | 否 | 配图说明 |
| `sort_order` | integer | 否 | 展示顺序，≥ 0 |
| `is_deleted` | boolean | 否 | 软删除标记。`true` = 标记删除，`false` = **找回**（见 §5） |

**白名单是硬约束，理由是安全不是洁癖**：请求体里出现上表以外的键（例如 `id`、`chapter_id`、
`code`）一律 400 拒绝，不做"悄悄忽略"。理由有两条：
1. `id` / `code` 是身份，让它可改就等于允许调用方把两条记录"换头"，会直接破坏 3D 场景与收藏的外键关系；
2. 静默忽略会让调用方以为改成功了 —— 拼错字段名（`memory_titel`）时症状是"接口 200 但值没变"，
   这种错最难查。**宁可报错，不要沉默。**

### 成功响应 `200`

返回**改完之后**的这条物件，形状与 `GET /api/objects` 里的单个元素完全一致（含 `chapter`）：

```json
{
  "ok": true,
  "data": {
    "code": "obj-02",
    "name": "摊开的笔记本",
    "shape": "book",
    "color": "#FF8A5B",
    "position": [-1.05, 0, -1.35],
    "routeRange": [0.42, 0.68],
    "sortOrder": 2,
    "isDeleted": false,
    "deletedAt": null,
    "content": { "title": "…", "body": "…", "caption": "占位配图 · Day 22 已可改" },
    "chapter": { "slug": "…", "title": "…" }
  }
}
```

回写整条记录的用意：调用方不需要"改完再 GET 一次"来确认，也避免用本地拼的假数据去更新界面。

### 失败响应

| 场景 | HTTP | `error.code` | `error.message`（中文，可直接展示） |
|---|---|---|---|
| 路径里的 `:code` 在表里查不到 | 404 | `OBJECT_NOT_FOUND` | 物件不存在：`<值>`。 |
| 请求体不是合法 JSON | 400 | `INVALID_JSON` | 请求体不是合法的 JSON，请检查后再提交。 |
| 请求体里一个可改字段都没有（如 `{}`） | 400 | `MISSING_FIELD` | 没有需要修改的字段，请至少提供一个。 |
| 出现白名单以外的字段 | 400 | `UNKNOWN_FIELD` | 不支持修改字段：`<字段名>`。 |
| 字段类型不对（如 `sort_order: "2"`） | 400 | `INVALID_FIELD_TYPE` | 字段 `<字段名>` 类型不正确。 |
| 字段值不合法（如 `color: "red"`） | 400 | `INVALID_FIELD_VALUE` | 字段 `<字段名>` 的值不合法。 |
| 其它未预期错误 | 500 | `INTERNAL_ERROR` | 服务端处理失败，请稍后重试。 |

**已软删除的行仍然可以被 PATCH** —— 这是故意的，找回就是靠它（`{"is_deleted": false}`）。
如果这里也一刀切返回 404，数据就真的只能进数据库手工改回来了。

---

## 5. `DELETE /api/objects/:code`（Day 22 新增 · 删）

删除一件物件。**实现方式是软删除**：不执行 SQL `DELETE`，只把该行 `is_deleted` 置为 `true`。

### 请求

```json
{ "confirm": true }
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `confirm` | boolean | **是** | 必须显式为 `true`，否则拒绝执行 |

### 为什么「删」要单独加一道确认（今天要掌握的问题）

因为增、查、改都**可逆或可覆盖**，删是唯一"动作做完之后，页面看起来少了一条"的操作：

| 操作 | 出错的后果 | 能否自愈 |
|---|---|---|
| 查（GET） | 看到错的数据 | 是，重查就对 |
| 增（POST） | 多一条记录 | 是，删掉即可（且唯一约束会拦住重复） |
| 改（PATCH） | 某个字段值错了 | 是，再 PATCH 一次改回来 |
| **删（DELETE）** | **这一条从列表里消失** | **硬删除时不能**，值已经不在库里了 |

所以三件事一起做，缺一不可：

1. **接口层要确认** —— 必须带 `{"confirm": true}`。防的是"脚本里手滑少写一个参数就把数据删了"、
   以及"前端某个按钮重复触发第二次"。少一个参数报错，比删完之后才发现要好。
2. **存储层要软删除** —— 即使确认过，也仍然只打标记不真删。防的是"确认点错了"，
   这是**唯一能兜住"人主观上就是想删、但删错了对象"的一层**。
3. **读取层要过滤** —— `GET` 默认排除 `is_deleted = true` 的行。不做这步，前两条都白做。

这三层对应今天要掌握的那句话：**删除比新增更容易出事，不是因为技术更难，而是因为它的后果不可见。**

### 成功响应 `200`

```json
{
  "ok": true,
  "data": {
    "code": "obj-05",
    "name": "朝海的窗（预告）",
    "deleted": true,
    "softDeleted": true,
    "deletedAt": "2026-10-08T15:10:00.000Z"
  }
}
```

`softDeleted: true` 是**刻意回给调用方的提示**：这次删除可以撤销，不是不可逆的。
调用方要区分"能不能反悔"，就看这个字段，而不是靠猜。

### 失败响应

| 场景 | HTTP | `error.code` | `error.message`（中文，可直接展示） |
|---|---|---|---|
| 请求体缺 `confirm` 或不是 `true` | 400 | `CONFIRM_REQUIRED` | 删除需要确认：请在请求体里传 `{"confirm": true}`。 |
| 路径里的 `:code` 不存在，或**已经被软删除** | 404 | `OBJECT_NOT_FOUND` | 物件不存在或已删除：`<值>`。 |
| 请求体不是合法 JSON | 400 | `INVALID_JSON` | 请求体不是合法的 JSON，请检查后再提交。 |
| 其它未预期错误 | 500 | `INTERNAL_ERROR` | 服务端处理失败，请稍后重试。 |

**重复删除返回 404 而不是 200，是刻意的选择**：删两次和删一次的结果不同（第二次什么也没发生），
按 HTTP 语义第二次应当报"要操作的东西不在"。另一种合理设计是做成幂等（第二次也返回 200），
但那样调用方**永远无法从响应看出"刚才那次到底删了什么"**，所以本项目选了 404。

### 找回（软删除的兑现方式）

`PATCH` 回 `{"is_deleted": false}` 即可找回，且 `deleted_at` 会被清空：

```json
{ "ok": true, "data": { "code": "obj-05", "isDeleted": false, "deletedAt": null, "…": "…" } }
```

也可以用 `GET /api/objects?include_deleted=1` 先把被标记的行捞出来确认，再决定找不找。

### 一个必须写出来的已知缺口

软删除**不解决外键**。`favorites.object_code` 对 `objects.code` 是 `ON DELETE RESTRICT`，
所以本接口如果写成硬删除，删除已被收藏的物件（如 `obj-01`）会被数据库直接拒绝 ——
软删除顺带绕开了这个限制，但**代价是"已删除"的物件仍然占着 `code` 的唯一约束**，
同一个 `code` 无法重新插入一条新记录。真实项目里要处理这种情况（例如清理收藏后真删、
或给活跃记录换唯一约束为 `(code) WHERE is_deleted = false` 的部分索引），本项目不做，记入待办。

---

## 6. 错误码总表

| `code` | HTTP | 中文含义 |
|---|---|---|
| `INVALID_JSON` | 400 | 请求体不是合法 JSON |
| `MISSING_FIELD` | 400 | 缺必填字段 / 没有需要修改的字段 |
| `INVALID_FIELD_TYPE` | 400 | 字段类型不对 |
| `INVALID_FIELD_VALUE` | 400 | 字段值不合法 |
| `UNKNOWN_FIELD` | 400 | 出现不允许修改的字段 |
| `CONFIRM_REQUIRED` | 400 | 删除未确认 |
| `OBJECT_NOT_FOUND` | 400 / 404 | 物件不存在（POST 时 400，路径参数场景 404） |
| `DUPLICATE_FAVORITE` | 409 | 重复收藏 |
| `ROUTE_NOT_FOUND` | 404 | 路径不存在 |
| `METHOD_NOT_ALLOWED` | 405 | 方法不支持 |
| `DB_ERROR` | 500 | 数据库读写失败 |
| `INTERNAL_ERROR` | 500 | 未预期错误 |

代码里不使用本表以外的错误码。新增错误码请先更新本表。

> `OBJECT_NOT_FOUND` 有两个状态码是刻意的：`POST /api/favorites` 里它是**请求体字段**不合法（400），
> 在 `PATCH` / `DELETE` 里它是**路径**指向的资源不存在（404）。同一个错误码，一个错在"你说的话"，
> 一个错在"你要的东西"，HTTP 语义上必须分开。

---

## 7. 与「清单原文」的对应关系

清单里写的是 `/api/hot`（当日真实热搜）与 `/api/favorites`。
经用户确认，按**本项目自己的资源**落地：

| 清单原样 | 本项目 | 理由 |
|---|---|---|
| `GET /api/hot` | `GET /api/objects` | 项目里没有"热搜"这种资源；与"当日热点数据"等价的，就是这个房间的物件清单 |
| 板块②「接真实热搜 + 同步任务」 | 数据源即 Day 16 建好的库 | 数据本来就是我们自己的，不需要外部同步任务，附录 F 的降级路径也用不上 |
| `GET /api/favorites` | `GET /api/favorites` | 原样保留 |
| Day 18 的 `POST` | `POST /api/favorites` | 原样保留 |
| Day 22 的 `PATCH` / `DELETE` | `PATCH /api/objects/:code`、`DELETE /api/objects/:code` | 清单要求"改一条 / 删一条后 GET 不再返回"，只有落在**同一条记录**上才能前后对照，所以改删都做在 `objects` 上 |

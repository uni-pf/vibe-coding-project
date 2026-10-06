# 接口契约 · 《海风》物件与收藏

> 归属：Day 17（读接口）建立，Day 18（写接口）续写
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

示例：`GET /api/objects?limit=2`

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

## 4. 错误码总表

| `code` | HTTP | 中文含义 |
|---|---|---|
| `INVALID_JSON` | 400 | 请求体不是合法 JSON |
| `MISSING_FIELD` | 400 | 缺必填字段 |
| `INVALID_FIELD_TYPE` | 400 | 字段类型不对 |
| `OBJECT_NOT_FOUND` | 400 | 物件不存在 |
| `DUPLICATE_FAVORITE` | 409 | 重复收藏 |
| `ROUTE_NOT_FOUND` | 404 | 路径不存在 |
| `METHOD_NOT_ALLOWED` | 405 | 方法不支持 |
| `DB_ERROR` | 500 | 数据库读写失败 |
| `INTERNAL_ERROR` | 500 | 未预期错误 |

代码里不使用本表以外的错误码。新增错误码请先更新本表。

---

## 5. 与「清单原文」的对应关系

清单里写的是 `/api/hot`（当日真实热搜）与 `/api/favorites`。
经用户确认，按**本项目自己的资源**落地：

| 清单原样 | 本项目 | 理由 |
|---|---|---|
| `GET /api/hot` | `GET /api/objects` | 项目里没有"热搜"这种资源；与"当日热点数据"等价的，就是这个房间的物件清单 |
| 板块②「接真实热搜 + 同步任务」 | 数据源即 Day 16 建好的库 | 数据本来就是我们自己的，不需要外部同步任务，附录 F 的降级路径也用不上 |
| `GET /api/favorites` | `GET /api/favorites` | 原样保留 |
| Day 18 的 `POST` | `POST /api/favorites` | 原样保留 |

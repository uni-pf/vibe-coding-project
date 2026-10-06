# db/ —— 数据库部分怎么跑

归属：Day 16 · CloudBase 关系型数据库（PostgreSQL）
　　　Day 17 修订 —— 适配 CloudBase 的执行限制，并补上权限层

这三个文件是「图纸 → 填数 → 拿证据」的完整链条，按顺序执行。

| 顺序 | 文件 | 干什么 | 能不能重复跑 |
|---|---|---|---|
| 1 | `schema.sql` | 建表（chapters / objects / favorites + 外键 + 索引 + 权限层） | ✅ 用 `IF NOT EXISTS` / `DROP POLICY IF EXISTS` |
| 2 | `seed.sql` | 填数据（5 阶段 + 5 物件 + 2 收藏） | ✅ 用 `ON CONFLICT DO UPDATE` / `DO NOTHING` |
| 3 | `verify.sql` | 只读查询，拿证据 | ✅ 全是 SELECT |

---

## 一、Day 17 修订：上次为什么报错，这次改了什么

上次在 DMC 执行 `schema.sql` 报错（DDL 被拦 / 语法类）。查出三个原因，全部已修：

| # | 原因 | 表现 | 这次怎么改 |
|---|---|---|---|
| 1 | **30 条 `COMMENT ON` 语句** | CloudBase 官方 troubleshooting 明确列出 `CREATE / ALTER / DROP / GRANT / REVOKE / TRUNCATE / COMMENT` 这类 DDL「可能被直接拦截返回 transient InternalError」 | **全部删除**。字段说明改写成 `--` 行内注释，信息一条没丢，只是不再写进数据库元数据 |
| 2 | **中文列别名没加双引号** | PG 的标识符规则只认字母/数字/下划线。`AS 检查项` 这种未加引号的非 ASCII 标识符属未定义行为，常见表现是 `syntax error at or near "检查项"` | 14 处别名**全部加双引号**（`AS "检查项"`），输出仍是中文表头 |
| 3 | **缺少权限层** | 不是报错，是「静默失败」：表建成了但接口查出来恒为空数组 | 补 `GRANT`（表级 + 序列级）+ `RLS`（行级），见下文第四节 |

> 如果重跑后还报错：把**报错原文**贴出来。上面三条覆盖了「DDL 被拦」和「语法类」最常见的两种，
> 但如果是别的（字段类型、约束冲突、账号权限），原文能一句话定位。

---

## 二、执行方式变了：分成几段跑，不要整段贴

CloudBase 官方要求 **一次只执行一条语句**。上次是 39 条语句整段粘贴一次性提交，这是报错的共同前提。

**`schema.sql` 分 5 段执行**（文件里已用注释标好段落）：

| 段 | 内容 | 语句数 |
|---|---|---|
| 第 1 段 | 3 个 `CREATE TABLE` + 2 个 `CREATE INDEX` | 5 |
| 第 2 段 | 7 条 `GRANT` | 7 |
| 第 3 段 | 3 条 `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`（各 1 条分开跑） | 3 |
| 第 4 段 | 6 条策略：`DROP POLICY IF EXISTS` + `CREATE POLICY`，**成对、逐条**跑 | 6 |
| 第 5 段 | 文件末尾 3 个检查 `SELECT` | 3 |

> 若某一段被拦截，**单独执行那一条**即可 —— 本文件每条语句都能独立执行，不依赖上下文。

`seed.sql` 和 `verify.sql` 整段粘贴即可（都是 INSERT / SELECT，不在被拦的 DDL 名单里）。

---

## 三、执行前的准备（CloudBase 控制台）

### 第 0 步 · 确认入口正确（这里最容易走错）

✅ 正确入口：**云开发平台 → MySQL/PostgreSQL 数据库**

```
https://tcb.cloud.tencent.com/dev#/db
```

❌ 不要走这两个错误入口：

| 错误入口 | 为什么错 |
|---|---|
| WorkBuddy 云服务开通页 | 那是 WorkBuddy 自己的云服务，和腾讯云开发 CloudBase 不是一回事 |
| 腾讯云 **TDSQL-C 独立实例**购买页 | 计费 **2.57 元/小时 ≈ 1850 元/月**，4核8GB 独立实例，免费版 3000 资源点扛不住，**点了下一步就开始计费** |

CloudBase 的数据库是 **Serverless** 底座：首次「开通」耗时 **2-3 分钟**，
**没有实例规格选项、没有小时费**，走资源点池计费。

> 0.25 核 + 2GB 存储 ≈ 0.10 元/小时，免费版 3000 点 ≈ 能跑约 30 小时，Day 16-18 绰绰有余。

### 第 1 步 · 开通数据库

云开发平台 → 数据库 → 选 **PostgreSQL** → 点「开通」，等 2-3 分钟。

> ⚠️ 自动暂停：启动后最小运行时长 10 分钟，连续 10 分钟未访问会自动暂停。
> 官方两处文档写的不一致（一处 30 分钟、一处 10 分钟），按 10 分钟准备。
> **暂停不影响数据**，下次访问自动恢复。

### 第 2 步 · 建数据库账号

数据库 → 数据库设置 → 账号管理 → 新建账号，设好用户名和密码。
（DMC 登录要用这个账号，**记下来**。）

### 第 3 步 · 进 DMC

点「数据库管理」→ 跳转到 **DMC**（数据管理控制台）→ 打开 SQL 窗口。

> 执行 SQL 的地方**不在控制台页面里**，在 DMC 的 SQL 窗口。

---

## 四、为什么必须配权限（Day 17 新增，不配接口会静默返回空）

CloudBase PG 是**双层权限**，两层都过才返回数据：

| 层 | 作用范围 | 给谁授 | 漏了会怎样 |
|---|---|---|---|
| **GRANT** | 表 / 序列级 | `anon`（未登录访客）、`authenticated`（已登录用户）、`service_role`（服务端） | 直接报 `permission denied for table xxx` |
| **RLS** | 行级 | 按策略表达式 | 不报错，但查询**恒返回空数组** —— 最危险的一类失败 |

`schema.sql` 里的配置逻辑：

- `chapters` / `objects` 是公开作品集内容 → `anon` + `authenticated` 均可读，RLS 策略 `USING (true)`
- `favorites` 是用户私有数据 → 只给 `authenticated`，RLS 策略 `_openid = auth.uid()`（读 `USING`、写 `WITH CHECK` 两个都要写）

**另外，序列必须单独授权**：`SERIAL` 主键背后是一个独立的 `SEQUENCE` 对象，
授予表的 `INSERT` **不等于**授予序列的使用权 —— 漏了会报
`permission denied for sequence objects_id_seq`。

**还有一个 CloudBase 和 Supabase 的差异**：CloudBase 的 `auth.uid()` 返回 **text**（不是 uuid）。
所以归属列用 `VARCHAR(64)` 与之直接匹配；写成 `uuid` 列会报 `operator does not exist: uuid = text`。

---

## 五、预期结果对照（自己核对，别只看"成功"两个字）

| 查询 | 内容 | 预期 |
|---|---|---|
| 查询 1 | chapters 全表 | **5 行**：sea-wind / the-note / old-disc / long-road / home-again |
| 查询 2 | objects 全表 | **5 行**：obj-01 ~ obj-05 |
| 查询 3 | 跨表 JOIN | **5 行**（JOIN 不漏行） |
| 查询 3b | 孤儿物件检查 | **0 行**（有行＝外键被绕过，要查） |
| 查询 4 | 按阶段聚合 | 5 行，每个阶段各 1 件物件 |
| 查询 5 | 行数汇总 | chapters 5 达标 / objects 5 达标 |
| 查询 6 | favorites 全表 | **2 行**：obj-01 / obj-03 |
| 查询 6b | 收藏指向不存在的物件 | **0 行** |
| 查询 7 | 权限双层检查 | 3 行，每张表 `RLS已开启=true`、`策略数≥1`、`已授权角色`含 anon 或 authenticated |

---

## 六、报错对照表（遇到哪个查哪个）

| 报错原文关键词 | 根因 | 怎么修 |
|---|---|---|
| `transient InternalError` | DDL 被 CloudBase 拦截 | 单独跑那一条；仍失败则用 `DO $$ BEGIN EXECUTE '...'; END $$;` 包裹（单引号要转义成两个） |
| `syntax error at or near "检查项"` | 中文标识符没加引号 | 已修（全部加双引号）；若自己另写的查询记得同样处理 |
| `permission denied for table xxx` | GRANT 没授到 | `GRANT SELECT ON TABLE public.xxx TO anon, authenticated;` |
| `permission denied for sequence xxx_id_seq` | 序列没单独授权 | `GRANT USAGE, SELECT ON SEQUENCE public.xxx_id_seq TO authenticated;` |
| `new row violates row-level security policy` | RLS 的 `WITH CHECK` 不通过 | 检查 `_openid` 是否等于 `auth.uid()`；DMC 手动执行时 `_openid` 是空串 |
| `role "anon" does not exist` | 环境不是 PG 模式，或角色未预置 | 确认环境已开 PostgreSQL（`RuntimeBackends.postgresql === true`） |
| `relation "chapters" already exists` | 表已建过，重复执行 | 正常情况不会被拦（用了 `IF NOT EXISTS`）；若报说明某段没加，跳过该条即可 |
| 查询成功但返回空数组 | RLS 策略把行全过滤了 | 看查询 7：策略数是否为 0、`_openid` 是否对得上 |

---

## 七、字段设计说明（为什么这么切）

完整理由写在 `schema.sql` 的行内注释里，这里只列关键点：

- **三张表分工**：`chapters` 存时间（叙事骨架），`objects` 存空间（房间里的东西），
  `favorites` 存用户行为（谁收藏了什么）。
- **关联字段** `objects.chapter_id` → `chapters.id`，一对多。
- **`favorites` 用 `object_code` 关联**而非 `id`：code 是稳定业务键，
  重跑 seed、换环境、id 自增起点不同都对得上。
- **外键 `ON DELETE RESTRICT`**（不是 CASCADE）：删阶段前必须先处理其下物件，
  防止连带删掉写好的配文 —— 这类误删事后无法恢复。
- **唯一约束 `uq_favorites_object (object_code, _openid)`**：同一人对同一物件只能收藏一次。
  Day 18 的「重复提交被拒」靠数据库约束兜底，不靠应用层 if 判断 —— 并发下也拦得住。
- **`_openid` 列**：CloudBase 硬性要求，新建表必须包含，用于按用户做访问控制。
  登录时由服务端自动填充，**普通 INSERT 不要手动填**。

---

## 八、已知未验证项（诚实记录）

- 三个 SQL 文件的语法用 PostgreSQL 方言静态解析器（sqlglot 30.21.0）全部验证通过，
  但**从未在真实 PostgreSQL 实例上执行成功过** —— 上次在 DMC 执行报错，原因已定位并修复，
  修复后的版本**尚未重跑**。
- `GRANT` / `RLS` 段是 Day 17 新增的，同样**未在真实环境验证**。
- 首次重跑若仍报错，最可能的位置是：`CREATE POLICY` 段（依赖角色 `anon`/`authenticated` 已预置）
  或 `ENABLE ROW LEVEL SECURITY` 的权限（需要表的 owner 身份）。

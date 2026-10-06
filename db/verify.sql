-- ============================================================================
-- 《海风》· 画中的一生 —— 验证查询
-- 归属：Day 16 · 板块④ 选择查询验证
--       Day 17 修订 —— 中文别名加双引号，并补 favorites 与权限层验证
-- 目标库：CloudBase 关系型数据库（PostgreSQL）
-- 前置：已执行 db/schema.sql（建表）+ db/seed.sql（填数）
--
-- ----------------------------------------------------------------------------
-- 【Day 17 修订说明 · 为什么中文别名全部加了双引号】
--   PostgreSQL 的标识符规则只认「字母 / 数字 / 下划线」，
--   非 ASCII 标识符不加引号属于未定义行为，各版本表现不一致，
--   常见表现是直接抛 syntax error at or near "检查项"。
--   加双引号是最稳的写法，输出仍是中文表头。
-- ----------------------------------------------------------------------------
-- 【这个文件是什么】
--   不是建表也不是填数，是「拿证据」——证明前两步真的生效了。
--   全部是只读 SELECT，不改任何数据，可以随便重复跑。
--
-- 【板块④ 完成标准，逐条对应】
--   a. 每张核心表 ≥5 行            → 查询 1、查询 2、查询 5
--   b. 一条跨表 JOIN 证明关联字段通  → 查询 3
--   c. 区间 / 坐标 / 颜色等约束在生效 → 查询 4、5
--   d. （Day 17 新增）收藏表与外键成立 → 查询 6
--   e. （Day 17 新增）权限双层是否配好 → 查询 7
--
-- 【截图怎么截】
--   查询 1 和查询 3 的结果要完整截进图 —— 评审看的就是这两张。
--   DMC 的 SQL 窗口执行后下方会出结果表，连表头一起截。
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 查询 1 · chapters 全表（要求 ≥5 行）
-- 为什么要这一条：证明阶段表有数据，且 sort_order / status 都填对了
-- ----------------------------------------------------------------------------
SELECT '查询 1 · chapters 表全部数据' AS "检查项";

SELECT id,
       slug,
       title,
       subtitle,
       painting_name,
       painting_year,
       summary,
       sort_order,
       status
FROM   chapters
ORDER  BY sort_order;


-- ----------------------------------------------------------------------------
-- 查询 2 · objects 全表（要求 ≥5 行）
-- 为什么要这一条：证明物件表有数据，且坐标是三位小数的定长值（没被浮点污染）
-- ----------------------------------------------------------------------------
SELECT '查询 2 · objects 表全部数据' AS "检查项";

SELECT id,
       chapter_id,
       code,
       name,
       shape,
       pos_x,
       pos_y,
       pos_z,
       route_start,
       route_end,
       color
FROM   objects
ORDER  BY sort_order;


-- ----------------------------------------------------------------------------
-- 查询 3 · ★ 跨表 JOIN —— 板块④ 的核心证据
--
-- 为什么要这一条：前面所有验证都只证明「两张表各自有数据」，
--   唯独这条能证明 objects.chapter_id 真的指得通 chapters.id。
--   如果关联字段是错的（比如写出 999），这里会漏出行 —— 行数对不上就是证据。
--
-- 用 INNER JOIN：两边对得上才出现。所以结果行数必须 = objects 行数（5 行）。
-- 另外用 LEFT JOIN 那一版放在查询 3b，专门抓「孤儿物件」。
-- ----------------------------------------------------------------------------
SELECT '查询 3 · 跨表 JOIN：每件物件属于哪个阶段' AS "检查项";

SELECT o.code          AS "物件编码",
       o.name          AS "物件名",
       c.title         AS "所属阶段",
       c.slug          AS "阶段标识",
       c.painting_name AS "对应画作",
       o.route_start   AS "区间起点",
       o.route_end     AS "区间终点"
FROM   objects  o
JOIN   chapters c ON o.chapter_id = c.id
ORDER  BY c.sort_order, o.sort_order;


-- ----------------------------------------------------------------------------
-- 查询 3b · 反查「孤儿物件」—— 预期结果为空（0 行）
--
-- 为什么还要跑这条：查询 3 用的是 INNER JOIN，对不上的行会被静默丢掉。
--   万一真有脏数据，只跑查询 3 是看不出来的。
--   这条用 LEFT JOIN + IS NULL，专门把「找不到所属阶段」的物件捞出来。
--   **返回 0 行才是通过** —— 有行说明外键约束被绕过了。
-- ----------------------------------------------------------------------------
SELECT '查询 3b · 孤儿物件检查（预期 0 行）' AS "检查项";

SELECT o.id, o.code, o.name, o.chapter_id
FROM   objects  o
LEFT   JOIN chapters c ON o.chapter_id = c.id
WHERE  c.id IS NULL;


-- ----------------------------------------------------------------------------
-- 查询 4 · 按阶段聚合，证明「一个阶段可以挂多件物件」（一对多成立）
--
-- 为什么要这一条：一对多关系如果只靠 5 行平铺数据看不出来，
--   用 GROUP BY 数出来才直观 —— 有 count > 1 的阶段，关系才算真被用上。
-- ----------------------------------------------------------------------------
SELECT '查询 4 · 每个阶段下有几件物件' AS "检查项";

SELECT c.title                  AS "阶段",
       c.status                 AS "状态",
       COUNT(o.id)              AS "物件数",
       COALESCE(STRING_AGG(o.code, ', ' ORDER BY o.sort_order), '（暂无）') AS "物件编码"
FROM   chapters c
LEFT   JOIN objects o ON o.chapter_id = c.id
GROUP  BY c.id, c.title, c.status, c.sort_order
ORDER  BY c.sort_order;


-- ----------------------------------------------------------------------------
-- 查询 5 · 行数汇总 —— 对照「每表 ≥5 行」的完成标准
-- ----------------------------------------------------------------------------
SELECT '查询 5 · 行数汇总（chapters / objects 应 ≥5）' AS "检查项";

SELECT 'chapters' AS "表名", COUNT(*) AS "行数",
       CASE WHEN COUNT(*) >= 5 THEN '达标' ELSE '不足' END AS "判定"
FROM   chapters
UNION ALL
SELECT 'objects', COUNT(*), CASE WHEN COUNT(*) >= 5 THEN '达标' ELSE '不足' END
FROM   objects;


-- ----------------------------------------------------------------------------
-- 查询 6 · favorites 全表（Day 17 新增表）
--
-- 为什么要这一条：Day 17/18 的 /api/favorites 就查这张表。
--   这里先证明它建成了、有数据、且 object_code 真的指得通 objects.code。
--   行数不要求 ≥5 —— 它是用户行为数据，不是内容数据，2 行演示量足够。
-- ----------------------------------------------------------------------------
SELECT '查询 6 · favorites 表全部数据（Day 17 新表）' AS "检查项";

SELECT f.id,
       f.object_code,
       f._openid,
       f.created_at,
       o.name AS "物件名（外键指过去取到的）"
FROM   favorites f
JOIN   objects   o ON f.object_code = o.code
ORDER  BY f.created_at;


-- ----------------------------------------------------------------------------
-- 查询 6b · 外键反查 —— 预期 0 行
-- 同查询 3b 的道理：INNER JOIN 会掩盖坏数据，用 LEFT JOIN 捞出来才看得见。
-- ----------------------------------------------------------------------------
SELECT '查询 6b · 收藏指向不存在的物件（预期 0 行）' AS "检查项";

SELECT f.id, f.object_code
FROM   favorites f
LEFT   JOIN objects o ON f.object_code = o.code
WHERE  o.code IS NULL;


-- ----------------------------------------------------------------------------
-- 查询 7 · 权限双层是否配好（Day 17 新增）
--
-- CloudBase PG 是 GRANT（表级）+ RLS（行级）两层，两层都过接口才拿得到数据。
-- 这一条同时看两层：
--   rls_enabled = true            → RLS 已开启
--   策略条数 ≥ 1                  → 不只是开了，还写了策略
--   授权角色含 anon/authenticated → GRANT 已授到业务角色上
-- ----------------------------------------------------------------------------
SELECT '查询 7 · 权限双层检查（RLS 开关 + 策略数 + 授权角色）' AS "检查项";

SELECT t.tablename                        AS "表",
       t.rowsecurity                      AS "RLS已开启",
       COALESCE(p.policy_count, 0)        AS "策略数",
       COALESCE(g.grantee_list, '（无）')  AS "已授权角色"
FROM   pg_tables t
LEFT   JOIN (
         SELECT tablename, COUNT(*) AS policy_count
         FROM   pg_policies
         WHERE  schemaname = 'public'
         GROUP  BY tablename
       ) p ON p.tablename = t.tablename
LEFT   JOIN (
         SELECT table_name, STRING_AGG(DISTINCT grantee, ', ' ORDER BY grantee) AS grantee_list
         FROM   information_schema.role_table_grants
         WHERE  table_schema = 'public'
           AND  grantee IN ('anon', 'authenticated')
         GROUP  BY table_name
       ) g ON g.table_name = t.tablename
WHERE  t.schemaname = 'public'
  AND  t.tablename IN ('chapters', 'objects', 'favorites')
ORDER  BY t.tablename;


-- ============================================================================
-- 预期结果对照表（执行后自己核对）
--
--   查询 1  → 5 行：sea-wind / the-note / old-disc / long-road / home-again
--   查询 2  → 5 行：obj-01 ~ obj-05
--   查询 3  → 5 行（JOIN 不漏行）
--   查询 3b → 0 行（无孤儿物件）
--   查询 4  → 5 行，前 3 个阶段各 1 件真实物件，后 2 个各 1 件预告物件
--   查询 5  → chapters 5 达标 / objects 5 达标
--   查询 6  → 2 行（obj-01 / obj-03，seed 里放的收藏演示数据）
--   查询 6b → 0 行
--   查询 7  → 3 行，每张表 RLS已开启=true、策略数 ≥1、已授权角色含 anon 或 authenticated
-- ============================================================================

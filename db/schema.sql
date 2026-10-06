-- ============================================================================
-- 《海风》· 画中的一生 —— 数据库表结构
-- 归属：Day 16 · 板块① 数据模型设计
--       Day 17 修订 —— 按 CloudBase PG 执行限制改写，并补上权限层
-- 目标库：CloudBase 关系型数据库（PostgreSQL）
--
-- ----------------------------------------------------------------------------
-- 【Day 17 修订说明】改了三处，每处都对应一个实测/查证到的坑
-- ----------------------------------------------------------------------------
--   改动 1 · 删掉全部 30 条 COMMENT ON 语句
--     原因：CloudBase 官方 troubleshooting 文档明确列出 —— CREATE / ALTER / DROP /
--           GRANT / REVOKE / TRUNCATE / COMMENT 这类 DDL「可能被直接拦截，
--           返回 transient InternalError」，并且要求「一次只执行一条语句」。
--           初版是 39 条语句整段粘贴一次性提交，必然踩中。
--     代价：字段说明不再写进数据库元数据表。改写成 SQL 行内 -- 注释，
--           信息一条没丢，只是位置从数据库搬到了文件里。
--
--   改动 2 · 新增权限层（GRANT + RLS）
--     原因：CloudBase PG 是双层权限 —— GRANT 是第一层（表 / 序列级），
--           RLS 是第二层（行级），两层都过才返回数据。
--           初版一条都没写 → 即使表建成功，接口查出来也是空数组。
--     附带：SERIAL 主键背后的 SEQUENCE 是独立对象，授权表 ≠ 授权序列；
--           写入任何一条记录都要先 GRANT USAGE, SELECT ON SEQUENCE。
--
--   改动 3 · 新增 favorites 表（用户已明确授权改表结构）
--     原因：Day 17/18 的 /api/favorites 要有落点。
--           Day 18「重复提交被拒」这条完成标准，就落在它的唯一约束上。
--
-- ----------------------------------------------------------------------------
-- 【表之间的关系】
-- ----------------------------------------------------------------------------
--   chapters（阶段）  1 ────<  N  objects（物件）
--                        ↑
--              objects.chapter_id
--
--   objects.code  ────<  N  favorites.object_code
--   favorites 用 code 而非 id 关联：code 是稳定的业务键，
--   重跑 seed、换环境、id 自增起点不同都对得上。
-- ============================================================================


-- ============================================================================
-- 第 1 段 · 建表（3 条 CREATE TABLE + 1 条 CREATE INDEX）
-- ============================================================================

-- 表一：chapters —— 人物一生的阶段
-- 一条记录 = 一个年龄段 / 一次转折，页面上的「第几章」就是这里的一行。
--   id            阶段唯一编号，自增主键。objects.chapter_id 指向它。
--   slug          英文短标识，用于网址与前端路由（如 sea-wind）。UNIQUE 防重复。
--   title         阶段标题，内容页大字，如「十八岁」。
--   subtitle      副标题或时间标注，如「一九六八 · 夏」。可空，早期阶段年份未定。
--   painting_name 本阶段对应的怀斯画作名。可空，阶段先于画作确定。
--   painting_year 画作年份。用 SMALLINT：年份不会超 32767，占一半存储。
--   summary       一句话概述，显示在章节列表上。VARCHAR(255) 而非 TEXT：列表只取这一列。
--   sort_order    章节播放顺序，不等于 id。id 只管唯一，顺序会被人工调整。
--   status        planned 已规划 / in_progress 制作中 / released 已上线。
--                 用文字而非数字：代码里只做相等判断，可读性优先。
--   _openid       【CloudBase 硬性要求】记录归属用户，登录时服务端自动填充。
--   created_at    记录创建时间。TIMESTAMPTZ 带时区，跨时区读写不偏。
CREATE TABLE IF NOT EXISTS chapters (
  id              SERIAL          PRIMARY KEY,
  slug            VARCHAR(32)     NOT NULL UNIQUE,
  title           VARCHAR(64)     NOT NULL,
  subtitle        VARCHAR(128),
  painting_name   VARCHAR(64),
  painting_year   SMALLINT,
  summary         VARCHAR(255),
  sort_order      SMALLINT        NOT NULL DEFAULT 0,
  status          VARCHAR(16)     NOT NULL DEFAULT 'planned',
  _openid         VARCHAR(64)     NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT chk_chapters_year
    CHECK (painting_year IS NULL OR painting_year BETWEEN 1000 AND 2999),
  CONSTRAINT chk_chapters_status
    CHECK (status IN ('planned', 'in_progress', 'released'))
);


-- 表二：objects —— 房间里的可探索物件
-- 一条记录 = 一件可点击的物件，含 3D 坐标、可交互区间和点开后的回忆配文。
-- 这张表建成后，前端 src/data/objects.js 里写死的数组就退休了（Day 17 读接口的落点）。
--   id            物件唯一编号，自增主键。
--   chapter_id    ★ 关联字段：指向 chapters.id。一件物件只属于一个阶段。
--   code          物件编码，如 obj-01。前端拿它给 3D 网格打标记，UNIQUE 防重复。
--   name          物件名，内容页标题。
--   shape         用哪种几何体代替真模型：lamp / book / disc / box。
--   pos_x/y/z     房间内坐标，单位约等于米。NUMERIC(6,3) 而非浮点：3 位小数够用且无浮点误差。
--                 三件物件分处近中远三层，z 值拉开才有视差。
--   route_start   相机路线进度下界，0~1。推进进度落在区间内物件才可点。
--   route_end     路线进度上界，须大于 route_start（由 chk_objects_route_range 强制）。
--   color         未解锁时的自发光色 #RRGGBB。定长 7：格式固定，省空间也防脏数据。
--   memory_title  点击后内容页标题。可空，物件可以先只做视觉不给内容。
--   memory_body   那段回忆的正文。用 TEXT：正文长度不可预估。
--   memory_caption 配图的说明文字。
--   sort_order    同一阶段内的展示顺序。
--   _openid       【CloudBase 硬性要求】同 chapters。
CREATE TABLE IF NOT EXISTS objects (
  id              SERIAL          PRIMARY KEY,
  chapter_id      INTEGER         NOT NULL,
  code            VARCHAR(32)     NOT NULL UNIQUE,
  name            VARCHAR(64)     NOT NULL,
  shape           VARCHAR(32)     NOT NULL DEFAULT 'box',
  pos_x           NUMERIC(6, 3)   NOT NULL DEFAULT 0.000,
  pos_y           NUMERIC(6, 3)   NOT NULL DEFAULT 0.000,
  pos_z           NUMERIC(6, 3)   NOT NULL DEFAULT 0.000,
  route_start     NUMERIC(4, 3)   NOT NULL DEFAULT 0.000,
  route_end       NUMERIC(4, 3)   NOT NULL DEFAULT 1.000,
  color           CHAR(7)         NOT NULL DEFAULT '#FFFFFF',
  memory_title    VARCHAR(64),
  memory_body     TEXT,
  memory_caption  VARCHAR(128),
  sort_order      SMALLINT        NOT NULL DEFAULT 0,
  _openid         VARCHAR(64)     NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- 外键：保证不会出现「chapter_id 指向不存在的阶段」这种脏数据。
  -- ON DELETE RESTRICT 而非 CASCADE：删阶段前必须先处理阶段下的物件，
  -- 否则连带删掉写好的配文 —— 这类误删事后无法恢复。
  CONSTRAINT fk_objects_chapter
    FOREIGN KEY (chapter_id) REFERENCES chapters (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  -- 区间必须成立，否则「相机走到没走到」的判断会失效
  CONSTRAINT chk_objects_route_range
    CHECK (route_start >= 0 AND route_end <= 1 AND route_start < route_end)
);


-- 表三：favorites —— 收藏（本项目中＝已解锁的物件）
-- 一条记录 = 某人收藏了某件物件。PRD F5.1 原本把解锁进度放在浏览器内存里、
-- 刷新即丢；上后端后它落在这张表，才能跨设备保留。
--   id           自增主键。
--   object_code  ★ 关联字段：指向 objects.code。
--   _openid      归属用户。规则放开时由服务端填 auth.uid()；DMC 手动执行时为空串。
--   created_at   收藏时间。列表按它倒序，最近收藏的排前面。
--   uq_favorites_object  (object_code, _openid) 唯一 —— 同一人对同一物件只能收藏一次。
--                        Day 18「重复提交被拒」靠的就是它，不靠应用层判断。
CREATE TABLE IF NOT EXISTS favorites (
  id            SERIAL        PRIMARY KEY,
  object_code   VARCHAR(32)   NOT NULL,
  _openid       VARCHAR(64)   NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_favorites_object
    FOREIGN KEY (object_code) REFERENCES objects (code)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT uq_favorites_object
    UNIQUE (object_code, _openid)
);


-- 索引：为什么只有这两个
--   chapters.slug 的 UNIQUE   —— 前端按 slug 查章节，必须唯一；UNIQUE 自带索引
--   objects.code  的 UNIQUE   —— 前端按 code 绑定 3D 对象，必须唯一
--   idx_objects_chapter_id    —— Day 17 读接口会「按阶段取该阶段的所有物件」，
--                                没有它就要全表扫。
--                                ⚠️ 外键不会自动建索引，必须显式建（PG 和 MySQL 都一样）
--   idx_favorites_openid      —— GET /api/favorites 按 _openid 过滤，同理
-- 没给 chapters.title、objects.name 建索引：这两列只用于展示，从不作为查询条件，
-- 给不查询的列加索引只会拖慢写入。
CREATE INDEX IF NOT EXISTS idx_objects_chapter_id ON objects (chapter_id);
CREATE INDEX IF NOT EXISTS idx_favorites_openid   ON favorites (_openid);


-- ============================================================================
-- 第 2 段 · 权限第一层：GRANT（表级 + 序列级）
--
-- CloudBase PG 预置三个业务角色：
--   anon           未登录访客（前端 Publishable Key）
--   authenticated  已登录用户（前端 access token）
--   service_role   服务端（API Key，绕过 RLS）
-- 应用流量必须落在这三者之一，其他系统角色不可用。
--
-- 授权思路（和后面 RLS 配对使用）：
--   chapters / objects 是公开作品集内容 → anon 只给读
--   favorites 是用户私有数据          → 只给 authenticated，且由 RLS 再收一层
--
-- ⚠️ 序列必须单独授权：SERIAL 主键背后是一个独立的 SEQUENCE 对象，
--    给了表的 INSERT 权限 ≠ 给了序列的使用权，漏了这句写入会报
--    permission denied for sequence objects_id_seq。
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT ON TABLE public.chapters TO anon, authenticated;
GRANT SELECT ON TABLE public.objects  TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.favorites TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.chapters_id_seq  TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.objects_id_seq   TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.favorites_id_seq TO authenticated;


-- ============================================================================
-- 第 3 段 · 权限第二层：RLS（行级安全）
--
-- 关键区别（官方强调）：安全规则是「校验型」，不是「过滤型」——
-- 系统在执行查询之前先判断查询条件是不是安全规则的子集，
-- 不满足就直接拒绝，**不会**先取数据再筛掉不该看的部分。
-- 所以策略必须写成让正常查询本身就成立的形式。
--
-- 写之前先 DROP POLICY IF EXISTS：CREATE POLICY 不是幂等的，
-- 重复执行会报 policy already exists，加这句就能重复跑。
--
-- ⚠️ auth.uid() 在 CloudBase PG 里返回 text（不是 uuid，这点和 Supabase 不同）。
--    所以归属列用 VARCHAR(64) 与之直接匹配；若写成 uuid 列会报
--    operator does not exist: uuid = text。
-- ============================================================================

ALTER TABLE public.chapters  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.objects   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

-- 公开内容：任何人都能读（作品集页面就是给所有人看的）
DROP POLICY IF EXISTS p_chapters_public_read ON public.chapters;
CREATE POLICY p_chapters_public_read ON public.chapters
  FOR SELECT USING (true);

DROP POLICY IF EXISTS p_objects_public_read ON public.objects;
CREATE POLICY p_objects_public_read ON public.objects
  FOR SELECT USING (true);

-- 收藏：每个人只能读 / 写自己名下的行
-- USING 管「能看见哪些行」，WITH CHECK 管「能写成什么行」，两个都要写。
DROP POLICY IF EXISTS p_favorites_own ON public.favorites;
CREATE POLICY p_favorites_own ON public.favorites
  FOR ALL
  USING     (_openid = auth.uid())
  WITH CHECK (_openid = auth.uid());


-- ============================================================================
-- MySQL 与 PostgreSQL 写法差异（Day 16 定的选型依据，共 6 处）
--   1. 自增主键   MySQL: INT UNSIGNED AUTO_INCREMENT ／ PG: SERIAL
--   2. 字段注释   MySQL: 写在字段行内 COMMENT '...'   ／ PG: 独立语句 COMMENT ON COLUMN
--                 （本次因 CloudBase 拦截已全部改为 -- 行内注释，两侧都不用）
--   3. 时间类型   MySQL: TIMESTAMP（不带时区）        ／ PG: TIMESTAMPTZ（带时区）
--   4. 小数       MySQL: DECIMAL(6,3)                 ／ PG: NUMERIC(6,3)（同义）
--   5. 表选项     MySQL: ENGINE=InnoDB DEFAULT CHARSET=... ／ PG: 不需要
--   6. 权限模型   MySQL: 靠账号 GRANT                  ／ PG: GRANT + RLS 双层
-- ============================================================================


-- ============================================================================
-- 建完后的自检：跑下面三条 SELECT，确认结构与权限都生效
-- ============================================================================

-- ⚠️ 中文列别名必须加双引号：PostgreSQL 的标识符规则只认字母/数字/下划线，
--    非 ASCII 标识符不加引号属未定义行为（各版本表现不一，可能直接报
--    syntax error at or near "检查项"）。加引号后稳定输出中文表头。
SELECT '检查 1 · 三张表的字段结构' AS "检查项";

SELECT table_name     AS "表",
       column_name    AS "字段",
       data_type      AS "类型",
       is_nullable    AS "可空",
       column_default AS "默认值"
FROM   information_schema.columns
WHERE  table_name IN ('chapters', 'objects', 'favorites')
ORDER  BY table_name, ordinal_position;

SELECT '检查 2 · 外键是否建立成功（应看到 2 个）' AS "检查项";

SELECT tc.table_name       AS "本表",
       tc.constraint_name  AS "约束名",
       kcu.column_name     AS "本表字段",
       ccu.table_name      AS "指向表",
       ccu.column_name     AS "指向字段"
FROM   information_schema.table_constraints tc
JOIN   information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
JOIN   information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name
WHERE  tc.constraint_type = 'FOREIGN KEY'
  AND  tc.table_name IN ('objects', 'favorites');

SELECT '检查 3 · 权限是否授到（应看到 anon / authenticated 的记录）' AS "检查项";

SELECT table_name     AS "表",
       grantee        AS "被授权角色",
       privilege_type AS "权限"
FROM   information_schema.role_table_grants
WHERE  table_schema = 'public'
  AND  table_name IN ('chapters', 'objects', 'favorites')
  AND  grantee IN ('anon', 'authenticated')
ORDER  BY table_name, grantee, privilege_type;

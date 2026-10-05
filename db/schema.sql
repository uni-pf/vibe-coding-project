-- ============================================================================
-- 《海风》· 画中的一生 —— 数据库表结构
-- 归属：Day 16 · 板块① 数据模型设计
-- 目标库：CloudBase 关系型数据库（PostgreSQL）
--
-- 【这个文件是什么】
--   它是表的「图纸」。执行它，表就建好了；它也是唯一的字段定义处。
--
-- 【为什么是 PostgreSQL 不是 MySQL】
--   CloudBase 官方已把 MySQL 的 Agent 技能标记为 deprecated，
--   并写明「New environments should use PostgreSQL」。
--   两者都是 SQL，本文件的完成标准（schema / seed / select）不受影响。
--   差别只在写法，见文件末尾的「MySQL 与 PostgreSQL 写法差异」。
--
-- 【为什么这样建表】
--   现在物件清单写死在前端 src/data/objects.js 里，是一个数组。
--   搬进数据库的目的只有一个：让「加一件物件」从改代码变成插一行数据。
--   两张表分开的理由很直接 —— 物件依附于阶段而存在，阶段本身不依赖任何物件。
--
-- 【表之间的关系】
--   chapters（阶段）  1 ────<  N  objects（物件）
--                        ↑
--              objects.chapter_id
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 表一：chapters —— 人物一生的阶段
--
-- 存什么：一条记录 = 一个年龄段 / 一次转折，页面上的「第几章」就是这里的一行。
-- 谁引用它：objects.chapter_id
-- ----------------------------------------------------------------------------
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

COMMENT ON TABLE  chapters               IS '人物一生的阶段（章节），一条记录 = 一个年龄段或一次转折';
COMMENT ON COLUMN chapters.id            IS '阶段唯一编号，自增主键。物件表通过 chapter_id 指向它。SERIAL = 自动增长的整数序列，等于 MySQL 的 AUTO_INCREMENT';
COMMENT ON COLUMN chapters.slug          IS '英文短标识，用于网址与前端路由，如 sea-wind。UNIQUE 约束保证不重复，因为前端靠它找章节';
COMMENT ON COLUMN chapters.title         IS '阶段标题，内容页大字，如「十八岁」';
COMMENT ON COLUMN chapters.subtitle      IS '副标题或时间标注，如「一九六八 · 夏」。可空，因为早期阶段还没定年份';
COMMENT ON COLUMN chapters.painting_name IS '本阶段对应的怀斯画作名，如「Wind from the Sea」。可空，因为阶段先于画作确定';
COMMENT ON COLUMN chapters.painting_year IS '画作创作年份。用 SMALLINT 而非 INTEGER：年份不会超过 32767，占一半存储';
COMMENT ON COLUMN chapters.summary       IS '一句话概述，显示在章节列表上。用 VARCHAR(255) 而非 TEXT：列表页只取这一列，TEXT 会拖慢查询';
COMMENT ON COLUMN chapters.sort_order    IS '章节播放顺序，不等于 id。id 只管唯一，顺序会被人工调整，所以要单独一列';
COMMENT ON COLUMN chapters.status        IS '开发状态：planned 已规划 / in_progress 制作中 / released 已上线。用文字而非数字编号——代码里只做相等判断不做加减，可读性优先';
COMMENT ON COLUMN chapters._openid       IS '【CloudBase 硬性要求】记录归属用户。登录时由服务端自动填充，普通 INSERT 不要手动填。官方要求新建表必须包含此列';
COMMENT ON COLUMN chapters.created_at    IS '记录创建时间。用 TIMESTAMPTZ 而非 TIMESTAMP：带时区，跨时区读写不会偏';


-- ----------------------------------------------------------------------------
-- 表二：objects —— 房间里的可探索物件
--
-- 存什么：一条记录 = 一件可点击的物件，含它的 3D 坐标、可交互区间和点开后的回忆配文。
-- 谁引用它：前端 src/data/objects.js 的数组将被它替代（Day 17 读接口的落点）
-- ----------------------------------------------------------------------------
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

  -- 外键：保证不会出现「chapter_id 指向一个不存在的阶段」这种脏数据。
  -- ON DELETE RESTRICT 而非 CASCADE：删阶段前必须先处理掉阶段下的物件，
  -- 不然连带删掉写好的配文，这类误删事后无法恢复。
  CONSTRAINT fk_objects_chapter
    FOREIGN KEY (chapter_id) REFERENCES chapters (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  -- 区间必须成立，否则「相机走到没走到」的判断会失效
  CONSTRAINT chk_objects_route_range
    CHECK (route_start >= 0 AND route_end <= 1 AND route_start < route_end)
);

COMMENT ON TABLE  objects                IS '房间里的可探索物件，含 3D 坐标与回忆配文';
COMMENT ON COLUMN objects.id             IS '物件唯一编号，自增主键';
COMMENT ON COLUMN objects.chapter_id     IS '★ 关联字段：指向 chapters.id。一件物件只属于一个阶段';
COMMENT ON COLUMN objects.code           IS '物件编码，如 obj-01。前端渲染时用它给 3D 场景里的网格打标记，UNIQUE 保证不重复';
COMMENT ON COLUMN objects.name           IS '物件名，内容页标题，如「一盏没关的台灯」';
COMMENT ON COLUMN objects.shape          IS '用哪种几何体代替真模型：lamp / book / disc / box。与 src/scene/objects.js 的分支对应';
COMMENT ON COLUMN objects.pos_x          IS '房间内 X 坐标，单位约等于米。用 NUMERIC(6,3) 而非浮点：3 位小数足够，且不会有浮点误差';
COMMENT ON COLUMN objects.pos_y          IS '房间内 Y 坐标（高度）';
COMMENT ON COLUMN objects.pos_z          IS '房间内 Z 坐标（纵深）。三件物件分处近中远三层，靠这个值拉开视差';
COMMENT ON COLUMN objects.route_start    IS '相机路线进度下界，取值 0~1。推进进度落在此区间内物件才可点';
COMMENT ON COLUMN objects.route_end      IS '相机路线进度上界，取值 0~1，须大于 route_start（由 chk_objects_route_range 强制）';
COMMENT ON COLUMN objects.color          IS '未解锁时的自发光色，#RRGGBB。定长 7 而非变长：格式固定，省空间也防脏数据';
COMMENT ON COLUMN objects.memory_title   IS '点击后内容页的标题。可空，因为物件可以先只做视觉不给内容';
COMMENT ON COLUMN objects.memory_body    IS '点击后那段回忆的正文。用 TEXT 而非 VARCHAR：正文长度不可预估，超过 255 就得换类型';
COMMENT ON COLUMN objects.memory_caption IS '配图的说明文字，显示在图片下方';
COMMENT ON COLUMN objects.sort_order     IS '同一阶段内的展示顺序。id 只保证唯一，好不好看看这一列';
COMMENT ON COLUMN objects._openid        IS '【CloudBase 硬性要求】记录归属用户，同 chapters 表。登录时服务端自动填充';
COMMENT ON COLUMN objects.created_at     IS '记录创建时间';


-- ============================================================================
-- 索引说明（为什么只有这几个）
--
--   chapters.slug 的 UNIQUE   —— 前端按 slug 查章节，必须唯一；UNIQUE 自带索引
--   objects.code  的 UNIQUE   —— 前端按 code 绑定 3D 对象，必须唯一
--   idx_objects_chapter_id    —— Day 17 读接口会「按阶段取该阶段的所有物件」，
--                                没有它就要全表扫。
--                                ⚠️ 外键不会自动建索引，必须显式建（PG 和 MySQL 都一样）
--
--   没给 chapters.title、objects.name 建索引：这两列只用于展示，从不作为查询条件。
--   给不查询的列加索引只会拖慢写入。
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_objects_chapter_id ON objects (chapter_id);


-- ============================================================================
-- MySQL 与 PostgreSQL 的写法差异（本次改动对照，共 6 处）
--
--   1. 自增主键   MySQL: INT UNSIGNED AUTO_INCREMENT
--                 PG:    SERIAL
--   2. 字段注释   MySQL: 写在字段行内 COMMENT '...'
--                 PG:    独立语句 COMMENT ON COLUMN 表.字段 IS '...'
--   3. 时间类型   MySQL: TIMESTAMP（不带时区）
--                 PG:    TIMESTAMPTZ（带时区，跨时区不偏）
--   4. 小数       MySQL: DECIMAL(6,3)
--                 PG:    NUMERIC(6,3)（同义；PG 里 DECIMAL 是 NUMERIC 的别名）
--   5. 表选项     MySQL: ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=...
--                 PG:    不需要，编码在建库时定，默认 UTF8
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 验证 SQL：建完表跑这三条，确认结构生效
-- ----------------------------------------------------------------------------
SELECT 'chapters 表结构' AS 检查项;

SELECT column_name    AS 字段,
       data_type      AS 类型,
       is_nullable    AS 可空,
       column_default AS 默认值
FROM   information_schema.columns
WHERE  table_name = 'chapters'
ORDER  BY ordinal_position;

SELECT 'objects 表结构' AS 检查项;

SELECT column_name    AS 字段,
       data_type      AS 类型,
       is_nullable    AS 可空,
       column_default AS 默认值
FROM   information_schema.columns
WHERE  table_name = 'objects'
ORDER  BY ordinal_position;

SELECT '关联关系（外键）是否建立成功' AS 检查项;

SELECT tc.constraint_name AS 约束名,
       kcu.column_name    AS 本表字段,
       ccu.table_name     AS 指向表,
       ccu.column_name    AS 指向字段
FROM   information_schema.table_constraints tc
JOIN   information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
JOIN   information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name
WHERE  tc.constraint_type = 'FOREIGN KEY'
  AND  tc.table_name = 'objects';
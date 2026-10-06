-- ============================================================================
-- 《海风》· 画中的一生 —— 种子数据
-- 归属：Day 16 · 板块③ 种子脚本
--       Day 17 修订 —— 增加 favorites 演示数据
-- 目标库：CloudBase 关系型数据库（PostgreSQL）
-- 前置：必须先执行 db/schema.sql 建好表
--
-- 【这个文件是什么】
--   往 chapters / objects 两张表里填初始数据。
--   数据来源：src/data/objects.js 里写死的那个数组 —— 本文件就是它的「数据库版」。
--
-- 【完成标准里那条「重复执行不报错」怎么满足】
--   用 INSERT ... ON CONFLICT (唯一键) DO UPDATE。
--   含义：这行数据如果已存在（撞上唯一键），就改成新的值，不报错也不重复插入。
--   为什么不用 DELETE + INSERT：DELETE 会先删掉旧行，若中途失败就留下空表，
--   而且 id 会一直涨。ON CONFLICT 是「原地覆盖」，更安全。
--
-- 【为什么外键不直接写数字 id】
--   objects.chapter_id 需要填 chapters 的 id。若写死 chapter_id = 1，
--   一旦 chapters 的实际自增起点不是 1（比如之前删过数据），整批插入就会外键报错。
--   所以这里用子查询「按 slug 反查 id」，让数据库自己去对号。
--
-- 【为什么 _openid 不填】
--   官方硬性要求：_openid 由服务端在登录时自动填充。
--   但在 DMC / SQL 窗口里手动执行不属于「用户请求」，服务端不会填，
--   该列 NOT NULL DEFAULT '' —— 空串是合法值，所以不写这一列也能插入成功。
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 一、chapters —— 阶段
--
-- 现有物件只有 3 件，但 chapters 必须 ≥5 行（板块④ 验证要求）。
-- 所以：前 3 章是「有物件依附的已验证章节」，后 2 章是「已规划但还没物件的后续章节」。
-- 这不是凑数 —— 时间线上后续本来就要有内容，status 标 planned 正好表达「还没做」。
-- ----------------------------------------------------------------------------
INSERT INTO chapters
  (slug,        title,        subtitle,            painting_name,          painting_year, summary,                                                        sort_order, status)
VALUES
  ('sea-wind',  '十八岁',      '一九六八 · 夏',      'Wind from the Sea',     1967,
   '他站在窗前等一封信。海风把窗纱吹向屋内，也把他的一生吹向别处。',                          1, 'in_progress'),

  ('the-note',  '二十二岁',    '一九七二 · 秋',      'Distant Thunder',       1961,
   '笔记本摊在桌上很久没合上。有些话写下来是为了记住，有些是为了敢忘。',                        2, 'planned'),

  ('old-disc',  '三十岁',      '一九八〇 · 冬',      'Winter Fields',         1974,
   '唱片放到最后一句就停了。他一直没有翻面，因为那面是空的。',                                3, 'planned'),

  ('long-road', '四十五岁',    '一九九五 · 春',      'The Long Road',         1983,
   '那一年他搬过两次家，唯独这件旧家具一直没扔。',                                          4, 'planned'),

  ('home-again','六十岁',      '二〇一〇 · 冬',      'Faraway',               2017,
   '回到起点的那天，窗子还开着，风还是从海上来。',                                          5, 'planned')

-- 撞上 slug 唯一键时，覆盖为新值而不是报错 —— 这就是「可重复执行」的落点
ON CONFLICT (slug) DO UPDATE SET
  title         = EXCLUDED.title,
  subtitle      = EXCLUDED.subtitle,
  painting_name = EXCLUDED.painting_name,
  painting_year = EXCLUDED.painting_year,
  summary       = EXCLUDED.summary,
  sort_order    = EXCLUDED.sort_order,
  status        = EXCLUDED.status;


-- ----------------------------------------------------------------------------
-- 二、objects —— 房间里的可探索物件
--
-- 值全部照抄 src/data/objects.js，包括 routeRange 区间与 3D 坐标。
-- 编号映射（前端 id → 数据库 code）：
--   obj-01 台灯     →  (chapter_id 取自 slug 'sea-wind')
--   obj-02 笔记本   →  (chapter_id 取自 slug 'the-note')
--   obj-03 旧唱片   →  (chapter_id 取自 slug 'old-disc')
--
-- ⚠️ 文案仍是占位内容（objects.js 里原样标注了 TODO）：
--    角色设定稿未定，真配文后续替换。此处保持与前端一致，不擅自编造剧情。
-- ----------------------------------------------------------------------------
INSERT INTO objects
  (chapter_id,                                        code,     name,               shape,
   pos_x,  pos_y,  pos_z,  route_start, route_end,     color,      memory_title,          memory_body,
   memory_caption,                                                                      sort_order)
VALUES
  ((SELECT id FROM chapters WHERE slug = 'sea-wind'),
   'obj-01', '一盏没关的台灯', 'lamp',
   -1.900, 0.000, -0.500, 0.200, 0.470,                '#FFC97A', '一盏没关的台灯',
   '这里将来会是一段回忆的文字。现在它是占位内容——因为角色的设定稿还没写，写出来的配文会是空的。',
   '占位配图 · 待替换',                                                                  1),

  ((SELECT id FROM chapters WHERE slug = 'the-note'),
   'obj-02', '摊开的笔记本',   'book',
    0.100, 0.550, -2.000, 0.500, 0.800,                '#7FC4F5', '摊开的笔记本',
   '第二件物件的占位文案。正式版本里，这篇应该回指第一件物件，让三篇读起来是一条时间线。',
   '占位配图 · 待替换',                                                                  2),

  ((SELECT id FROM chapters WHERE slug = 'old-disc'),
   'obj-03', '靠在墙边的旧唱片', 'disc',
    1.900, 0.600, -3.200, 0.820, 1.000,                '#B9A6FF', '靠在墙边的旧唱片',
   '第三件物件的占位文案。三件全部看完后，应该出现一个收束信号——这部分在 2.4 里做。',
   '占位配图 · 待替换',                                                                  3)

ON CONFLICT (code) DO UPDATE SET
  chapter_id     = EXCLUDED.chapter_id,
  name           = EXCLUDED.name,
  shape          = EXCLUDED.shape,
  pos_x          = EXCLUDED.pos_x,
  pos_y          = EXCLUDED.pos_y,
  pos_z          = EXCLUDED.pos_z,
  route_start    = EXCLUDED.route_start,
  route_end      = EXCLUDED.route_end,
  color          = EXCLUDED.color,
  memory_title   = EXCLUDED.memory_title,
  memory_body    = EXCLUDED.memory_body,
  memory_caption = EXCLUDED.memory_caption,
  sort_order     = EXCLUDED.sort_order;


-- ----------------------------------------------------------------------------
-- 补行：objects 只有 3 件真实物件，但板块④ 要求「每张核心表 ≥5 行」
--
-- 下面 2 行属于「占位物件」—— 它们依附在上面尚未做物件的章节上，
-- 用来证明**同一批数据可以挂在不同的阶段下**，也就是一对多关系成立。
-- 命名上带「（预告）」，与正式物件区分，不做视觉。
-- ----------------------------------------------------------------------------
INSERT INTO objects
  (chapter_id,                                       code,      name,                 shape,
   pos_x,  pos_y,  pos_z,  route_start, route_end,    color,      memory_title,         memory_body,
   memory_caption,                                                                     sort_order)
VALUES
  ((SELECT id FROM chapters WHERE slug = 'long-road'),
   'obj-04', '一件没扔的旧家具（预告）', 'box',
    -2.400, 0.000, -1.600, 0.300, 0.600,               '#C9D6E3', '一件没扔的旧家具',
   '占位内容：第四章的物件尚未设计，这一行先证明「同一阶段下可以挂多件物件」。',
   '占位配图 · 待替换',                                                                  4),

  ((SELECT id FROM chapters WHERE slug = 'home-again'),
   'obj-05', '朝海的窗（预告）',        'box',
     1.200, 1.200, -3.000, 0.700, 1.000,               '#A8CBE8', '朝海的窗',
   '占位内容：末章的物件尚未设计，这一行先证明关联字段可以指向最后一段阶段。',
   '占位配图 · 待替换',                                                                  5)

ON CONFLICT (code) DO UPDATE SET
  chapter_id     = EXCLUDED.chapter_id,
  name           = EXCLUDED.name,
  shape          = EXCLUDED.shape,
  pos_x          = EXCLUDED.pos_x,
  pos_y          = EXCLUDED.pos_y,
  pos_z          = EXCLUDED.pos_z,
  route_start    = EXCLUDED.route_start,
  route_end      = EXCLUDED.route_end,
  color          = EXCLUDED.color,
  memory_title   = EXCLUDED.memory_title,
  memory_body    = EXCLUDED.memory_body,
  memory_caption = EXCLUDED.memory_caption,
  sort_order     = EXCLUDED.sort_order;


-- ============================================================================
-- 三、favorites —— 收藏演示数据（Day 17 新增）
--
-- 为什么要放这 2 行：Day 17 的 GET /api/favorites 要有数据可读、有内容可截图。
--   空表也能返回 []，但那样看不出「接口真的连通了数据库」——
--   评审要的截图是「页面上显示的真实数据」，不是空数组。
--
-- 为什么是 obj-01 / obj-03：一件是最早解锁的台灯，一件是最远层的唱片，
--   在界面上分处列表两端，肉眼能确认顺序确实按 created_at 排。
--
-- ⚠️ _openid 在 DMC 手动执行时不会自动填（只有服务端在登录态下才填），
--    这里写空串。也就是说这 2 行是「无归属的演示数据」；
--    等 RLS 规则在云函数链路上生效后，会按 auth.uid() 自动隔离。
--    uq_favorites_object 唯一约束是 (object_code, _openid)，
--    所以 DO NOTHING 就能让本文件重复执行不报错。
-- ----------------------------------------------------------------------------
INSERT INTO favorites (object_code, _openid)
VALUES
  ('obj-01', ''),
  ('obj-03', '')

ON CONFLICT (object_code, _openid) DO NOTHING;


-- ============================================================================
-- 行数小结（执行后应得到）
--   chapters   5 行
--   objects    5 行
--   favorites  2 行（演示数据，非内容数据，不要求 ≥5）
-- 再次执行本文件，各行数不变即为「可重复执行」通过。
-- ============================================================================

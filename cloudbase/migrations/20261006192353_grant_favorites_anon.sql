-- ============================================================================
-- 迁移：让匿名访客可以读/写自己的收藏
-- 归属：Day 17 · 板块① 前置（Day 16 的权限层只授给了 authenticated）
-- 版本：20261006192353
--
-- 为什么需要这次迁移：
--   本迁移之前，favorites 表的权限是：
--     GRANT SELECT/INSERT/UPDATE/DELETE ON favorites TO authenticated;   ← 只有登录用户
--     CREATE POLICY p_favorites_own ... USING (_openid = auth.uid());    ← 只有登录用户
--   而《海风》没有登录功能，所有访客都是匿名（角色 anon）。结果是：
--     读 → anon 连表级权限都没有，直接 permission denied
--     写 → 即使给了权限，策略要求 _openid = auth.uid()，匿名下 auth.uid() 为 NULL，
--          等式结果为 NULL（不是 true）→ 同样被拒
--   所以接口会「不报错，但永远返回空数组 / 永远写不进去」——
--   这类"静默失败"比报错更难查，必须在接接口之前先修掉。
--
-- 本项目的口径：
--   没有登录，就不存在"某个用户"。全部匿名访客统一记为 _openid = '' 这个占位值
--   （favorites._openid 的列默认值本来就是 ''）。
--   策略因此写成 _openid = ''，语义是"匿名访客公共的收藏"。
--
-- 范围说明：本次只动权限（GRANT / POLICY），不动表结构（无 ALTER TABLE）——
--   符合 Day 17「今日不做：改表结构」。
-- ============================================================================

-- 权限第一层：表级与序列级授权
--   （SERIAL 主键的伴生序列不会随表一起授权，漏了它的表现是：
--     SELECT 正常，INSERT 报 permission denied for sequence favorites_id_seq）
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.favorites TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.favorites_id_seq TO anon;

-- 权限第二层：行级策略
--   先删后建，保证本文件可重复执行（DROP POLICY 没有 IF EXISTS 之外的写法）
DROP POLICY IF EXISTS p_favorites_anon ON public.favorites;

CREATE POLICY p_favorites_anon ON public.favorites
  FOR ALL
  TO anon
  USING     (_openid = '')
  WITH CHECK (_openid = '');

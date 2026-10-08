-- Day 22 · 为 objects 增加软删除标记，并放开 anon 的 UPDATE 权限
-- 背景：本接口（PATCH / DELETE）需要 UPDATE 能力，
--       Day 16/17 只给 anon 授了 objects 的 SELECT，直接调会报 permission denied。

-- 1) 软删除标记：true 表示已删除，正常查询跳过
ALTER TABLE public.objects ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

-- 2) 删除时间：删错了找回来时能知道是什么时候删的（审计用），未删除时为 NULL
ALTER TABLE public.objects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 3) 权限第一层 GRANT：anon 需要 UPDATE 才能改记录 / 打软删除标记
GRANT UPDATE ON TABLE public.objects TO anon, authenticated;

-- 4) 权限第二层 RLS：objects 原来只有 SELECT 策略，UPDATE 会因“无适用策略”被默认拒绝
DROP POLICY IF EXISTS p_objects_anon_write ON public.objects;
CREATE POLICY p_objects_anon_write ON public.objects
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

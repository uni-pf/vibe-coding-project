-- 权限第一层：GRANT（表级 + 序列级）
GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT ON TABLE public.chapters TO anon, authenticated;
GRANT SELECT ON TABLE public.objects  TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.favorites TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.chapters_id_seq  TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.objects_id_seq   TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.favorites_id_seq TO authenticated;

-- 权限第二层：RLS（行级）
ALTER TABLE public.chapters  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.objects   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_chapters_public_read ON public.chapters;
CREATE POLICY p_chapters_public_read ON public.chapters
  FOR SELECT USING (true);

DROP POLICY IF EXISTS p_objects_public_read ON public.objects;
CREATE POLICY p_objects_public_read ON public.objects
  FOR SELECT USING (true);

DROP POLICY IF EXISTS p_favorites_own ON public.favorites;
CREATE POLICY p_favorites_own ON public.favorites
  FOR ALL
  USING     (_openid = auth.uid())
  WITH CHECK (_openid = auth.uid());

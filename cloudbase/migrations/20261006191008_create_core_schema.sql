CREATE TABLE IF NOT EXISTS public.chapters (
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

CREATE TABLE IF NOT EXISTS public.objects (
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

  CONSTRAINT fk_objects_chapter
    FOREIGN KEY (chapter_id) REFERENCES public.chapters (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT chk_objects_route_range
    CHECK (route_start >= 0 AND route_end <= 1 AND route_start < route_end)
);

CREATE TABLE IF NOT EXISTS public.favorites (
  id            SERIAL        PRIMARY KEY,
  object_code   VARCHAR(32)   NOT NULL,
  _openid       VARCHAR(64)   NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_favorites_object
    FOREIGN KEY (object_code) REFERENCES public.objects (code)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT uq_favorites_object
    UNIQUE (object_code, _openid)
);

CREATE INDEX IF NOT EXISTS idx_objects_chapter_id ON public.objects (chapter_id);
CREATE INDEX IF NOT EXISTS idx_favorites_openid   ON public.favorites (_openid);

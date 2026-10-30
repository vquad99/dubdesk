-- Dubbing QC: first schema.
-- One video = one review job per round. A round starts when a video is ready
-- for review (first dub) and again after each admin regenerate.

CREATE TABLE users (
    id             SERIAL PRIMARY KEY,
    email          TEXT NOT NULL UNIQUE,
    name           TEXT NOT NULL,
    role           TEXT NOT NULL CHECK (role IN ('admin', 'reviewer', 'operator')),
    password_hash  TEXT NOT NULL,
    active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at  TIMESTAMPTZ
);

-- id = sha256 of the cookie token, so a leaked table row cannot be replayed.
CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE videos (
    id                     SERIAL PRIMARY KEY,
    title                  TEXT NOT NULL,
    original_filename      TEXT NOT NULL,
    source_key             TEXT,             -- S3 key of the uploaded English video
    dubbed_key             TEXT,             -- S3 key of the latest Hindi video
    duration_sec           NUMERIC(10, 2),
    source_lang            TEXT NOT NULL DEFAULT 'en',
    target_lang            TEXT NOT NULL DEFAULT 'hi',
    status                 TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN (
                               'uploading', 'uploaded', 'dubbing', 'ready_for_review',
                               'in_review', 'submitted', 'regenerating', 'done', 'failed')),
    elevenlabs_dubbing_id  TEXT,
    error                  TEXT,
    uploaded_by            INTEGER REFERENCES users(id),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX videos_status_idx ON videos(status);

CREATE TABLE jobs (
    id            SERIAL PRIMARY KEY,
    video_id      INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    round         INTEGER NOT NULL DEFAULT 1,
    status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
                      'queued', 'assigned', 'submitted', 'returned', 'approved', 'done')),
    assigned_to   INTEGER REFERENCES users(id),
    assigned_at   TIMESTAMPTZ,
    locked_until  TIMESTAMPTZ,
    submitted_at  TIMESTAMPTZ,
    reviewed_by   INTEGER REFERENCES users(id),
    reviewed_at   TIMESTAMPTZ,
    admin_note    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (video_id, round)
);
CREATE INDEX jobs_status_idx ON jobs(status);

CREATE TABLE segments (
    id                SERIAL PRIMARY KEY,
    video_id          INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    el_segment_id     TEXT,                  -- ElevenLabs segment id (blank for a reviewer-added line)
    start_sec         NUMERIC(10, 3) NOT NULL,
    end_sec           NUMERIC(10, 3) NOT NULL,
    speaker           TEXT,
    en_text           TEXT NOT NULL DEFAULT '',
    hi_text_original  TEXT NOT NULL DEFAULT '',  -- Hindi as ElevenLabs last produced it
    hi_text           TEXT NOT NULL DEFAULT '',  -- Hindi as the reviewer left it
    flag              TEXT CHECK (flag IN ('missing', 'wrong_meaning', 'wrong_timing')),
    comment           TEXT,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (video_id, el_segment_id)
);
CREATE INDEX segments_video_idx ON segments(video_id, start_sec);

CREATE TABLE segment_edits (
    id          SERIAL PRIMARY KEY,
    segment_id  INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    job_id      INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
    user_id     INTEGER REFERENCES users(id),
    field       TEXT NOT NULL,
    old_value   TEXT,
    new_value   TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE credits_log (
    id          SERIAL PRIMARY KEY,
    video_id    INTEGER REFERENCES videos(id) ON DELETE SET NULL,
    action      TEXT NOT NULL,       -- dub / regenerate / render
    credits     INTEGER NOT NULL,
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

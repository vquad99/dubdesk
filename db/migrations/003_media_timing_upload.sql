-- Media files, waveform, uploads, line timing edits, structural line changes, Sarvam job tracking.

-- Lines: keep the first timing so the admin sees what moved; soft delete so history survives.
ALTER TABLE segments ADD COLUMN start_sec_original NUMERIC(10, 3);
ALTER TABLE segments ADD COLUMN end_sec_original NUMERIC(10, 3);
ALTER TABLE segments ADD COLUMN origin TEXT NOT NULL DEFAULT 'source'
    CHECK (origin IN ('source', 'split', 'inserted', 'merged'));
ALTER TABLE segments ADD COLUMN deleted_at TIMESTAMPTZ;
UPDATE segments SET start_sec_original = start_sec, end_sec_original = end_sec;
DROP INDEX segments_video_idx;
CREATE INDEX segments_video_idx ON segments(video_id, start_sec) WHERE deleted_at IS NULL;

-- Videos: stored files, waveform, Sarvam job.
ALTER TABLE videos ADD COLUMN size_bytes BIGINT;
ALTER TABLE videos ADD COLUMN mime TEXT;
ALTER TABLE videos ADD COLUMN peaks_key TEXT;            -- waveform of the source audio
ALTER TABLE videos ADD COLUMN sarvam_job_id TEXT;
ALTER TABLE videos ADD COLUMN sarvam_status TEXT;
ALTER TABLE videos ADD COLUMN sarvam_progress INTEGER;
ALTER TABLE videos ADD COLUMN next_poll_at TIMESTAMPTZ;   -- when the background worker checks Sarvam next
ALTER TABLE videos DROP CONSTRAINT videos_status_check;
ALTER TABLE videos ADD CONSTRAINT videos_status_check CHECK (status IN (
    'uploading', 'processing', 'uploaded', 'dubbing', 'ready_for_review',
    'in_review', 'submitted', 'regenerating', 'done', 'failed'));
CREATE INDEX videos_poll_idx ON videos(next_poll_at) WHERE status = 'dubbing';

-- Chunked uploads: a big file arrives in parts so one dropped connection never restarts it.
CREATE TABLE uploads (
    id           TEXT PRIMARY KEY,                  -- random id, also the temp file name
    video_id     INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    file_name    TEXT NOT NULL,
    mime         TEXT NOT NULL,
    size_bytes   BIGINT NOT NULL,
    chunk_bytes  INTEGER NOT NULL,
    received     BIGINT NOT NULL DEFAULT 0,        -- bytes written so far, in order
    finished_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE segment_edits DROP CONSTRAINT IF EXISTS segment_edits_field_check;

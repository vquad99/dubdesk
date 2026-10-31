-- Sarvam usage: who sent each video to Sarvam, how many minutes it billed, which Sarvam job.
ALTER TABLE credits_log ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE credits_log ADD COLUMN minutes NUMERIC(10, 2);
ALTER TABLE credits_log ADD COLUMN sarvam_job_id TEXT;
CREATE INDEX credits_log_created_idx ON credits_log(created_at);
CREATE INDEX credits_log_user_idx ON credits_log(user_id);

-- Admin-editable settings (Sarvam price per minute, plan limit).
CREATE TABLE settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Videos sent to Sarvam before usage was recorded.
INSERT INTO credits_log (video_id, action, credits, minutes, user_id, sarvam_job_id, note, created_at)
SELECT v.id, 'dub', 0, ROUND(COALESCE(v.duration_sec, 0) / 60, 2), v.uploaded_by, v.sarvam_job_id, v.title, v.updated_at
  FROM videos v
 WHERE v.sarvam_job_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM credits_log c WHERE c.sarvam_job_id = v.sarvam_job_id);

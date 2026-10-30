-- Who did what, when, from where: one row per action, kept for audits and personal history.
CREATE TABLE activity_log (
    id          BIGSERIAL PRIMARY KEY,
    user_id     INTEGER REFERENCES users(id),
    action      TEXT NOT NULL,              -- e.g. login, job.claimed, line.edited, video.uploaded
    video_id    INTEGER REFERENCES videos(id) ON DELETE SET NULL,
    job_id      INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
    details     TEXT,                       -- short human-readable note
    ip          TEXT,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX activity_user_idx ON activity_log(user_id, created_at DESC);
CREATE INDEX activity_time_idx ON activity_log(created_at DESC);
CREATE INDEX activity_action_idx ON activity_log(action, created_at DESC);
CREATE INDEX activity_video_idx ON activity_log(video_id, created_at DESC);

-- Active working time on a job, per person per day, from the review screen's heartbeat.
CREATE TABLE work_time (
    job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    day         DATE NOT NULL,
    seconds     INTEGER NOT NULL DEFAULT 0,
    last_beat   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (job_id, user_id, day)
);
CREATE INDEX work_time_user_idx ON work_time(user_id, day);

CREATE INDEX segment_edits_user_idx ON segment_edits(user_id, created_at);
CREATE INDEX segments_reviewed_by_idx ON segments(reviewed_by);

-- Carry the job history already recorded into the new log.
INSERT INTO activity_log (user_id, action, video_id, job_id, details, created_at)
SELECT e.user_id, 'job.' || e.action, j.video_id, e.job_id, e.note, e.created_at
  FROM job_events e JOIN jobs j ON j.id = e.job_id;

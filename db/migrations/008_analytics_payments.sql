-- Active review time in 10-minute slots, so hourly / live views are exact (work_time keeps per-day totals).
CREATE TABLE work_slots (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_id    INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
    slot      TIMESTAMPTZ NOT NULL,           -- start of the 10-minute slot
    seconds   INTEGER NOT NULL DEFAULT 0,
    last_beat TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, slot)
);
CREATE INDEX work_slots_slot_idx ON work_slots(slot);

-- Earlier per-day totals land at noon IST of their day, so day / week / month trends include them.
INSERT INTO work_slots (user_id, job_id, slot, seconds, last_beat)
SELECT user_id, MIN(job_id), (day::timestamp + interval '12 hours') AT TIME ZONE 'Asia/Kolkata', SUM(seconds), MAX(last_beat)
  FROM work_time GROUP BY user_id, day
ON CONFLICT DO NOTHING;

-- Vendors and pay rates. NULL rate on a user = use the default in settings.
ALTER TABLE users ADD COLUMN vendor TEXT;
ALTER TABLE users ADD COLUMN pay_per_min NUMERIC(12, 4);   -- per approved video minute
ALTER TABLE users ADD COLUMN pay_per_hour NUMERIC(12, 4);  -- per active hour
ALTER TABLE users ADD COLUMN pay_per_line NUMERIC(12, 4);  -- per corrected line

CREATE INDEX segments_reviewed_at_idx ON segments(reviewed_at) WHERE reviewed_at IS NOT NULL;
CREATE INDEX jobs_reviewed_at_idx ON jobs(reviewed_at) WHERE status IN ('approved', 'done');
CREATE INDEX sessions_last_seen_idx ON sessions(last_seen_at);

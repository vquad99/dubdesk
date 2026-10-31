-- Admin can stop a video (no one can pick it up) and give a job to a chosen reviewer.
ALTER TABLE jobs ADD COLUMN held_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN held_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE jobs ADD COLUMN hold_reason TEXT;

ALTER TABLE job_events DROP CONSTRAINT IF EXISTS job_events_action_check;
ALTER TABLE job_events ADD CONSTRAINT job_events_action_check CHECK (action IN (
    'created', 'claimed', 'released', 'expired', 'submitted', 'approved', 'returned',
    'unlocked', 'regenerated', 'held', 'resumed', 'assigned'));

CREATE INDEX jobs_waiting_idx ON jobs(created_at) WHERE held_at IS NULL AND status IN ('queued', 'assigned');

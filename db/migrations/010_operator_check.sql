-- The operator checks the reviewer's work (reviewer of the reviewer): picks up a submitted job,
-- fixes what is left, then approves it or sends it back to the reviewer.
ALTER TABLE jobs ADD COLUMN qa_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE jobs ADD COLUMN qa_locked_until TIMESTAMPTZ;

ALTER TABLE job_events DROP CONSTRAINT IF EXISTS job_events_action_check;
ALTER TABLE job_events ADD CONSTRAINT job_events_action_check CHECK (action IN (
    'created', 'claimed', 'released', 'expired', 'submitted', 'approved', 'returned',
    'unlocked', 'regenerated', 'held', 'resumed', 'assigned', 'check_started', 'check_released'));

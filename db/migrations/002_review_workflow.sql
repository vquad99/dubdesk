-- Review workflow: per-line "checked" mark, a job history, and login throttling.

ALTER TABLE segments ADD COLUMN reviewed_at TIMESTAMPTZ;
ALTER TABLE segments ADD COLUMN reviewed_by INTEGER REFERENCES users(id);

-- Every state change of a job, newest last. Drives the admin timeline and stats.
CREATE TABLE job_events (
    id          SERIAL PRIMARY KEY,
    job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    user_id     INTEGER REFERENCES users(id),
    action      TEXT NOT NULL CHECK (action IN (
                    'created', 'claimed', 'released', 'expired', 'submitted',
                    'approved', 'returned', 'unlocked', 'regenerated')),
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX job_events_job_idx ON job_events(job_id, created_at);

-- Failed logins, for throttling by email and by address.
CREATE TABLE login_attempts (
    id          BIGSERIAL PRIMARY KEY,
    email       TEXT NOT NULL,
    ip          TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_email_idx ON login_attempts(email, created_at);
CREATE INDEX login_attempts_ip_idx ON login_attempts(ip, created_at);

CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

-- 1) Videos whose latest review was approved are finished (approve did not set this before).
UPDATE videos v SET status = 'done', updated_at = now()
 WHERE v.status <> 'done'
   AND (SELECT j.status FROM jobs j WHERE j.video_id = v.id ORDER BY j.round DESC, j.id DESC LIMIT 1) = 'approved';

-- 2) One-time links to set a password: 'invite' for new users, 'reset' for forgot / admin reset.
-- id = sha256 of the token in the link, so a leaked row cannot be used.
CREATE TABLE password_links (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('invite', 'reset')),
    created_by  INTEGER REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ
);
CREATE INDEX password_links_user_idx ON password_links(user_id);

-- 3) "Forgot password" requests waiting for an admin (when no e-mail service is set up).
CREATE TABLE password_requests (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip           TEXT,
    handled_at   TIMESTAMPTZ,
    handled_by   INTEGER REFERENCES users(id)
);
CREATE INDEX password_requests_open_idx ON password_requests(user_id) WHERE handled_at IS NULL;

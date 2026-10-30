-- Sessions: idle timeout and where each session came from.
ALTER TABLE sessions ADD COLUMN last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN ip TEXT;
ALTER TABLE sessions ADD COLUMN user_agent TEXT;
-- A login that still needs its 2-step code is a session that grants nothing yet.
ALTER TABLE sessions ADD COLUMN pending_2fa BOOLEAN NOT NULL DEFAULT FALSE;

-- Two-step login (authenticator app, TOTP).
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN totp_last_step BIGINT;          -- a code is accepted once only
ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMPTZ;

-- Media: a streaming-ready copy of the video and a sound-only copy.
ALTER TABLE videos ADD COLUMN web_key TEXT;                  -- web-optimised video (starts instantly, smaller)
ALTER TABLE videos ADD COLUMN audio_key TEXT;                -- English sound only
ALTER TABLE videos ADD COLUMN dubbed_audio_key TEXT;         -- Hindi sound only
ALTER TABLE videos ADD COLUMN media_note TEXT;               -- sizes, for the admin

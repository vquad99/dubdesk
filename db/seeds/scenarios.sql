-- Test scenarios for the current workflow (reviewer -> operator check -> approve / send back; admin stop / assign).
-- Safe to re-run: it first removes what it made before (videos titled 'Scenario %', users @demo.test).
--
-- 1. Resets the sample video ('Transmission of Art (sample)') to a fresh, unworked task: the old
--    admin approval, its line edits, checks, events and working time are removed.
-- 2. Makes one video per situation, all sharing the sample's media files and lines:
--      Scenario 1  waiting in the queue
--      Scenario 2  with a reviewer (half checked)
--      Scenario 3  waiting for the operator's check (some lines corrected)
--      Scenario 4  sent back by the operator to the reviewer, with a note  (held by rev@test.local)
--      Scenario 5  stopped by the admin, with a reason
--      Scenario 6  given back by three people (trouble video), back in the queue
--      Scenario 7  approved by the operator (finished, counts for pay)
--      Scenario 8  uploaded, waiting for the dub (no lines yet)
-- Needs the accounts admin / rev@test.local / op@test.local (any password). Adds three demo
-- reviewers who cannot log in (their password is unusable): demo1..3@demo.test.

BEGIN;

-- ---------- clean up what an earlier run made ----------
DELETE FROM activity_log WHERE video_id IN (SELECT id FROM videos WHERE title LIKE 'Scenario %')
   OR user_id IN (SELECT id FROM users WHERE email LIKE '%@demo.test');
DELETE FROM work_slots WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@demo.test')
   OR job_id IN (SELECT j.id FROM jobs j JOIN videos v ON v.id = j.video_id WHERE v.title LIKE 'Scenario %');
DELETE FROM work_time WHERE job_id IN (SELECT j.id FROM jobs j JOIN videos v ON v.id = j.video_id WHERE v.title LIKE 'Scenario %');
DELETE FROM segment_edits WHERE segment_id IN (SELECT s.id FROM segments s JOIN videos v ON v.id = s.video_id WHERE v.title LIKE 'Scenario %');
DELETE FROM videos WHERE title LIKE 'Scenario %';
DELETE FROM users WHERE email LIKE '%@demo.test';

-- ---------- 1. the sample back to a fresh task ----------
DO $$
DECLARE vid INT; jid INT; adm INT;
BEGIN
  SELECT id INTO vid FROM videos WHERE title = 'Transmission of Art (sample)' ORDER BY id LIMIT 1;
  IF vid IS NULL THEN RAISE EXCEPTION 'sample video not found -- load db/seeds/dummy_task.sql first'; END IF;
  SELECT id INTO adm FROM users WHERE role = 'admin' ORDER BY id LIMIT 1;

  DELETE FROM activity_log WHERE video_id = vid AND action LIKE 'job.%' OR video_id = vid AND action LIKE 'line.%';
  DELETE FROM work_slots WHERE job_id IN (SELECT id FROM jobs WHERE video_id = vid);
  DELETE FROM work_time WHERE job_id IN (SELECT id FROM jobs WHERE video_id = vid);
  DELETE FROM segment_edits WHERE segment_id IN (SELECT id FROM segments WHERE video_id = vid);
  DELETE FROM segments WHERE video_id = vid AND origin <> 'source';
  UPDATE segments SET hi_text = hi_text_original,
         start_sec = COALESCE(start_sec_original, start_sec), end_sec = COALESCE(end_sec_original, end_sec),
         flag = NULL, comment = NULL, reviewed_at = NULL, reviewed_by = NULL, deleted_at = NULL
   WHERE video_id = vid;
  DELETE FROM jobs WHERE video_id = vid;
  INSERT INTO jobs (video_id, round, status) VALUES (vid, 1, 'queued') RETURNING id INTO jid;
  INSERT INTO job_events (job_id, user_id, action) VALUES (jid, adm, 'created');
  UPDATE videos SET status = 'ready_for_review', updated_at = now() WHERE id = vid;
END $$;

-- ---------- 2. demo reviewers (cannot log in) ----------
INSERT INTO users (email, name, role, password_hash, vendor) VALUES
  ('demo1@demo.test', 'Asha (demo)', 'reviewer', 'disabled', 'LinguaWorks'),
  ('demo2@demo.test', 'Ravi (demo)', 'reviewer', 'disabled', 'LinguaWorks'),
  ('demo3@demo.test', 'Meera (demo)', 'reviewer', 'disabled', 'VoiceHub');

-- ---------- 3. one video per situation ----------
CREATE TEMP TABLE sc (n INT, title TEXT, vid INT, jid INT) ON COMMIT DROP;

DO $$
DECLARE
  src RECORD; t TEXT; i INT; vid INT; jid INT;
  adm INT := (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);
  titles TEXT[] := ARRAY[
    'Scenario 1 - waiting in queue', 'Scenario 2 - with a reviewer', 'Scenario 3 - waiting for operator check',
    'Scenario 4 - sent back to reviewer', 'Scenario 5 - stopped by admin', 'Scenario 6 - given back by 3 people',
    'Scenario 7 - approved by operator', 'Scenario 8 - waiting for dub'];
BEGIN
  SELECT * INTO src FROM videos WHERE title = 'Transmission of Art (sample)' ORDER BY id LIMIT 1;
  FOR i IN 1..8 LOOP
    t := titles[i];
    INSERT INTO videos (title, original_filename, source_key, dubbed_key, duration_sec, status, uploaded_by, size_bytes, mime,
                        peaks_key, web_key, audio_key, dubbed_audio_key, media_note, updated_at)
    VALUES (t, src.original_filename, src.source_key, CASE WHEN i = 8 THEN NULL ELSE src.dubbed_key END, src.duration_sec,
            CASE WHEN i = 8 THEN 'uploaded' ELSE 'ready_for_review' END, adm, src.size_bytes, src.mime,
            src.peaks_key, src.web_key, src.audio_key, CASE WHEN i = 8 THEN NULL ELSE src.dubbed_audio_key END, src.media_note,
            now() - make_interval(mins => i))
    RETURNING id INTO vid;
    jid := NULL;
    IF i < 8 THEN
      INSERT INTO segments (video_id, el_segment_id, start_sec, end_sec, speaker, en_text, hi_text_original, hi_text,
                            start_sec_original, end_sec_original, origin)
      SELECT vid, el_segment_id, COALESCE(start_sec_original, start_sec), COALESCE(end_sec_original, end_sec), speaker, en_text,
             hi_text_original, hi_text_original, COALESCE(start_sec_original, start_sec), COALESCE(end_sec_original, end_sec), 'source'
        FROM segments WHERE video_id = src.id AND origin = 'source' ORDER BY start_sec;
      INSERT INTO jobs (video_id, round, status, created_at) VALUES (vid, 1, 'queued', now() - make_interval(hours => 9 - i)) RETURNING id INTO jid;
      INSERT INTO job_events (job_id, user_id, action, created_at) VALUES (jid, adm, 'created', now() - make_interval(hours => 9 - i));
    END IF;
    INSERT INTO sc VALUES (i, t, vid, jid);
  END LOOP;
END $$;

-- helpers for the states below
CREATE TEMP TABLE who ON COMMIT DROP AS SELECT
  (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1) AS adm,
  (SELECT id FROM users WHERE email = 'rev@test.local') AS rev,
  (SELECT id FROM users WHERE email = 'op@test.local') AS op,
  (SELECT id FROM users WHERE email = 'demo1@demo.test') AS d1,
  (SELECT id FROM users WHERE email = 'demo2@demo.test') AS d2,
  (SELECT id FROM users WHERE email = 'demo3@demo.test') AS d3;

-- Scenario 2: with Asha (demo), half the lines checked
UPDATE jobs SET status = 'assigned', assigned_to = w.d1, assigned_at = now() - interval '30 minutes', locked_until = now() + interval '3 hours'
  FROM sc, who w WHERE sc.n = 2 AND jobs.id = sc.jid;
UPDATE videos SET status = 'in_review' FROM sc WHERE sc.n = 2 AND videos.id = sc.vid;
UPDATE segments SET reviewed_at = now() - interval '10 minutes', reviewed_by = w.d1
  FROM sc, who w WHERE sc.n = 2 AND segments.video_id = sc.vid
   AND segments.id IN (SELECT id FROM segments s2 WHERE s2.video_id = sc.vid ORDER BY start_sec LIMIT 2);
INSERT INTO job_events (job_id, user_id, action) SELECT sc.jid, w.d1, 'claimed' FROM sc, who w WHERE sc.n = 2;

-- Scenario 3: Ravi (demo) sent it for check; two lines corrected, all checked
UPDATE segments SET hi_text = hi_text || ' (सुधारा)', reviewed_at = now() - interval '20 minutes'
  FROM sc WHERE sc.n = 3 AND segments.video_id = sc.vid
   AND segments.id IN (SELECT id FROM segments s2 WHERE s2.video_id = sc.vid ORDER BY start_sec LIMIT 2);
UPDATE segments SET reviewed_at = COALESCE(reviewed_at, now() - interval '20 minutes'), reviewed_by = w.d2
  FROM sc, who w WHERE sc.n = 3 AND segments.video_id = sc.vid;
INSERT INTO segment_edits (segment_id, job_id, user_id, field, old_value, new_value, created_at)
SELECT s.id, sc.jid, w.d2, 'hi_text', s.hi_text_original, s.hi_text, now() - interval '20 minutes'
  FROM sc, who w, segments s WHERE sc.n = 3 AND s.video_id = sc.vid AND s.hi_text <> s.hi_text_original;
UPDATE jobs SET status = 'submitted', assigned_to = w.d2, assigned_at = now() - interval '1 hour', submitted_at = now() - interval '15 minutes'
  FROM sc, who w WHERE sc.n = 3 AND jobs.id = sc.jid;
UPDATE videos SET status = 'submitted' FROM sc WHERE sc.n = 3 AND videos.id = sc.vid;
INSERT INTO job_events (job_id, user_id, action, note) SELECT sc.jid, w.d2, x.a, x.txt FROM sc, who w,
  (VALUES ('claimed', NULL), ('submitted', 'Lines 1-2 corrected')) x(a, txt) WHERE sc.n = 3;
INSERT INTO activity_log (user_id, action, video_id, job_id, details, created_at)
SELECT w.d2, 'job.submitted', sc.vid, sc.jid, 'Lines 1-2 corrected', now() - interval '15 minutes' FROM sc, who w WHERE sc.n = 3;

-- Scenario 4: sent back by the operator to rev@test.local, with a note
UPDATE jobs SET status = 'assigned', assigned_to = w.rev, assigned_at = now() - interval '5 minutes', locked_until = now() + interval '4 hours',
       submitted_at = now() - interval '40 minutes', reviewed_by = w.op, reviewed_at = now() - interval '5 minutes',
       admin_note = 'Line 3: the meaning is wrong. Please check it against the English and send again.'
  FROM sc, who w WHERE sc.n = 4 AND jobs.id = sc.jid;
UPDATE videos SET status = 'in_review' FROM sc WHERE sc.n = 4 AND videos.id = sc.vid;
UPDATE segments SET reviewed_at = now() - interval '45 minutes', reviewed_by = w.rev FROM sc, who w WHERE sc.n = 4 AND segments.video_id = sc.vid;
INSERT INTO job_events (job_id, user_id, action, note) SELECT sc.jid, x.u, x.a, x.txt FROM sc, who w,
  LATERAL (VALUES (w.rev, 'claimed', NULL), (w.rev, 'submitted', NULL), (w.op, 'check_started', NULL),
                  (w.op, 'returned', 'Line 3: the meaning is wrong. Please check it against the English and send again.')) x(u, a, txt)
 WHERE sc.n = 4;
INSERT INTO activity_log (user_id, action, video_id, job_id, details, created_at)
SELECT w.op, 'job.returned', sc.vid, sc.jid, 'Line 3: the meaning is wrong.', now() - interval '5 minutes' FROM sc, who w WHERE sc.n = 4;

-- Scenario 5: stopped by the admin
UPDATE jobs SET held_at = now() - interval '2 hours', held_by = w.adm, hold_reason = 'Audio is unclear; waiting for a better file from the client'
  FROM sc, who w WHERE sc.n = 5 AND jobs.id = sc.jid;
INSERT INTO job_events (job_id, user_id, action, note)
SELECT sc.jid, w.adm, 'held', 'Audio is unclear; waiting for a better file from the client' FROM sc, who w WHERE sc.n = 5;

-- Scenario 6: given back by three people, each with a reason; back in the queue
INSERT INTO job_events (job_id, user_id, action, note, created_at)
SELECT sc.jid, x.u, x.a, x.txt, now() - make_interval(mins => x.m) FROM sc, who w,
  LATERAL (VALUES (w.d1, 'claimed', NULL, 300), (w.d1, 'released', 'Audio is unclear or noisy', 280),
                  (w.d2, 'claimed', NULL, 200), (w.d2, 'released', 'English transcript is wrong or missing', 180),
                  (w.d3, 'claimed', NULL, 100), (w.d3, 'released', 'Topic needs a specialist', 80)) x(u, a, txt, m)
 WHERE sc.n = 6;

-- Scenario 7: rev@test.local reviewed it, the operator approved it (finished, counts for pay)
UPDATE segments SET reviewed_at = now() - interval '2 hours', reviewed_by = w.rev FROM sc, who w WHERE sc.n = 7 AND segments.video_id = sc.vid;
UPDATE jobs SET status = 'approved', assigned_to = w.rev, assigned_at = now() - interval '3 hours', submitted_at = now() - interval '2 hours',
       reviewed_by = w.op, reviewed_at = now() - interval '1 hour'
  FROM sc, who w WHERE sc.n = 7 AND jobs.id = sc.jid;
UPDATE videos SET status = 'done' FROM sc WHERE sc.n = 7 AND videos.id = sc.vid;
INSERT INTO job_events (job_id, user_id, action) SELECT sc.jid, x.u, x.a FROM sc, who w,
  LATERAL (VALUES (w.rev, 'claimed'), (w.rev, 'submitted'), (w.op, 'check_started'), (w.op, 'approved')) x(u, a) WHERE sc.n = 7;
INSERT INTO activity_log (user_id, action, video_id, job_id, created_at)
SELECT x.u, x.a, sc.vid, sc.jid, now() - make_interval(mins => x.m) FROM sc, who w,
  LATERAL (VALUES (w.rev, 'job.submitted', 120), (w.op, 'job.approved', 60)) x(u, a, m) WHERE sc.n = 7;
INSERT INTO work_slots (user_id, job_id, slot, seconds, last_beat)
SELECT w.rev, sc.jid, to_timestamp(floor(extract(epoch FROM now() - make_interval(mins => x.m)) / 600) * 600), 540, now() - make_interval(mins => x.m)
  FROM sc, who w, (VALUES (170), (160), (150)) x(m) WHERE sc.n = 7
ON CONFLICT (user_id, slot) DO NOTHING;

COMMIT;

SELECT title, v.status AS video, j.status AS job, u.name AS reviewer, (j.held_at IS NOT NULL) AS stopped
  FROM videos v LEFT JOIN jobs j ON j.video_id = v.id LEFT JOIN users u ON u.id = j.assigned_to
 WHERE v.title LIKE 'Scenario %' OR v.title = 'Transmission of Art (sample)' ORDER BY v.title;

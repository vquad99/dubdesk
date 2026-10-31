-- DEV ONLY: 30 days of made-up review work for 4 demo annotators, to look at the analytics page.
-- Safe to re-run: removes its own rows first (videos titled 'Demo analytics %', users @demo.local).
DELETE FROM activity_log WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@demo.local');
DELETE FROM work_slots WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@demo.local');
DELETE FROM segment_edits WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@demo.local');
DELETE FROM videos WHERE title LIKE 'Demo analytics %';
DELETE FROM users WHERE email LIKE '%@demo.local';

INSERT INTO users (email, name, role, password_hash, vendor) VALUES
  ('kiran@demo.local', 'Kiran Shah', 'reviewer', 'x', 'LinguaWorks'),
  ('farah@demo.local', 'Farah Khan', 'reviewer', 'x', 'LinguaWorks'),
  ('vikram@demo.local', 'Vikram Rao', 'reviewer', 'x', 'VoiceHub'),
  ('neha@demo.local', 'Neha Joshi', 'reviewer', 'x', NULL);

DO $$
DECLARE u RECORD; d INT; n INT; vid INT; jid INT; t0 TIMESTAMPTZ; k INT; seg INT; ok BOOLEAN;
BEGIN
  FOR u IN SELECT id, email FROM users WHERE email LIKE '%@demo.local' LOOP
    FOR d IN 0..29 LOOP
      IF extract(dow FROM (now() - make_interval(days => d))) IN (0) AND random() < 0.8 THEN CONTINUE; END IF;
      FOR n IN 1..(1 + floor(random() * (CASE WHEN u.email LIKE 'kiran%' THEN 4 ELSE 3 END))::int) LOOP
        t0 := date_trunc('day', now() - make_interval(days => d)) + interval '4 hours' + make_interval(mins => floor(random() * 480)::int);
        IF t0 > now() THEN CONTINUE; END IF;
        INSERT INTO videos (title, original_filename, status, duration_sec, updated_at)
          VALUES ('Demo analytics ' || u.id || '-' || d || '-' || n, 'demo.mp4', 'done', 120 + floor(random() * 360), t0) RETURNING id INTO vid;
        ok := random() < 0.82;
        INSERT INTO jobs (video_id, round, status, assigned_to, assigned_at, submitted_at, reviewed_at)
          VALUES (vid, 1, CASE WHEN ok THEN 'approved' ELSE 'submitted' END, u.id, t0, t0 + interval '40 minutes', t0 + interval '70 minutes') RETURNING id INTO jid;
        INSERT INTO activity_log (user_id, action, video_id, job_id, created_at) VALUES (u.id, 'job.submitted', vid, jid, t0 + interval '40 minutes');
        IF NOT ok THEN
          INSERT INTO activity_log (user_id, action, video_id, job_id, created_at) VALUES (NULL, 'job.returned', vid, jid, t0 + interval '70 minutes');
        END IF;
        FOR k IN 1..(15 + floor(random() * 25))::int LOOP
          INSERT INTO segments (video_id, start_sec, end_sec, en_text, hi_text, hi_text_original, reviewed_at, reviewed_by)
            VALUES (vid, k * 4, k * 4 + 3, 'line', 'पंक्ति', 'पंक्ति', t0 + make_interval(secs => k * 60), u.id) RETURNING id INTO seg;
          IF random() < (CASE WHEN u.email LIKE 'vikram%' THEN 0.35 ELSE 0.18 END) THEN
            INSERT INTO segment_edits (segment_id, job_id, user_id, field, old_value, new_value, created_at)
              VALUES (seg, jid, u.id, 'hi_text', 'a', 'b', t0 + make_interval(secs => k * 60));
          END IF;
        END LOOP;
        INSERT INTO work_slots (user_id, job_id, slot, seconds, last_beat)
          SELECT u.id, jid, to_timestamp(floor(extract(epoch FROM t0 + make_interval(mins => m * 10)) / 600) * 600), 420 + floor(random() * 170)::int, t0 + make_interval(mins => m * 10)
            FROM generate_series(0, 3) m
          ON CONFLICT (user_id, slot) DO UPDATE SET seconds = LEAST(600, work_slots.seconds + EXCLUDED.seconds);
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

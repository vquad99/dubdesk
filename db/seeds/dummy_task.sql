-- One sample video + review job for trying the screens. Safe to re-run.
-- Lines are the first five of the "Transmission of Art" ElevenLabs dub.
DELETE FROM videos WHERE title = 'Transmission of Art (sample)';

WITH v AS (
    INSERT INTO videos (title, original_filename, duration_sec, status, uploaded_by)
    VALUES ('Transmission of Art (sample)', 'Transmission-of-Art-SnapYT.App_first5min.mp4', 300,
            'ready_for_review', (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1))
    RETURNING id
), j AS (
    INSERT INTO jobs (video_id, round, status) SELECT id, 1, 'queued' FROM v RETURNING id
), e AS (
    INSERT INTO job_events (job_id, user_id, action)
    SELECT j.id, (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1), 'created' FROM j
)
INSERT INTO segments (video_id, el_segment_id, start_sec, end_sec, speaker, en_text, hi_text_original, hi_text)
SELECT v.id, s.seg, s.st, s.en, 'Speaker 0', s.en_text, s.hi, s.hi
FROM v, (VALUES
    ('sample-1',  0.92,  6.46, 'So we are here to discuss some topics of generally art forms, which is part of art and culture.',
                               'तो आज हम कला रूपों के कुछ विषयों पर चर्चा करेंगे, जो कला और संस्कृति का हिस्सा हैं।'),
    ('sample-2',  7.46,  8.94, 'So as seen,',
                               'जैसा कि देखा गया है,'),
    ('sample-3', 10.14, 11.84, 'it is a bit tricky part of the subject.',
                               'यह इस विषय का थोड़ा कठिन हिस्सा है।'),
    ('sample-4', 12.68, 14.34, 'In art forms, we have generally seen',
                               'कला रूपों में हमने आमतौर पर देखा है'),
    ('sample-5', 15.14, 23.66, 'that the main problem with art and culture books is that they have a lot of data, and it is not connected.',
                               'कि कला और संस्कृति की किताबों में मुख्य समस्या यह है कि उनमें बहुत सारा डेटा होता है, और वह आपस में जुड़ा नहीं होता।')
) AS s(seg, st, en, en_text, hi);

-- Where a video's lines come from, chosen at upload: Sarvam dubs it, or the admin brings transcripts.
ALTER TABLE videos ADD COLUMN IF NOT EXISTS line_source TEXT CHECK (line_source IN ('sarvam', 'manual'));

-- An upload can also be the Hindi (dubbed) video for an existing video, not only the English source.
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'source' CHECK (kind IN ('source', 'dubbed'));

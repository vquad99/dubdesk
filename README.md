# DubDesk

English video -> Sarvam Hindi dub -> human review -> regenerate -> download.

## Dubbing engine (decided 2026-10-30)

Sarvam Dubbing with Editor Flow (Sarvam Content Studio, `editor_flow: true`), about Rs 80 per
source minute. The API creates the job, uploads the video, starts it, polls `live-status`,
then triggers `export-all` and downloads video / audio / SRT. Line edits and per-line
regenerate happen in Sarvam Content Studio (the public API has no segment-edit endpoint);
DubDesk links each task to its Studio job and re-exports when Sarvam marks an export stale.

Roles: **admin** (upload, approve, regenerate, stats, users), **reviewer** (pull a job,
fix Hindi lines, send back), **operator** (progress, downloads). One video = one job.

## Layout

| Path | What |
|---|---|
| `web/` | SvelteKit app (website + API), runs on Render with adapter-node |
| `db/migrations/` | SQL files, applied once each in name order |
| `scripts/dev_db.sh` | starts a private local Postgres on port 5544 |

## Local dev

```bash
./scripts/dev_db.sh                       # prints DATABASE_URL
cd web && npm install
export DATABASE_URL=postgres://dubbing@localhost:5544/dubbing_qc
npm run migrate
npm run create-user -- you@example.com "Your Name" admin 'a-long-password'
npm run dev                               # http://localhost:5173
```

## Production (Render)

`render.yaml` is a Render Blueprint: one web service + one Postgres in Singapore.
Each deploy runs the migrations, then starts the app; Render checks `/healthz`.
Create the first admin once from the Render shell:
`cd web && npm run create-user -- you@example.com "Your Name" admin 'a-long-password'`.

## What is built

- Login with roles, throttled after 5 failed tries per email / 20 per address in 15 min
- Admin: overview (queue numbers, approvals waiting, reviewers, dub quality, activity),
  tasks list with filters and search, task page with line-by-line diff, approve / send back
  with a note / take back from reviewer, users with roles and passwords
- Reviewer: pull the next job (one job per reviewer, 4-hour lock, no double handout),
  editor with player, line timeline, follow-video, per-line check / flag / comment,
  autosave, find & replace, keyboard shortcuts, send to admin with summary
- Operator: stage tracker per video
- Security headers, one access gate in `hooks.server.ts`, `/healthz` for Render
- Upload: admin drops a video (up to 4 GB) in 5 MB parts with retry/resume, optional English/Hindi
  SRT or VTT; the server reads the length and builds a waveform (bundled ffmpeg)
- Sarvam Dubbing, Editor Flow: Send to Sarvam -> background worker polls, exports, downloads the
  Hindi video + SRT and loads the lines (needs `SARVAM_API_KEY`; written to Sarvam's documented
  API, not yet run against a live key)
- Waveform editor (like Subtitle Edit): drag a line's edges or body, set start/end at the play
  head (F11/F12), nudge, split, join, add, remove, zoom; server refuses overlapping lines
- Downloads: Hindi video, corrected Hindi SRT, English SRT, all-lines CSV
- Tests: `npm test` (unit; database tests run when `TEST_DATABASE_URL` is set)
- Load test: `node scripts/loadtest.mjs 100 15` against a running build

## Scale

One instance handled 100 simultaneous connections firing back-to-back (about 29,000 requests in
75 s, 0 failures; review screen p99 2.3 s, autosave p99 0.4 s). Real users send far fewer
requests, so 100 users fit on one instance. Everything is in Postgres (sessions, locks, login
throttling, worker leases), so more instances work once media moves from the disk to S3.

## Build phases

1. Setup, login, roles, database  -- done
4. Job queue -- done
5. Review screen -- done (video plays once upload + dub exist)
6. Approval -- done; regenerate waits for the ElevenLabs step
2. Admin uploads an English video (browser -> S3)
3. ElevenLabs dub; English + Hindi lines saved
4. Job queue: "Get next job", lock, release
5. Review screen: English video + text, Hindi video + text, editor
6. Send back, admin approval, regenerate changed lines
7. Operator progress + downloads
8. Admin stats + credits
9. Render deploy

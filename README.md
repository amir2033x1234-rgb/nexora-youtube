# NEXORA YouTube AI

An evidence-first, cost-free foundation for a multi-channel YouTube content studio. The repository began with only its initial README. This milestone adds a runnable Node.js application, local SQLite content store, dashboard, workflow APIs, and verification tests. It does not claim that disconnected AI, media, OAuth, or YouTube services work.

## Run locally

Requirements: Node.js 22.13 or newer. No package install or paid service is required.

```sh
node server.mjs
```

Open `http://127.0.0.1:3000`. Data is stored in `./data/nexora.sqlite`; override location and limits with `NEXORA_DATA_DIR`, `PORT`, and `NEXORA_DAILY_JOB_LIMIT`. Local mode has no login by default. To protect a shared/cloud deployment, set `NEXORA_ADMIN_USERNAME` and a unique `NEXORA_ADMIN_PASSWORD` of at least 12 characters. Login uses an HttpOnly, SameSite=Strict session cookie, in-memory sessions, CSRF checks on writes, and IP-based login throttling. Non-local binding also requires `NEXORA_TRUSTED_PROXY=true` and a password; place the app behind a TLS reverse proxy and block direct access. Sessions are process-local and expire after eight hours, so use one app instance until shared session storage is implemented. Durable protected storage is required for cloud deployment.

## Verify

```sh
npm test
npm run check
```

`npm` is only used as a script runner; runtime dependencies are built into Node.js. The SQLite module ships with supported Node releases, though Node may mark it experimental.

## Container

Build with `docker build -t nexora-youtube-ai .`. Run behind a TLS reverse proxy, pass `NEXORA_ADMIN_USERNAME` and `NEXORA_ADMIN_PASSWORD` through the platform's protected runtime secret store, and mount durable storage at `/var/lib/nexora`. The container runs as the unprivileged `node` user and exposes `/api/health`. Do not expose the container port directly to the public internet. SQLite and session storage are single-instance only; this image does not turn the application into a horizontally scalable multi-user service.

## Working modules

- Dashboard and capability ledger backed by persisted data, plus a searchable content library for saved records.
- Multi-channel configuration, content calendar, and channel-scoped API lists; use `?channelId=<id>` for ideas, scripts, jobs, analytics, and calendar records.
- Google Trends “Trending now” RSS radar with region selection, 10-minute cache, saved evidence, related news links, freshness/search-interest signals, and explicit unknown values for YouTube competition/opportunity. It is not a YouTube demand feed or virality forecast.
- Opt-in YouTube competitor search through the official Data API, with view-velocity samples and a hard five-search daily app limit; no request runs until clicked and results are not presented as market-wide forecasts.
- Structured script outlines (deterministic templates, no language model call).
- Claim evidence ledger (does not fetch, authenticate, or independently validate sources).
- Transcript-to-SRT conversion with estimated timing unless timestamps are supplied.
- Rule-based metadata drafts and editable 1280×720 SVG title-card templates.
- Production job queue with documented media-rights checks, quality gate, daily quota, and bounded retry.
- Optional FFmpeg still-image renderer for landscape/vertical videos with licensed images and supplied audio; disabled until a cloud-hosted render runtime is configured.
- User-entered analytics records.
- Optional official YouTube read integration: Desktop OAuth with PKCE/state, refresh tokens encrypted at rest, channel/videos, Analytics reports, and the official `mostPopular` chart.
- Optional Ollama adapter: structured AI script drafts through an explicitly configured endpoint; no model is downloaded or invoked automatically. To honor the no-laptop-processing rule, only connect a separately approved cloud-hosted provider with a verified zero-cost quota; leave it disabled otherwise.
- Guarded resumable upload endpoint and dashboard form; requires a separate upload scope, an explicit per-video approval, documented rights for the exact export file, a passing quality gate, and defaults to private visibility. Public visibility needs a second approval.
- YouTube playlist listing and creation plus existing-video metadata updates use a separate broad management OAuth scope. Each write requires explicit confirmation; public playlists require separate visibility approval.
- Optional administrator login with CSRF protection, HttpOnly cookies, password hashing, a login throttle, logout, and security headers.

## Capability status

The dashboard and `/api/status` expose the per-module status and explain limitations. `IMPLEMENTED` describes local functionality only. It does not imply connected provider or cloud runtime verification.

| Capability | Status | Limit |
|---|---|---|
| Content intelligence, strategy calendar, quotas, recovery, quality scoring, multi-channel, dashboard, searchable library | IMPLEMENTED | Local foundation; deploy with protected durable storage for shared/cloud use. |
| Trend research | PARTIAL | Google Trends supplies current Google Search signals and related news. YouTube competition, audience fit, opportunity, and forecast are not inferred without evidence. |
| YouTube competitor sample | PROVIDER_REQUIRED until read OAuth is connected; then UNTESTED | Official public video search sample, capped to five user-initiated searches per UTC day. A sample is not total competition or audience demand. |
| Fact checking, subtitles, thumbnails, SEO, production orchestration | PARTIAL | User-input rules/templates; source verification, speech recognition, generated imagery, and full production remain disconnected. |
| AI script generation | MODEL_REQUIRED until a model is named; PROVIDER_REQUIRED until an approved remote HTTPS endpoint is configured; then UNTESTED | Laptop/loopback inference is blocked. Confirm the remote host's free quota before use. Inference is a draft and needs source checking. |
| Video rendering | PROVIDER_REQUIRED until FFmpeg is configured; then UNTESTED | Produces a still-image edit with user-provided audio; no voice synthesis or generated footage. |
| YouTube OAuth and read APIs | PROVIDER_REQUIRED until configured and connected; then runtime status is shown | Requires the Google Desktop OAuth client ID and an encryption key in protected environment variables. Real account/API calls still need user-side consent and verification. |
| YouTube playlist and metadata management | PROVIDER_REQUIRED until management scope is granted; then UNTESTED | Broad channel management permission is requested only through a distinct consent button; each write is explicitly approved. |
| Analytics | PARTIAL | User-entered metrics plus an optional live YouTube Analytics query after OAuth; not exercised against the user's channel yet. |
| YouTube publishing | UNTESTED when upload scope is granted; otherwise PROVIDER_REQUIRED | Session-based upload is implemented but not exercised against a real account. Requires exact-file rights evidence, all quality criteria, explicit approval, and separate public-visibility approval. |

## Safety and rights

Never commit `.env`, OAuth client files, tokens, or credentials. `.gitignore` excludes common secret locations. The OAuth token database stores refresh/access tokens encrypted using AES-256-GCM with `NEXORA_TOKEN_ENCRYPTION_KEY`; preserve that key separately or saved authorization cannot be decrypted. Set `NEXORA_GOOGLE_CLIENT_ID` and the encryption key in a protected environment; the client secret is optional and also stays in the environment. For a desktop client, the default callback is `http://127.0.0.1:<PORT>/api/youtube/oauth/callback`; register/configure the matching loopback redirect for the OAuth client. `/api/youtube/oauth/start?mode=read` requests read-only scopes, `mode=publish` adds the YouTube upload scope, and `mode=manage` requests broad channel management permission. Each is a distinct consent action. PKCE, one-time state, 10-minute expiry, and refresh-token revocation handling are built in. Upload requires exact-file license evidence and commercial rights, a complete passing quality score, explicit per-video approval, and defaults to private. Public visibility requires separate approval. Playlist creation and metadata updates also require an explicit approval flag. Provider calls have mocks, but live OAuth/API/upload access has not been run here. The application does not ingest third-party media automatically. The rights check validates submitted proof fields, not the underlying license. No video was uploaded.

## Architecture and next milestones

AI inference is optional and disabled until both `NEXORA_OLLAMA_URL` and `NEXORA_OLLAMA_MODEL` are configured. The adapter rejects HTTP, loopback, and localhost endpoints so project inference cannot run on the user's laptop. Only configure a remote HTTPS provider after its zero-cost quota and data handling are verified; otherwise leave it disabled. Model output is a draft and is not automatically fact-checked. No hosted AI endpoint or paid service is called by the app by default.

The Studio → Render video route is blocked on loopback/local installations to honor the no-laptop-processing requirement. On a protected cloud host only, configure FFmpeg and persistent asset/export directories, use licensed source images and audio with documented proof, and select slide durations plus landscape or vertical layout. The real media encode remains untested until that cloud runtime is configured.

The dependency-free Node HTTP service uses SQLite for a single-instance prototype and static browser UI. The local admin login is suitable for a single-instance protected installation, not a multi-user identity system. For a cloud-first multi-user launch, the next required milestone is managed relational storage, durable sessions, object storage with lifecycle limits, background workers, and deployment/backup automation—all selected from genuinely free allowances and rechecked before use. Then add provider adapters behind interfaces: validated public trend sources; an optional no-cost model endpoint with explicit quota tracking; speech/media tools that operate only on licensed assets; and YouTube APIs. Do not add paid services without explicit approval. Every integration must have provider-specific tests and a clear `PROVIDER_REQUIRED`/`UNTESTED` status until exercised.

## Current deployment boundary

This milestone is source-verified and locally testable. It has not been deployed to Google Cloud; no cloud project or API state was queried. No real OAuth handshake, live channel API access, AI inference, image/audio/video generation, YouTube analytics fetch, upload, or device-specific browser verification has been performed.


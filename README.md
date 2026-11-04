# NEXORA YouTube AI

An evidence-first, cost-free foundation for a multi-channel YouTube content studio. The repository began with only its initial README. This milestone adds a runnable Node.js application, local SQLite content store, dashboard, workflow APIs, and verification tests. It does not claim that disconnected AI, media, OAuth, or YouTube services work.

## Run locally

Requirements: Node.js 22.13 or newer. No package install or paid service is required.

```sh
node server.mjs
```

Open `http://127.0.0.1:3000`. Data is stored in `./data/nexora.sqlite`; override location and limits with `NEXORA_DATA_DIR`, `PORT`, and `NEXORA_DAILY_JOB_LIMIT`. The server binds to `127.0.0.1` by default and refuses a non-local bind unless `NEXORA_TRUSTED_PROXY=true` is set. Only set that on a deployment where a TLS reverse proxy enforces authentication and rate limits and the app origin cannot be reached directly. Durable protected storage is also required for a cloud deployment. This flag records a deployment assertion; it does not implement authentication in this app.

## Verify

```sh
npm test
npm run check
```

`npm` is only used as a script runner; runtime dependencies are built into Node.js. The SQLite module ships with supported Node releases, though Node may mark it experimental.

## Working modules

- Dashboard and capability ledger backed by persisted data.
- Multi-channel configuration and content calendar.
- Evidence-input trend scoring (not a live trend feed or virality forecast).
- Structured script outlines (deterministic templates, no language model call).
- Claim evidence ledger (does not fetch, authenticate, or independently validate sources).
- Transcript-to-SRT conversion with estimated timing unless timestamps are supplied.
- Rule-based metadata drafts and editable 1280×720 SVG title-card templates.
- Production job queue with documented media-rights checks, quality gate, daily quota, and bounded retry.
- Optional FFmpeg still-image renderer for landscape/vertical videos with licensed images and supplied audio; disabled until the local binary is available.
- User-entered analytics records.
- Optional official YouTube read integration: Desktop OAuth with PKCE/state, refresh tokens encrypted at rest, channel/videos, Analytics reports, and the official `mostPopular` chart.
- Optional zero-cost local model adapter: structured AI script drafts through a user-run Ollama service; no model is downloaded or invoked automatically.
- Guarded resumable upload endpoint and dashboard form; requires a separate upload scope, an explicit per-video approval, documented rights for the exact export file, a passing quality gate, and defaults to private visibility. Public visibility needs a second approval.

## Capability status

The dashboard and `/api/status` expose the per-module status and explain limitations. `IMPLEMENTED` describes local functionality only. It does not imply connected provider or cloud runtime verification.

| Capability | Status | Limit |
|---|---|---|
| Content intelligence, strategy calendar, quotas, recovery, quality scoring, multi-channel, dashboard | IMPLEMENTED | Local foundation; deploy with protected durable storage for shared/cloud use. |
| Trend research, fact checking, subtitles, thumbnails, SEO, production orchestration | PARTIAL | User-input rules/templates; external data, recognition, and rendering are not connected. |
| AI script generation | MODEL_REQUIRED until local model configured; then UNTESTED | Set `NEXORA_OLLAMA_MODEL` and run Ollama locally. Inference is a draft and still needs source checking. |
| Video rendering | PROVIDER_REQUIRED until FFmpeg is configured; then UNTESTED | Produces a still-image edit with user-provided audio; no voice synthesis or generated footage. |
| YouTube OAuth and read APIs | PROVIDER_REQUIRED until configured and connected; then runtime status is shown | Requires the Google Desktop OAuth client ID and an encryption key in protected environment variables. Real account/API calls still need user-side consent and verification. |
| Analytics | PARTIAL | User-entered metrics plus an optional live YouTube Analytics query after OAuth; not exercised against the user's channel yet. |
| YouTube publishing | UNTESTED when upload scope is granted; otherwise PROVIDER_REQUIRED | Session-based upload is implemented but not exercised against a real account. Requires exact-file rights evidence, all quality criteria, explicit approval, and separate public-visibility approval. |

## Safety and rights

Never commit `.env`, OAuth client files, tokens, or credentials. `.gitignore` excludes common secret locations. The OAuth token database stores refresh/access tokens encrypted using AES-256-GCM with `NEXORA_TOKEN_ENCRYPTION_KEY`; preserve that key separately or saved authorization cannot be decrypted. Set `NEXORA_GOOGLE_CLIENT_ID` and the encryption key in a protected environment; the client secret is optional and also stays in the environment. For a desktop client, the default callback is `http://127.0.0.1:<PORT>/api/youtube/oauth/callback`; register/configure the matching loopback redirect for the OAuth client. `/api/youtube/oauth/start?mode=read` requests read-only scopes; `mode=publish` adds the YouTube upload scope and is a distinct consent action. PKCE, one-time state, 10-minute expiry, and refresh-token revocation handling are built in. Upload requires exact-file license evidence and commercial rights, a complete passing quality score, explicit per-video approval, and defaults to private. Public visibility requires separate approval. Provider calls have mocks, but live OAuth/API/upload access has not been run here. The application does not ingest third-party media automatically. The rights check validates submitted proof fields, not the underlying license. No video was uploaded.

## Architecture and next milestones

Local AI is optional: set `NEXORA_OLLAMA_URL` and `NEXORA_OLLAMA_MODEL` to a local Ollama instance/model. It is never contacted when the model is unset. Ollama runs on the user's own machine and uses local compute/storage; model output is not fact-checked automatically. No hosted AI endpoint or paid service is called by the app.

The Studio → Render video tool uses FFmpeg if installed. Put licensed source images and audio in `data/assets` (or configure `NEXORA_ASSET_DIR`), document each license and its proof, then provide slide durations and a landscape or vertical layout. Rendered MP4s go to `data/exports` and can be submitted to the gated YouTube upload form. FFmpeg was not installed in the build environment, so the renderer was verified with a mocked process and the real media encode remains untested.

The dependency-free Node HTTP service uses SQLite for a single-instance prototype and static browser UI. For a cloud-first multi-user launch, the next required milestone is a tested identity and authorization layer, managed relational storage, object storage with lifecycle limits, background workers, and deployment/backup automation—all selected from genuinely free allowances and rechecked before use. Then add provider adapters behind interfaces: validated public trend sources; an optional no-cost model endpoint with explicit quota tracking; speech/media tools that operate only on licensed assets; Google OAuth with state/PKCE, minimal scopes, encrypted token storage and revocation; and YouTube APIs. Do not add paid services without explicit approval. Every integration must have provider-specific tests and a clear `PROVIDER_REQUIRED`/`UNTESTED` status until exercised.

## Current deployment boundary

This milestone is source-verified and locally testable. It has not been deployed to Google Cloud; no cloud project or API state was queried. No real OAuth handshake, live channel API access, AI inference, image/audio/video generation, YouTube analytics fetch, upload, or device-specific browser verification has been performed.

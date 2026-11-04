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
- User-entered analytics records.
- Publishing safety endpoint that always refuses uploads. No YouTube write API exists.

## Capability status

The dashboard and `/api/status` expose the per-module status and explain limitations. `IMPLEMENTED` describes local functionality only. It does not imply connected provider or cloud runtime verification.

| Capability | Status | Limit |
|---|---|---|
| Content intelligence, strategy calendar, quotas, recovery, quality scoring, multi-channel, dashboard | IMPLEMENTED | Local foundation; deploy with protected durable storage for shared/cloud use. |
| Trend research, fact checking, scripts, subtitles, thumbnails, SEO, analytics, production orchestration | PARTIAL | User-input based rules/templates; external data, AI, recognition, rendering, or verified metrics are not connected. |
| Voiceover and YouTube OAuth | PROVIDER_REQUIRED | No provider credentials or adapter is configured. |
| YouTube publishing | NOT_IMPLEMENTED | No upload code exists; `/api/publish/prepare` returns `published: false` even when approval is supplied. |

## Safety and rights

Never commit `.env`, OAuth client files, tokens, or credentials. `.gitignore` excludes common secret locations. Store production credentials in a managed secret store, not this repository. The application does not ingest third-party media automatically. Every queued media asset needs a URL/reference, license, proof, and explicit commercial-use permission; the workflow checks these user-submitted fields, but cannot verify the license itself. Obtain rights and preserve attribution. No publishing occurs.

## Architecture and next milestones

The dependency-free Node HTTP service uses SQLite for a single-instance prototype and static browser UI. For a cloud-first multi-user launch, the next required milestone is a tested identity and authorization layer, managed relational storage, object storage with lifecycle limits, background workers, and deployment/backup automation—all selected from genuinely free allowances and rechecked before use. Then add provider adapters behind interfaces: validated public trend sources; an optional no-cost model endpoint with explicit quota tracking; speech/media tools that operate only on licensed assets; Google OAuth with state/PKCE, minimal scopes, encrypted token storage and revocation; and YouTube APIs. Do not add paid services without explicit approval. Every integration must have provider-specific tests and a clear `PROVIDER_REQUIRED`/`UNTESTED` status until exercised.

## Current deployment boundary

This milestone is source-verified and locally testable. It has not been deployed to Google Cloud; no cloud project or API state was queried. No OAuth handshake, live trend lookup, AI inference, image/audio/video generation, YouTube analytics fetch, upload, or device-specific browser verification has been performed.

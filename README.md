# QR Doorbell

Smart, app-free visitor check-in with a guest page (`index.html`) and owner dashboard (`owner.html`).

## What This Project Is

`QR Doorbell` is a static web app hosted on a CDN/edge platform.  
Visitors scan a QR code, take a photo, and send a message.  
Owners receive realtime updates in the dashboard and can reply instantly.

## Stack

- Frontend: Vanilla HTML/CSS/JS (no framework, no build step)
- Backend: Supabase (Postgres + Auth + Storage + Realtime)
- Notifications: ntfy.sh topic push
- Hosting: Vercel-ready static deployment
- PWA: Service Worker + manifest

## Core Features

- Guest photo capture + optional message
- Message/photo optional client-side encryption
- Realtime ring feed for owners
- Owner reply workflow (`ACK`, `COMING`, custom reply)
- Door point management + tokenized QR generation
- QR revocation/termination (`is_active` per door point)
- Multi-house support per owner account
- Multi-owner membership model per house
- CSV export of ring history
- Audit log surface (from DB audit table)
- Offline shell support for UI availability

## Security Notes (Important)

- Supabase anon key is expected to be public in client apps.
- RLS policies in Supabase are the primary access control.
- Storage bucket `guest_photos` is private and accessed via signed URLs.
- CSP/security headers are configured in `vercel.json`.
- Client-side passphrase encryption in this app protects data at rest from casual access, but it is not equivalent to server-side key management because the passphrase is present client-side.

For stronger secrecy, move encryption/decryption to Supabase Edge Functions with managed secrets.

## Prerequisites

- Node.js 18+ (Node 20 recommended)
- A Supabase project
- ntfy topic (unguessable, secret-style topic name)

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Configure runtime values in `public/config.js` (or inject `window.__QR_CONFIG` before `config.js` loads):

```js
window.__QR_CONFIG = {
  SUPABASE_URL: "https://your-project.supabase.co",
  SUPABASE_ANON_KEY: "your-anon-key",
  NTFY_TOPIC: "your-secret-topic",
  ENCRYPTION_PASSPHRASE: "a-strong-random-passphrase"
};
```

3. Apply DB setup:

- Open Supabase SQL Editor
- Run `supabase-setup.sql`

4. Start local dev server:

```bash
npm run dev
```

5. Open:

- Guest: `http://localhost:3000/`
- Owner: `http://localhost:3000/owner.html`

## Supabase Setup Details

`supabase-setup.sql` creates:

- `houses`
- `house_members`
- `doorbell_rings`
- `door_points`
- `owner_settings`
- `audit_log`
- RPCs: `ensure_owner_house`, `create_house`, `add_house_member_by_email`, `resolve_qr_token`, `create_doorbell_ring_by_token`
- Storage bucket: `guest_photos` (private)
- Strict tenant-scoped RLS policies
- Rate-limit trigger
- Audit triggers
- Realtime publication entries (idempotent)

After running SQL:

1. Enable Email auth provider in Supabase Auth.
2. Create owner account in Auth users.
3. Confirm `guest_photos` bucket exists and stays private.

## Configuration

Reference values are in `.env.example`.  
This project is static, so these are naming references; runtime comes from `public/config.js` (or injected `window.__QR_CONFIG`).

Main keys:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (or legacy alias `SUPABASE_KEY`)
- `NTFY_TOPIC`
- `ENCRYPTION_PASSPHRASE`

## Commands

- `npm run dev` - serve `public/` on port 3000
- `npm run lint` - eslint checks
- `npm run lint:fix` - auto-fix lint issues where possible
- `npm run check:syntax` - syntax check key JS files
- `npm run build` - static placeholder check

## Deployment

### Vercel (recommended)

1. Push repository to GitHub.
2. Import repo into Vercel.
3. Deploy with root directory as repository root.
4. Set runtime config strategy:
   - Either commit safe defaults in `public/config.js` and replace placeholders manually after clone
   - Or inject `window.__QR_CONFIG` via hosting template/script before `config.js`

`vercel.json` includes:

- security headers
- CSP
- cache strategy
- rewrite to `index.html` for unmatched routes

Use `/owner.html` for owner dashboard entry.

## GitHub Readiness (April 2026 baseline)

This repo now includes:

- CI workflow (`.github/workflows/ci.yml`)
- CodeQL workflow (`.github/workflows/codeql.yml`)
- Dependency review workflow (`.github/workflows/dependency-review.yml`)
- Dependabot config (`.github/dependabot.yml`)
- Security policy (`SECURITY.md`)
- PR template and issue templates

Recommended repository settings:

1. Enable branch protection on `main`:
   - require PR reviews
   - require status checks (CI + dependency review)
2. Enable code scanning default setup if not already active.
3. Enable secret scanning and push protection.
4. Keep dependency graph and Dependabot alerts enabled.

## Known Limitations

- Guest ring offline queue-to-server is not implemented; guest actions require connectivity to submit.
- Notification sound is loaded from an external media URL; allowlist is set in CSP.
- Client-side encryption passphrase management is deployment-managed, not HSM/KMS-backed.
- QR scanning is done by device camera/OS (the web app does not include in-app QR decoding).

## Project Structure

```text
.
|-- public/
|   |-- index.html
|   |-- owner.html
|   |-- offline.html
|   |-- config.js
|   |-- sw.js
|   |-- css/
|   |   |-- main.css
|   |   `-- components.css
|   |-- js/
|   |   |-- app.js
|   |   |-- auth.js
|   |   |-- crypto.js
|   |   |-- guest.js
|   |   |-- i18n.js
|   |   |-- owner-bootstrap.js
|   |   `-- utils.js
|   `-- icons/
|-- supabase-setup.sql
|-- vercel.json
|-- eslint.config.js
|-- package.json
`-- SECURITY.md
```

## License

MIT (`LICENSE`)

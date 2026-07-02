# Astronet Studios

Company website plus a client portal and admin dashboard backed by Supabase, Square, and Node.js.

## What Was Added

- Client portal login with role-based redirect.
- Client dashboard with website status, subscription plan, invoices, invoice PDF viewing, Square payment links, change requests, and support requests.
- Admin dashboard with client CRUD, detailed invoice creation, contract creation, invoice/contract PDF viewing, invoice payment-status tracking, and request visibility.
- Node.js Express API layer for Supabase-backed data and Square payment-link generation.
- Automatic invoice and contract PDF generation plus optional SMTP email delivery.
- Optional PandaDoc e-signature dispatch for contracts with webhook-based signed status updates.
- Admin can view both generated contract PDF and executed signed PDF when available.

## Local Setup

1. Copy `.env.example` to `.env` and fill in your Supabase and Square credentials.
2. In Supabase SQL Editor, run [server/supabase/schema.sql](server/supabase/schema.sql).
3. Create your admin user in Supabase Auth, then insert a matching row in `profiles` with `role = 'admin'`, or set `ADMIN_EMAIL` to the same email.
4. Install dependencies with `npm install`.
5. Start the app with `npm start`.
6. Open `http://localhost:3000`.

## Render Deploy

This repo now runs as a Node web service through [render.yaml](render.yaml).

1. Push this repository to GitHub.
2. In Render, choose New + > Blueprint.
3. Add the environment variables from `.env.example` in Render.
4. Deploy.

## Notes

- Square payment links are generated when an invoice is created or when a client clicks Pay Invoice, as long as Square credentials are configured.
- SMTP email delivery is optional. Set `SMTP_HOST`, `SMTP_PORT`, and `SMTP_FROM` to send invoice and contract PDFs automatically, and optionally set `SMTP_USER`, `SMTP_PASS`, and `SMTP_SECURE`.
- To enable e-sign contracts, set `PANDADOC_API_KEY` and `CONTRACT_SIGNER_EMAIL` (optionally `CONTRACT_SIGNER_NAME`) then configure PandaDoc webhook URL to `https://your-domain/api/webhooks/pandadoc`.
- Set `PANDADOC_WEBHOOK_SHARED_KEY` if you configure a shared key in PandaDoc webhook settings.
- Contracts use two-party signing: Astronet Studios signs first, then the client signs second.
- Executed signed contracts are retrievable from `/api/contracts/:contractId/executed-pdf` (authorized admin/client access).
- The frontend uses Supabase Auth in the browser and talks to the Express API with the signed-in user's access token.
- The portal is implemented in the existing `Client` folder so the marketing site and dashboards share the same visual system.
- Backend code and backend-only assets live under the `server` folder.

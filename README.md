# Launchpad Tech Jobs (Production Build)

Production-ready web app to help entry-level and internship seekers in IT, cybersecurity, and broader tech:

- Live + local job matching
- ATS resume scoring and keyword gap analysis
- Saved jobs and application tracker (persistent SQLite DB)
- Tiered paywall (`starter`, `momentum`, `accelerator`)
- Stripe checkout + webhook processing
- Admin analytics dashboard API

## Stack

- Frontend: HTML/CSS/Vanilla JS
- Backend: Python `http.server` API
- Database: SQLite (`data.db`)
- Auth: salted password hashing + signed bearer token
- Payments: Stripe Checkout Sessions + webhook signature verification

## Quick Start

1. Copy `.env.example` to `.env` and set values.
2. Start server:

```powershell
& "C:\Users\imack\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" server.py
```

3. Open:

- `http://localhost:8000`

## Admin Access

Admin user is bootstrapped on startup from env:

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

Use that account in the website login form, then click `Load Analytics`.

## Stripe Setup

Set these env vars:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_MOMENTUM`
- `STRIPE_PRICE_ACCELERATOR`

Create webhook endpoint:

- `POST /api/stripe/webhook`
- Subscribe at minimum to:
  - `checkout.session.completed`
  - `customer.subscription.updated`

If Stripe keys are empty, plan updates run in local development mode without charging.

## API Overview

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/jobs/search`
- `POST /api/resume/analyze`
- `GET /api/saved-jobs`
- `POST /api/saved-jobs`
- `DELETE /api/saved-jobs/:id`
- `GET /api/applications`
- `POST /api/applications`
- `DELETE /api/applications/:id`
- `POST /api/stripe/create-checkout-session`
- `POST /api/stripe/webhook`
- `GET /api/admin/analytics`

## Deployment Notes

- Put app behind HTTPS reverse proxy (Nginx/Caddy/Cloudflare).
- Store `.env` securely and rotate `JWT_SECRET`.
- Add managed DB backups for `data.db`.
- Restrict admin credentials and rotate frequently.

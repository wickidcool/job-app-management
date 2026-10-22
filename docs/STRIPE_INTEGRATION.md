# Stripe Integration — wiring, local dev, and go-live

Billing for the **Careerpin Pro** tier (WIC-2642, part of the Stripe tiered-signup
build [WIC-2570]). Pricing is fixed by the live marketing page: **Free $0 / Pro
$15.00 per month USD, monthly-only.**

This document is the operational reference for the four Stripe configuration names,
how they resolve in each environment, how to run Stripe locally, and the human-only
checklist for taking billing live. The application code that *uses* these values
lands under WIC-2570 (backend) and the web build; this doc covers the DevOps wiring
that makes the names resolvable.

> No secret values appear in this repo or in this document. The `sk_...` /
> `whsec_...` keys are pushed to the Worker secret store only — never committed,
> never pasted into comments or docs. See the repo's secrets-access policy
> (CLAUDE.md → ADR-0001 Addendum A §1).

## The four names

| Name | Kind | Example | Where it lives |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | **secret** | `sk_test_…` / `sk_live_…` | Worker secret store (`wrangler secret`) + `.dev.vars` locally |
| `STRIPE_WEBHOOK_SECRET` | **secret** | `whsec_…` | Worker secret store + `.dev.vars` locally |
| `STRIPE_PRICE_PRO` | non-secret | `price_…` | `wrangler.jsonc` `vars` (prod = live price) / `env.preview.vars` (test price) |
| `VITE_STRIPE_PUBLISHABLE_KEY` | non-secret (build-time) | `pk_test_…` / `pk_live_…` | GitHub repo/env **var** `STRIPE_PUBLISHABLE_KEY`, baked into the SPA at build |

A `price_…` id and a `pk_…` publishable key are **not credentials** — they identify
a Product/Price and are safe in client bundles and committed config. The two secrets
are the `sk_…` secret key and the `whsec_…` webhook signing secret.

### How each resolves per environment

- **Local dev** — all four read from `.dev.vars` (copy `.dev.vars.example`).
  `wrangler dev` loads them; the Vite dev server reads `VITE_STRIPE_PUBLISHABLE_KEY`.
- **Preview** — `STRIPE_PRICE_PRO` comes from `wrangler.jsonc` `env.preview.vars`;
  `VITE_STRIPE_PUBLISHABLE_KEY` is baked by the "Build for preview" step from the
  GitHub var `STRIPE_PUBLISHABLE_KEY`; the two secrets are pushed to the
  `jobtrail-preview` Worker by the "Sync preview Worker secrets" steps in
  `deploy.yml` (same optional-drop pattern as `ANTHROPIC_API_KEY` — an empty value
  is skipped with a warning, so preview stays green until the test keys are added).
- **Production** — `STRIPE_PRICE_PRO` comes from `wrangler.jsonc` top-level `vars`
  (live price); `VITE_STRIPE_PUBLISHABLE_KEY` is baked by the "Build for production"
  step from the same GitHub var; the two secrets are pushed **once** by a human via
  `wrangler secret put` at go-live and preserved across subsequent `wrangler deploy`
  runs. They are deliberately **not** in the production `wrangler-action` `secrets:`
  list, so an unpopulated GitHub secret can never wipe a live key.

**Graceful-off:** every path treats an empty `STRIPE_SECRET_KEY` / `STRIPE_PRICE_PRO`
as "billing not configured" — the Pro checkout is unavailable rather than erroring.
That is what lets this wiring ship ahead of the keys and ahead of the WIC-2570
backend.

## Local dev wiring

1. Copy the example and fill the Stripe block with **test-mode** values:

   ```bash
   cp .dev.vars.example .dev.vars
   # edit .dev.vars — set STRIPE_SECRET_KEY (sk_test_…), STRIPE_PRICE_PRO (price_…),
   # and VITE_STRIPE_PUBLISHABLE_KEY (pk_test_…) from the Stripe test dashboard.
   ```

   Test-mode keys come from the Stripe Dashboard in **Test mode** → Developers →
   API keys. `.dev.vars` is git-ignored; never commit it.

2. Forward webhooks to your local Worker with the Stripe CLI. `stripe listen`
   prints a per-session `whsec_…` signing secret — copy it into
   `STRIPE_WEBHOOK_SECRET` in `.dev.vars`:

   ```bash
   stripe login
   stripe listen --forward-to http://localhost:8787/api/stripe/webhook
   #   :8787 → `npm run dev:worker` (wrangler)   |   :3000 → `npm run dev:api` (Node)
   ```

3. Drive a test event:

   ```bash
   stripe trigger checkout.session.completed
   ```

The webhook route path (`/api/stripe/webhook` above) is owned by the WIC-2570
backend build; adjust the `--forward-to` path if that build registers a different
route.

## Go-live checklist (human-only)

No agent can mint live Stripe keys (WIC-2473 pattern). Each step below is a human
action in the Stripe Dashboard, the GitHub repo settings, or a terminal with
production Cloudflare credentials.

### A. Test mode (unblocks preview — can be done any time)

- [ ] In Stripe **Test mode**, create Product **"Careerpin Pro"** with a recurring
      **Price = $15.00 / month USD**. Copy the test `price_…` id.
- [ ] Put the test `price_…` into `wrangler.jsonc` → `env.preview.vars.STRIPE_PRICE_PRO`
      (open a PR; it is non-secret).
- [ ] Add GitHub **repo variable** `STRIPE_PUBLISHABLE_KEY` = the test `pk_test_…`
      (Settings → Secrets and variables → Actions → Variables). This feeds the
      preview web build.
- [ ] Add GitHub **secrets** `STRIPE_SECRET_KEY` (`sk_test_…`) and
      `STRIPE_WEBHOOK_SECRET` (`whsec_…`) on the environment the preview secret-sync
      reads. The `whsec_…` is created when you register a **test** webhook endpoint
      in the Stripe Dashboard pointed at the preview Worker URL
      (`…/api/stripe/webhook`), or use the Stripe CLI secret for local-only testing.
- [ ] Re-run a preview deploy; confirm the preview Worker resolves all four names
      and the "Sync preview Worker secrets" step no longer warns that
      `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` are empty.

### B. Live mode (production go-live)

- [ ] In Stripe **Live mode**, create Product **"Careerpin Pro"** with a recurring
      **Price = $15.00 / month USD**. Copy the live `price_…` id.
- [ ] Put the live `price_…` into `wrangler.jsonc` top-level `vars.STRIPE_PRICE_PRO`
      (PR; non-secret).
- [ ] Set the GitHub repo/production variable `STRIPE_PUBLISHABLE_KEY` to the live
      `pk_live_…` **before** the production build runs (it is baked into the bundle).
- [ ] Register a **live** webhook endpoint in Stripe pointed at the production
      Worker (`https://careerpin.app/api/stripe/webhook`); capture its `whsec_…`.
- [ ] Push the two live secrets to the **production** Worker (one-time; preserved by
      later deploys):

      ```bash
      wrangler secret put STRIPE_SECRET_KEY        # paste sk_live_…
      wrangler secret put STRIPE_WEBHOOK_SECRET    # paste whsec_… (live endpoint)
      ```

- [ ] Verify end-to-end against production (a real card or Stripe's live-mode test
      path), then confirm the webhook delivers and the subscription is recorded.

### Notes for whoever runs this

- Keep live and test keys strictly separated — a `sk_test_…` in production (or
  vice-versa) silently fails every charge.
- The production `wrangler-action` `secrets:` list in `deploy.yml` intentionally
  omits the Stripe secrets. If you later add them there, only do so once the GitHub
  secrets are populated, or an empty value will overwrite the live key on the next
  deploy.
- `STRIPE_PRICE_PRO` differs between preview (test price) and production (live
  price); that is why it lives in two places in `wrangler.jsonc`, not one.

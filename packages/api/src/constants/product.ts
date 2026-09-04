/**
 * The product's user-facing name and public address, for the strings the API emits.
 *
 * Almost nothing the API produces is read by a human. The exception is the exported
 * interview prep sheet (`exportInterviewPrep` in `services/interviewPrep.service.ts`),
 * which is assembled here and then downloaded, printed and carried into an interview —
 * so it is the one server-side artifact that needs a byline. See
 * `docs/design/CONTENT_STYLE.md`, Exception 1, for the ruling.
 *
 * ⚠️ **This duplicates `PRODUCT_NAME` in `packages/web/src/constants/title.ts` and must
 * move with it.** There is no shared package between `@wic/api` and `@wic/web` — the API
 * targets Workers and the web build is Vite — so the name cannot be imported across the
 * boundary. Two constants is the cost of that; two *literals* scattered through service
 * files is what this file exists to prevent. WIC-1102 is the standing evidence that an
 * un-greppable brand string does not get renamed when the brand does.
 */
export const PRODUCT_NAME = 'Careerpin';

/**
 * The **apex** marketing domain, bare — no scheme, no `www.`, no trailing slash.
 *
 * `careerpin.app` is what `.github/workflows/deploy-marketing.yml` points at the
 * marketing site (apex and `www` both CNAME to `careerpin-marketing.pages.dev`).
 * Deliberately *not* `app.careerpin.app`, which is the signed-in application: the reader
 * of an exported sheet may be an interviewer who has never heard of us, and sending them
 * to a login screen is worse than sending them nowhere.
 */
export const PRODUCT_URL = 'careerpin.app';

/**
 * The byline stamped at the foot of every exported interview prep sheet.
 *
 * `Generated with Careerpin — careerpin.app`. The separator is U+2014 EM DASH with spaces,
 * per the WIC-1102 ruling — not the U+2022 bullet the export modal's on-screen footer
 * uses, which joins a phrase to a date rather than a name to its address. No date: the
 * document's own `*Generated {date} | …*` metadata line already carries one. No terminal
 * period: it is a byline, not a sentence.
 */
export const EXPORT_BYLINE = `Generated with ${PRODUCT_NAME} — ${PRODUCT_URL}`;

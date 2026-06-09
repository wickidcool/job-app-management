# Careerpin Marketing Site

Static HTML/CSS/JS marketing site for `careerpin.com`.

## Structure

```
packages/marketing/
  index.html       Landing page
  pricing.html     Pricing comparison
  privacy.html     Privacy policy
  self-host.html   Self-hosting guide
  about.html       About Careerpin
  css/
    main.css       Global styles
  js/
    main.js        Minimal JavaScript (smooth scroll)
  images/          Static assets (to be added)
```

## Content Source

All copy is from [Landing Copy v2](/WIC/issues/WIC-494#document-landing-copy-v2) and [Positioning Brief v2](/WIC/issues/WIC-494#document-positioning-brief-v2).

## Technical Details

- **Pure HTML/CSS/JS** — No build step required
- **Mobile-responsive** — Grid/Flexbox layout, mobile-first
- **SEO-optimized** — Semantic HTML, proper meta tags, Open Graph
- **Fast first paint** — Minimal JS, CSS loaded in head
- **Accessible** — Semantic markup, proper heading hierarchy

## Local Development

Serve the directory with any static file server:

```bash
# Using Python
python3 -m http.server 8000

# Using Node.js (http-server)
npx http-server -p 8000

# Using PHP
php -S localhost:8000
```

Then visit `http://localhost:8000`

## Deployment to Cloudflare

### Option A: Cloudflare Pages

1. Connect the GitHub repository to Cloudflare Pages
2. Set build settings:
   - Build command: (none)
   - Build output directory: `packages/marketing`
   - Root directory: `/`
3. Deploy

### Option B: Cloudflare Worker

Create a Worker that serves static files from KV or R2:

```javascript
export default {
  async fetch(request) {
    const url = new URL(request.url);
    let path = url.pathname;

    // Default to index.html
    if (path === '/') path = '/index.html';

    // Serve from KV or R2
    const file = await ASSETS.get(path);
    if (!file) return new Response('Not found', { status: 404 });

    return new Response(file, {
      headers: { 'Content-Type': getContentType(path) },
    });
  },
};
```

### Domain Setup

Point `careerpin.com` to the Cloudflare Pages or Worker deployment. See [Domain Decision](/WIC/issues/WIC-502#document-domain-decision) for full DNS plan.

## SEO Meta Tags

All pages include:

- `<title>` tag
- `<meta name="description">` tag
- Open Graph tags (index.html)
- Proper semantic HTML (h1-h6 hierarchy)

## Browser Support

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Mobile Safari, Chrome Mobile
- No IE11 support (uses CSS Grid)

## Maintenance

To update copy:

1. Edit the HTML files directly
2. Formatting should match the tone from Positioning Brief v2 (calm, plain-spoken, slightly dry)
3. Test on mobile before deploying

## Future Enhancements

- Add hero visual image (STAR catalog screenshot)
- Add favicon and app icons
- Add analytics (privacy-respecting, e.g., Plausible)
- Add sitemap.xml
- Add Open Graph image (1200×630)

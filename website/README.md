# FabriXR — marketing website

Static, self-contained marketing site for **fabrixr.com**. No build step, no dependencies.

- `index.html` — the whole single-page site (inline CSS + JS).
- `favicon.svg` — the FabriXR mark (steel-frame, Holo colorway).

## Brand
Holo colorway — night-navy `#080B14`, hologram-blue `#3D5AFF`, electric-teal `#22E3D3`.
Type: **Space Grotesk** (display) + **Inter** (body) via Google Fonts. Logo is inline SVG
(matches `frontend/src/assets/brand/fabrixr-mark.svg`). To swap the colorway, edit the
`:root` tokens at the top of the `<style>` block.

## Preview locally
```bash
cd website && python -m http.server 8080   # then open http://localhost:8080
```

## Deploy to Vercel (separate static project)
1. New Vercel project → import this repo.
2. **Root Directory:** `website`
3. **Framework Preset:** Other · **Build Command:** *(none)* · **Output Directory:** `.`
4. Add the domain `fabrixr.com`.

`vercel.json` here sets clean URLs + long-cache for the favicon.

## TODO before launch
- Wire **Book a demo** to a real form/Calendly (currently `mailto:hello@fabrixr.com`).
- Replace placeholder pricing bands once locked, or swap to a single "Talk to us".
- Add a social/OG share image (`og:image`) and real customer logos/quotes.
- Optional: a real 90-sec demo video for the "Watch the 90-sec demo" CTA.

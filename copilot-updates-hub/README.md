# Microsoft 365 Copilot Updates

A static, single-page dashboard that displays Microsoft 365 Copilot feature
updates as a scannable, card-based view. It reads all of its data from a local
JSON file (`data/updates.json`) — there is **no build step, no backend, and no
dependencies**. It is pure HTML/CSS/JS designed to be served as static files
(e.g. GitHub Pages). An external agent updates `data/updates.json` on a
schedule; the page simply reads whatever is committed.

---

## The agent contract (LOCK THIS)

The page renders whatever lives in `data/updates.json`. Any agent writing to
that file **must** obey this exact shape. Treat it as a fixed contract.

```jsonc
{
  "generated_at": "2026-05-29T09:00:00Z",
  "source_run_id": "string",
  "items": [
    {
      "id": "roadmap-498765",                 // stable unique id
      "title": "Copilot in Excel: Python data analysis",
      "summary": "One-paragraph plain-English description, 1–3 sentences.",
      "app": "Excel",                          // see allowed apps below
      "status": "Launched",                    // "In development" | "Rolling out" | "Launched"
      "release_phase": "General Availability", // optional, freeform
      "platforms": ["Web", "Windows", "Mac"],  // optional array
      "clouds": ["Worldwide"],                 // optional: "Worldwide" | "GCC" | "GCC High" | "DoD"
      "roadmap_id": "498765",                  // optional
      "source": "M365 Roadmap",                // "M365 Roadmap" | "Release Notes" | "Tech Community" | "Copilot Blog" | "Message Center"
      "source_url": "https://...",             // canonical link
      "added_at": "2026-05-20T00:00:00Z",      // first time agent saw it
      "modified_at": "2026-05-28T00:00:00Z",   // last time agent saw a change
      "expected_release": "2026-Q3",           // optional, only for upcoming items
      "tags": ["AI", "Data analysis"]          // optional
    }
  ]
}
```

### Allowed `app` values

These double as the section headers in **Recently Released**:

```
"Word", "Excel", "PowerPoint", "Outlook", "Teams", "OneNote",
"OneDrive", "SharePoint", "Loop", "Whiteboard", "Copilot Chat",
"Copilot Studio", "Microsoft 365 Copilot"   (cross-app)
```

### Field notes for the agent

- **`id`** must be stable and unique — it identifies an item across runs.
- **`status`** drives which section an item lands in:
  - `"Launched"` → **Recently Released** (grouped by `app`).
  - `"Rolling out"` / `"In development"` → **Upcoming & Rolling Out**
    (grouped by `expected_release` quarter).
- **`modified_at`** drives sort order and the **NEW** ribbon. Bump it whenever
  the item meaningfully changes. The page marks an item **NEW** when its
  `modified_at` is newer than the visitor's last-seen `generated_at`.
- **`expected_release`** is parsed leniently — `"2026-Q3"`, `"2026 Q3"` both
  work. Missing/blank → grouped under **To be determined**.
- **`generated_at`** should be the run timestamp (ISO 8601, UTC `Z`). It powers
  "Last updated" and the NEW-ribbon watermark.
- Unknown `app` values still render (with a neutral badge) rather than being
  dropped — but stick to the allowed list for correct colours and grouping.

---

## Run it locally

No tooling required — just serve the folder over HTTP (opening `index.html`
via `file://` will fail because `fetch` can't read local files under that
protocol).

```bash
# Python (built in on most systems)
cd copilot-updates-hub
python -m http.server 8000
# then open http://localhost:8000

# …or with Node
npx serve .
```

Edit `data/updates.json` and refresh — the page cache-busts the fetch each
minute, and the in-page refresh button forces an immediate reload.

---

## Deploy to GitHub Pages

1. Push this folder's contents to the `main` branch of your repository.
2. In the repo: **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Select branch **`main`** and folder **`/ (root)`**, then **Save**.
5. Wait for the Pages build to finish; your site appears at
   `https://<user>.github.io/<repo>/`.

> The included `.nojekyll` file tells GitHub Pages to skip Jekyll processing
> and serve the files as-is (important so nothing under `data/` is mangled).
>
> If your repo root is the parent of `copilot-updates-hub/`, either move these
> files to the repo root or set Pages to serve from the appropriate folder.

---

## How updates flow

```
┌──────────────────┐     commits      ┌──────────────────┐    serves      ┌──────────────────┐
│  External agent  │ ───────────────▶ │  GitHub repo      │ ─────────────▶ │  GitHub Pages CDN │
│  (e.g. "Hermes") │  data/updates.   │  (main branch)    │  static files  │                   │
│  scrapes roadmap │  json            │                   │                │                   │
└──────────────────┘                  └──────────────────┘                └─────────┬────────┘
                                                                                     │ fetch('./data/updates.json?t=…')
                                                                                     ▼
                                                                          ┌──────────────────┐
                                                                          │  This page (JS)  │
                                                                          │  renders cards   │
                                                                          └──────────────────┘
```

In words: the agent gathers Copilot roadmap/release information, writes it into
`data/updates.json`, and commits to `main`. GitHub Pages serves that file as a
static asset. When a visitor opens (or refreshes) the page, the JavaScript
fetches the JSON with a per-minute cache-busting query param and re-renders the
dashboard entirely client-side. The page never writes data — it is a read-only
view.

---

## What's in the box

| File               | Purpose                                                        |
| ------------------ | -------------------------------------------------------------- |
| `index.html`       | Page structure (header, sticky controls, two sections).        |
| `styles.css`       | Themeable styling via CSS variables; light + dark themes.      |
| `app.js`           | Fetch, filter, sort, render, theming, URL-hash state, a11y.    |
| `data/updates.json`| The data the agent owns. Sample data ships for first render.   |
| `.nojekyll`        | Disables Jekyll on GitHub Pages.                               |

## Features

- Client-side search (title + summary + tags), debounced & case-insensitive.
- App, status, and time-window filters; **shareable via the URL hash**
  (`#app=Excel,Word&window=30&q=python`).
- Light/dark theme (persisted; honours `prefers-color-scheme` on first visit).
- Skeleton loading state, error state with retry, empty states with
  "Clear filters".
- Keyboard: `/` focuses search, `Esc` clears it.
- Accessible: semantic HTML, ARIA labels on badges/pills, visible focus rings,
  respects `prefers-reduced-motion`.

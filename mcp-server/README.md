# appscreen MCP server

An [MCP](https://modelcontextprotocol.io) server that generates App Store / Play Store / web
marketing screenshots, server-side. It's a Node port of the 2D rendering pipeline from
[appscreen](../README.md) (`app.js`): same output sizes, the same 25 gradient presets, and the
same background / device-placement / text-overlay math — rendered headlessly with
[`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas) (no browser, no Puppeteer).

## Connect to Claude (pick one)

### ① One command (Claude Code, local)

```bash
cd mcp-server && ./setup.sh
```

Installs deps, builds, and runs `claude mcp add appscreen …` for you. Then `claude mcp list`
should show **appscreen ✓**. Ask Claude: *"Generate a 6.9-inch App Store screenshot with the
Synthwave Dusk gradient and the headline 'Plan your adventures'."*

### ② Zero-config (open the repo in Claude Code)

This repo ships a project-scoped [`.mcp.json`](../.mcp.json). After a one-time
`cd mcp-server && npm install` (which builds `dist/`), Claude Code auto-discovers the
**appscreen** server whenever you open the project — nothing else to configure.

### ③ Docker / HTTP (one command)

```bash
cd mcp-server && ./setup.sh docker     # builds the image, starts it, registers the HTTP server
```

…or manually:

```bash
docker compose up -d                                            # http://localhost:3000/mcp
claude mcp add --transport http appscreen http://localhost:3000/mcp
```

### From the appscreen web app (Settings → MCP Server)

The web app can connect to this server directly: open **Settings**, fill in the **Server URL**
(e.g. `http://localhost:3000/mcp`) and an optional **access token**, and click **Connect**. It runs
the MCP handshake, shows a live status dot, and lists the available tools. The URL/token are stored
in your browser.

This needs the **HTTP** transport, which already sends permissive CORS headers. Lock the allowed
origin down in production with `MCP_CORS_ORIGIN` (e.g. `MCP_CORS_ORIGIN=https://yourapp.example`).
Note browser mixed-content rules: an `https://` page can only call an `http://` server on
`localhost` — for a remote server, serve it over HTTPS.

### Claude Desktop

Add to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```jsonc
{
  "mcpServers": {
    "appscreen": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/appscreen/mcp-server/dist/server.js"]
    }
  }
}
```

Prefer Docker? Use a stdio-over-container command instead:

```jsonc
{
  "mcpServers": {
    "appscreen": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "MCP_TRANSPORT=stdio",
               "-v", "/host/folder:/work", "appscreen-mcp", "node", "dist/server.js"]
    }
  }
}
```

> When the server writes files (`outputPath`) or reads image inputs by path, those paths are
> on the **server's** filesystem. With Docker, mount a host folder (`-v host:/work`) and use
> `/work/...` paths.

## Install, build & run manually

```bash
cd mcp-server
npm install      # also builds via the prepare script
npm run build    # or rebuild manually

npm start                       # stdio (default) — Claude Desktop / Claude Code
npm run start:http              # Streamable HTTP on http://localhost:3000/mcp
PORT=8787 node dist/server.js --http
```

The transport is chosen by `--http` (or `MCP_TRANSPORT=http`); otherwise stdio.

## Docker

```bash
docker compose up -d            # build + run the HTTP server, port 3000
# or
docker build -t appscreen-mcp .
docker run -d -p 3000:3000 -v "$PWD/work:/work" appscreen-mcp
curl http://localhost:3000/health        # {"ok":true}
```

The image bundles the fonts `@napi-rs/canvas` needs (DejaVu/Liberation sans + Noto color
emoji) and the laurel SVG assets, so text and decorative frames render correctly headless.

## Expose publicly (claude.ai / Claude Desktop custom connectors)

The **"Add custom connector"** flow in claude.ai / Claude Desktop connects to a **remote**
server that Anthropic's backend must reach over **public HTTPS on a standard port (443)**.
A `http://localhost:3000` URL — or any `:3000` URL behind Cloudflare — will fail with
*"Couldn't reach the MCP server"*, because:

- `localhost` isn't reachable from the internet, and
- Cloudflare's proxy only forwards a fixed set of ports — **3000 is not one of them** (use 443), and
- the endpoint must present a valid TLS certificate.

> For purely local use, you don't need any of this — use the stdio / `.mcp.json` /
> `claude mcp add` methods above. The public route is only for the connector UI / sharing.

### Cloudflare Tunnel (recommended if your domain is on Cloudflare)

No open ports, automatic HTTPS on 443, and it creates the DNS record for you:

1. Cloudflare **Zero Trust → Networks → Tunnels → Create a tunnel**, copy its **token**.
2. Run the server *with* the tunnel:
   ```bash
   TUNNEL_TOKEN=<your-token> docker compose --profile tunnel up -d
   ```
3. In the tunnel's **Public Hostname** settings, route your hostname
   (e.g. `appscreen.example.com`) to the service **`http://appscreen-mcp:3000`**.
4. Use this URL in the connector — **no port**:
   ```
   https://appscreen.example.com/mcp
   ```

(Equivalent with any reverse proxy — nginx/Caddy terminating TLS on 443 and forwarding to
the container's port 3000. The key points are the same: real DNS record, HTTPS, port 443.)

Lock down browser CORS in production with `MCP_CORS_ORIGIN` (e.g. `https://claude.ai`).

## Security (env vars)

| Variable | Effect |
|----------|--------|
| `MCP_AUTH_TOKEN` | When set, **every** REST + MCP endpoint (projects, blobs, uploads, files, `/mcp`) requires the token via `Authorization: Bearer <token>` or an `X-Auth-Token` header (the SSE `/events` stream and `/files/<id>` downloads also accept `?token=`, since those callers can't set headers). Unset → no auth, as before. The web app sends its Settings → MCP Server token as the Bearer token. `/health` stays open. |
| `MCP_IMAGE_DIR` | Base directory that **path-form image inputs** may be read from (default: the server's working directory). Paths escaping it are rejected. The Docker composes set it to `/work`. |
| `MCP_OUTPUT_DIR` | Base directory `outputPath` may write into (default `<projects dir>/outputs`; created if missing). Relative paths resolve inside it; escapes are rejected. The Docker composes set it to `/work`. |
| `MCP_ALLOW_PRIVATE_URLS` | `true` to allow http(s) image fetches to private / loopback / link-local / metadata addresses (blocked by default to prevent SSRF). |

Set `MCP_AUTH_TOKEN` whenever the server is reachable beyond localhost (LAN, tunnel, …).

## Tools

| Tool | What it does |
|------|--------------|
| `list_output_sizes` | All device/web output sizes (key → pixel dimensions). |
| `list_gradient_presets` | The 25 built-in presets (name → CSS + parsed angle/stops). |
| `generate_screenshot` | Render one screenshot → returns a PNG (and optionally writes `outputPath`). |
| `generate_batch` | Render up to 50 screenshots in one call. |
| `list_projects` | List the saved projects on the server's disk. |
| `get_project` | Read a project (compact summary, or full record with `includeImages`). |
| `create_project` / `delete_project` | Create or delete a project on disk. |
| `add_screenshot` | Append a screenshot panel (optionally with an image). |
| `set_screenshot_image` | Set a screenshot's image **for a given language**. |
| `set_screenshot_text` | Set a screenshot's headline / subheadline, one locale or many at once. |

## Projects (persisted on disk)

Projects are stored on the **server's disk** — one JSON file per project under `PROJECTS_DIR`
(default `./projects` next to where the server runs; override with `APPSCREEN_PROJECTS_DIR`).
Each file is the exact record the [appscreen](../README.md) web app persists, so projects
round-trip losslessly between the browser and the server.

This makes the disk the **shared source of truth**: the appscreen web app (Settings → MCP Server)
migrates its browser-only projects up to the server on connect and keeps them in sync, while the
MCP tools above let an agent browse and edit those same projects.

**Everything is per-language.** Screenshots keep a `localizedImages` map keyed by language code
(`en`, `fr`, `de`, …) and the headline/subheadline are per-language maps too. So:

- `set_screenshot_image` targets one `language` — call it once per locale to give a screenshot a
  localized image.
- `set_screenshot_text` takes either a single `headline`/`subheadline` + `language`, or a
  `headlines`/`subheadlines` map to set many locales in one call, e.g.
  `{"en":"Plan your trips","fr":"Planifiez vos voyages","de":"Planen Sie Ihre Reisen"}`.

The web app talks to these over a small REST API (HTTP transport only): `GET /projects`,
`GET /projects/:id`, `PUT /projects/:id` (create/overwrite — this is the migration path),
`DELETE /projects/:id`. These are mounted under **both `/` and `/mcp`**, so behind a reverse
proxy that only forwards `/mcp/*` to this server (e.g. a Cloudflare Tunnel where the rest of the
domain serves the web app), the app reaches them at `https://<host>/mcp/projects`. The MCP project
tools work on both stdio and HTTP transports.

> **Automatic deploys.** CI publishes this image to `ghcr.io/<owner>/appscreen-mcp:latest` on every
> merge to main; `docker-compose.prod.yml` (repo root) runs it alongside the web app with a
> Watchtower container that auto-pulls and redeploys. Point `APPSCREEN_PROJECTS_DIR` at a mounted
> volume (the prod compose uses `/data/projects`) so projects survive redeploys.

> The web app compresses the heavy raster images (screenshots + background) to JPEG before
> syncing, to save disk space; icons/graphics with transparency are left untouched.

### `generate_screenshot` input (abridged)

```jsonc
{
  "outputDevice": "iphone-6.9",          // or omit and pass width/height
  "background": {
    "type": "gradient",                   // gradient | solid | image
    "preset": "Synthwave Dusk",           // or gradientCss / gradient / solid / image
    "noise": true, "noiseIntensity": 6
  },
  "screenshot": {                          // optional device screenshot
    "image": "/abs/path/to/shot.png",      // path | data URL | base64
    "scale": 70, "x": 50, "y": 60, "cornerRadius": 24,
    "shadow": { "enabled": true, "blur": 40, "opacity": 30, "y": 20 },
    "frame":  { "enabled": false }
  },
  "text": {
    "position": "top", "offsetY": 8,
    "headline":    { "text": "Plan your\nadventures", "size": 130, "weight": "700", "color": "#ffffff" },
    "subheadline": { "enabled": true, "text": "Offline maps included", "size": 56, "opacity": 80 }
  },
  "outputPath": "/abs/path/to/out.png"     // optional; otherwise PNG is returned inline
}
```

Defaults mirror appscreen (`scale 70`, `y 60`, `cornerRadius 24`, headline `100/600`,
subheadline `50/400` at 70% opacity, drop shadow on).

### Images: sending in & getting back

**Send images in** — any field that takes an image (`screenshot.image`, `background.image`,
`elements[].image`) accepts these forms:

| Form | Example | Notes |
|------|---------|-------|
| **Upload ref** | `appscreen-file://ab12…` | Upload the bytes once via `POST /upload`, pass the returned `ref`. **Best for large images** — no base64 in the request. |
| **http(s) URL** | `https://cdn.example.com/shot.png` | The server fetches it. Use any hosted image. |
| **Data URL** | `data:image/png;base64,iVBORw0KGgo…` | Convenient for small inline images. |
| **Raw base64** | `iVBORw0KGgo…` / `/9j/…` | PNG, JPEG, GIF, WebP, BMP auto-detected by signature. |
| **File path** | `/work/shot.png` | Must exist on the **server's** filesystem (in Docker, mount it, e.g. `-v ./work:/work`). |

**Uploading large images (avoid base64)** — `POST /upload` accepts the raw image bytes (not
base64) and returns a short-lived reference, so neither the upload nor the render call carries a
giant base64 string:

```bash
curl -X POST "https://appscreen.example.com/upload?ttl=600" \
     -H "Content-Type: image/png" --data-binary @shot.png
# → { "ref": "appscreen-file://ab12…", "url": "https://…/files/ab12….png", "bytes": 408200, "expiresIn": 600 }
```

Then pass `"image": "appscreen-file://ab12…"` to `generate_screenshot`. The ref is resolved
straight from memory (no round-trip), auto-deletes after `ttl` seconds (default 3600), and works
through the Cloudflare Tunnel. This is the recommended Mac → remote-server path for big screenshots.

**Get the rendered image back** — three ways, via the `deliver` parameter:

| `deliver` | Result | When |
|-----------|--------|------|
| `inline` *(default)* | PNG as an MCP `image` block (base64) — the agent receives the picture directly. | Simplest; works on any transport. |
| `url` | A **temporary download URL** (`https://<host>/files/<id>.png`) that **auto-deletes** after `ttlSeconds` (default 600). Response stays tiny. | HTTP transport; great for large images or fetching from a browser/Mac. |
| `both` | Inline image **and** a temporary URL. | |

```jsonc
{ "outputDevice": "iphone-6.9", "background": { "preset": "Synthwave Dusk" },
  "deliver": "url", "ttlSeconds": 300 }
// → "Download (expires in 300s): https://appscreen.example.com/files/ab12….png"
```

The URL is served by the same HTTP server (so behind the Cloudflare Tunnel it's reachable at
`https://<your-host>/files/…`), held **in memory only**, and removed when it expires. Over the
**stdio** transport there's no HTTP server, so `url` falls back to `inline` with a note.

For correct links behind a proxy/tunnel, the server uses `X-Forwarded-Proto`/`X-Forwarded-Host`,
or set `PUBLIC_BASE_URL` (e.g. `https://appscreen.example.com`) explicitly.

You can also pass `outputPath` to additionally write the PNG to a path **on the server**.
`generate_batch` accepts the same `deliver` / `ttlSeconds` / `outputPath` per item.

### Full parameter coverage

The server supports **every** parameter of appscreen's 2D pipeline, in the app's exact
layer order (`background → noise → elements[behind] → screenshot → elements[above-screenshot]
→ popouts → text → elements[above-text]`):

- **Background** — `gradient` (preset / raw CSS / explicit angle+stops), `solid`, or `image`
  (`cover`/`contain`/`stretch`, blur, color overlay), plus `noise` + `noiseIntensity`.
- **Screenshot** — `scale`, `x`, `y`, `rotation`, `perspective`, `cornerRadius`, `shadow`
  (color/blur/opacity/offset), `frame` (device border).
- **Text** — headline + subheadline, each with font/size/weight/italic/underline/strikethrough/
  color/opacity, plus `position`, `offsetY`, `lineHeight`.
- **`elements[]`** — free-floating overlays on any layer:
  - `text` (with per-language `texts`, and decorative `frame`: `laurel-simple`, `laurel-detailed`,
    `badge-circle`, `badge-ribbon`, append `-star` for a star — e.g. `laurel-detailed-star`),
  - `emoji`, `icon` (square, with `iconShadow`), `graphic` (aspect-preserving image).
- **`popouts[]`** — cropped zoom callouts of the screenshot (`crop*`, position/size, rotation,
  `cornerRadius`, `shadow`, `border`).
- **Multi-language** — set a top-level `language` (default `"en"`); any `texts: {en, fr, …}`
  map on a headline, subheadline, or text element is resolved against it (falls back to `en`,
  then any value, then the plain `text`). One spec → render once per locale.

Laurel frames load SVGs from appscreen's `img/` folder; override the location with
`APPSCREEN_ASSETS_DIR` if you run the server from elsewhere.

### Avoid text/screenshot overlap (`layout`)

App Store headlines wrap to different line counts per language, which can make a
fixed screenshot placement collide with the text. Turn on `layout.avoidTextOverlap`
and the renderer measures the headline+subheadline block and constrains the
screenshot to the free band below (text on top) or above (text on bottom):

```jsonc
{
  "screenshot": { "scale": 84, "y": 100 },   // generous; treated as an upper bound
  "text": { "position": "top", "headline": { "texts": { "en": "…", "fr": "…" } } },
  "layout": { "avoidTextOverlap": true, "gap": 3.5 }  // gap = % of canvas height
}
```

The screenshot only ever moves down/up and shrinks to fit — it never grows past the
requested `scale`. Set `y` toward the far edge (e.g. `100` for top text) and let the
layout pull it into place. This keeps every locale collision-free regardless of how
each headline wraps onto a different number of lines.

## Fonts

appscreen's default UI font is SF Pro, which isn't guaranteed on a server. Pass `font` per
text block, or set fonts globally:

```bash
APPSCREEN_FONT_FAMILY="Inter"                      # default family name
APPSCREEN_FONT_PATH="/path/Inter.ttf:/path/Bold.ttf"  # register .ttf/.otf files (':'-separated)
```

## Use with Claude Desktop / Claude Code

Add to your MCP config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "appscreen": {
      "command": "node",
      "args": ["/Users/valentinhalgand/dev/appscreen/mcp-server/dist/server.js"],
      "env": { "APPSCREEN_FONT_FAMILY": "Inter" }
    }
  }
}
```

Then ask: *"Generate a 6.9-inch App Store screenshot with the Synthwave Dusk gradient and the
headline 'Plan your adventures'."*

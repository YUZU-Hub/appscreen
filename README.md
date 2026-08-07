# App Store Screenshot Generator

A free, open-source tool for creating beautiful App Store screenshots with customizable backgrounds, text overlays, and 3D device mockups.


**[Start using it now. Hosted on GitHub Pages](https://yuzu-hub.github.io/appscreen/)**

![App Store Screenshot Generator](img/screenshot-generator.png)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> 🍋 **Built by [YuzuHub](https://yuzuhub.com)** — We build smart AI products in Düsseldorf, Germany. Check out [yuzu.chat](https://yuzu.chat), [Eno](https://eno.yuzuhub.com), [VoltPlan](https://voltplan.app) and more.

## Features

### Output & Export
- **Multiple Output Sizes**: iPhone 6.9", 6.7", 6.5", 5.5" and iPad 12.9", 11" App Store requirements, plus custom sizes
- **Batch Export**: Export all screenshots at once as a ZIP file
- **Per-Screenshot Settings**: Each screenshot can have its own background, device settings, and text

### Backgrounds
- **Gradient Backgrounds**: Multi-stop gradients with draggable color stops and angle control
- **Preset Gradients**: Quick-access gradient presets for common styles
- **Solid Color**: Simple single-color backgrounds
- **Image Backgrounds**: Upload custom images with blur, overlay, and fit options
- **Noise Overlay**: Add subtle noise texture to any background

### Device Mockups
- **2D Mode**: Position, scale, rotate, and adjust corner radius of screenshots
- **3D Mode**: Interactive iPhone 15 Pro Max 3D mockup with drag-to-rotate
- **Position Presets**: Centered, bleed, tilt left/right, perspective, and more
- **Shadow Effects**: Customizable drop shadows with color, blur, opacity, and offset
- **Border Effects**: Add borders around screenshots with adjustable width and opacity

### Text Overlays
- **Headlines & Subheadlines**: Separate controls with enable/disable toggles
- **Font Picker**: Access to 1500+ Google Fonts with search and preview
- **Text Styling**: Font weight, italic, underline, strikethrough options
- **Positioning**: Top, center, or bottom placement with offset control
- **Line Height**: Adjustable spacing for multi-line text

### Multi-Language Support
- **Multiple Languages**: Add translations for any language
- **Language Flags**: Visual language switcher with flag icons
- **AI-Powered Translation**: Auto-translate using Claude, OpenAI, or Google AI
- **Per-Screenshot Languages**: Different text per screenshot if needed
- **Localized Screenshots**: Upload language-specific screenshot images with auto-detection from filename
- **Smart Duplicate Detection**: Dialog to replace, create new, or skip when uploading matching screenshots
- **Multi-Language Export**: Export current language only or all languages in separate folders

### Project Management
- **Multiple Projects**: Create, rename, and delete projects
- **Auto-Save**: All changes saved automatically to browser storage
- **Screenshot Count**: See screenshot counts in project selector
- **Image Compression**: Imported screenshots are re-encoded to WebP and capped at a maximum size before they are stored — quality, size and format are configurable in Settings → Image compression, where a one-click pass also re-encodes the images an existing project already stores

### User Interface
- **Dark Theme**: Easy on the eyes for extended editing sessions
- **Side Preview Carousel**: See adjacent screenshots while editing
- **Drag & Drop**: Reorder screenshots by dragging
- **Collapsible Sections**: Clean UI with expandable settings panels
- **Tab Persistence**: Remembers your active tab between sessions

### Automation (MCP)
- **AI Agent Generation**: An [MCP server](#mcp-server-generate-screenshots-with-ai-agents) lets Claude render screenshots headlessly — single shots or batches
- **In-App Connection**: Connect to an MCP server from Settings; the URL is auto-detected from the page
- **Runs Anywhere**: stdio for local use, HTTP for networked/Docker deployments

## Getting Started

### Just Want to Use It?

Visit **[yuzu-hub.github.io/appscreen](https://yuzu-hub.github.io/appscreen/)** to use the tool directly in your browser. No installation needed!

---

### Want to Develop & Customize?

#### Option 1: With Claude Desktop (Easiest - No Technical Knowledge Required)

Perfect for non-technical users who want to run and modify the tool locally with AI assistance:

1. **Install GitHub Desktop**
   - Download from [desktop.github.com](https://desktop.github.com)
   - Install and sign in with your GitHub account

2. **Clone this repository**
   - Click the green "Code" button above → "Open with GitHub Desktop"
   - Choose where to save it (e.g., Documents folder)

3. **Install Claude Desktop**
   - Download from [claude.ai/download](https://claude.ai/download)
   - Sign in with your Anthropic account

4. **Open in Claude Desktop**
   - Open Claude Desktop app
   - Click the "Code" tab at the top
   - Click "Open Folder" and select the cloned repository folder

5. **Start the app**
   - Simply type: **"start the app"**
   - Claude will automatically start the server and tell you which URL to open in your browser
   - Claude monitors the server and reports any issues

6. **Make changes**
   - Ask Claude to modify features, fix bugs, or add functionality
   - Claude will show you the proposed commit message before committing
   - All changes are automatically saved to Git

No command line, no technical setup - just chat with Claude!

#### Option 2: Run Locally (Command Line)

Since this app uses IndexedDB for persistence, you need to serve it through a local web server:

```bash
# Using Python
cd appscreen
python3 -m http.server 8000

# Using Node.js
npx serve .
```

Then open `http://localhost:8000` in your browser.

#### Option 3: VS Code Live Server

If you have the "Live Server" extension installed in VS Code, right-click `index.html` and select "Open with Live Server".

#### Option 4: Docker

Run the pre-built Docker image from GitHub Container Registry (published by CI on
every push to `main`):

```bash
# Using Docker directly
docker run -d -p 8080:80 ghcr.io/flocom/appscreen:latest

# Using Docker Compose
docker compose up -d
```

Then open `http://localhost:8080` in your browser.

**Updating to the latest version:**

```bash
# Pull the latest CI-built image and restart
docker compose pull && docker compose up -d

# …or rebuild from the current local source
docker compose up -d --build
```

#### Building locally

If you want to build the image yourself:

```bash
docker compose -f docker-compose.build.yml up -d
```

## Usage

1. **Upload Screenshots**: Drag and drop your app screenshots or click to browse
2. **Choose Output Size**: Select the target device size from the sidebar
3. **Customize Background**: Choose gradient, solid color, or image background
4. **Position Screenshot**: Use presets or manually adjust scale, position, and rotation
5. **Switch to 3D** (optional): Enable 3D mode for interactive iPhone mockup
6. **Add Text**: Enter your headline and optional subheadline
7. **Export**: Download the current screenshot or export all at once as ZIP

## AI Translation

To use the AI-powered translation feature:

1. Click the Settings icon (gear) in the sidebar
2. Choose your AI provider (Claude, OpenAI, or Google)
3. Enter your API key from the respective provider's console
4. Add multiple languages to your headline/subheadline
5. Click the translate icon and use "Auto-translate with AI"

Your API key is stored locally in your browser and only sent to the respective AI provider's API.

## MCP Server (generate screenshots with AI agents)

This repo ships an [**MCP**](https://modelcontextprotocol.io) server in [`mcp-server/`](mcp-server/)
that renders App Store / Play Store / web screenshots **headlessly** (no browser) — a Node port of
the same 2D pipeline (`app.js`) using [`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas).
It lets an AI agent like **Claude** generate marketing screenshots for you, on demand or in batches.

- **Tools:** `list_output_sizes`, `list_gradient_presets`, `generate_screenshot`, `generate_batch`
- **Full parameter coverage:** gradient/solid/image backgrounds + noise, device placement
  (scale/position/rotation/shadow/border), headline + subheadline, free-floating
  elements (text/emoji/icon/graphic with laurel/badge/star frames), cropped "popout" callouts,
  multi-language text, and an `avoidTextOverlap` layout safeguard.
- **Returns the rendered PNG** in the tool result (and can write it to a path).
- **Transports:** stdio (local) and Streamable HTTP (remote/networked).

### Connect Claude in one command

```bash
cd mcp-server && ./setup.sh          # builds, then registers the server with Claude Code
# or, over Docker / HTTP:
cd mcp-server && ./setup.sh docker
```

The repo also ships a project-scoped [`.mcp.json`](.mcp.json), so opening it in Claude Code
auto-discovers the **appscreen** server (after a one-time `cd mcp-server && npm install`).

### Run it in Docker

```bash
cd mcp-server && docker compose up -d        # HTTP server on http://localhost:3000/mcp
```

### Connect from the web app (Settings → MCP Server)

Open **Settings** in the app: the **MCP Server** URL is auto-detected from the page
(`http://<host>:3000/mcp`). Add an optional access token and click **Connect** to run the
handshake and list the available tools.

### Use it from claude.ai / Claude Desktop (public connector)

The "Add custom connector" flow needs a **publicly reachable HTTPS** endpoint on port **443** —
`localhost` or a `:3000` URL behind Cloudflare won't work. If your domain is on Cloudflare, the
included **Cloudflare Tunnel** exposes the server over HTTPS with no open ports:

```bash
cd mcp-server
TUNNEL_TOKEN=<your-cloudflare-tunnel-token> docker compose --profile tunnel up -d
```

Route the tunnel's public hostname to `http://appscreen-mcp:3000`, then use
`https://your-host/mcp` (no port) as the connector URL. Details in
[`mcp-server/README.md`](mcp-server/README.md#expose-publicly-claudeai--claude-desktop-custom-connectors).

> For local use (Claude Code / `.mcp.json` / `claude mcp add`) none of this is needed.

See [`mcp-server/README.md`](mcp-server/README.md) for the full parameter reference and all
connection options (Claude Desktop, HTTP, Docker stdio, fonts, CORS).

## Tech Stack

- Vanilla JavaScript (no frameworks)
- HTML5 Canvas for 2D rendering
- Three.js for 3D device mockups
- IndexedDB for local storage
- JSZip for batch export
- Google Fonts API for font picker
- Claude/OpenAI/Google APIs for translations
- Docker + nginx for containerized deployment
- MCP server (Node + @napi-rs/canvas) for headless, AI-agent screenshot generation

## Apps Using This Project

Built something with this tool? Add your app to the list by submitting a pull request!

| App | Description | Link |
|-----|-------------|------|
| Cable | Manage your 12V systems like Boats and RVs | [cable.yuzuhub.com](https://cable.yuzuhub.com) |
| Eno | Wine pairings and food pairings made easy | [eno.yuzuhub.com](https://eno.yuzuhub.com) |
| TravelRates Currency Converter* | Exchange Rates for Travelers | [apple.com](https://apps.apple.com/sg/app/travelrates-currency-converter/id6756080378) |
| Trakz Sales Tracker | Manage sales for restaurants and small businesses | [apple.com](https://apps.apple.com/us/app/trakz-sales-tracker/id6748954468) |
| AI Soccer Insights Football IQ | AI-powered football predictions and insights | [apple.com](https://apps.apple.com/us/app/ai-soccer-insights-football-iq/id6592649804) |
| Navegatime | time tracking for workers and business functions | [play.google.com](https://play.google.com/store/apps/details?id=com.companyname.NavegaTime) |
| Sommo | Your personal wine journey — scan labels, learn wine, and build your tasting journal | [sommo.app](https://sommo.app) |
| Dandelion: Write and Let Go | An ephemeral journal for writing to let go, not save. | [apple.com](https://apps.apple.com/us/app/dandelion-write-and-let-go/id6757363901) |
| *Your app here* | *Submit a PR to add your app* | *Your app link* |

## License

MIT License - feel free to use, modify, and distribute.

## Credits
- **Samsung Galaxy S25 Ultra 3D Model** by [mistJS](https://sketchfab.com/mistjs) - Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

- **iPhone 15 Pro Max 3D Model** by [MajdyModels](https://sketchfab.com/majdymodels) - Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

## Author

Proudly vibe coded by [Stefan](https://github.com/BlackMac) at [YuzuHub](https://yuzuhub.com/en) — building smart AI products from Düsseldorf, Germany.

# App Store Screenshot Generator

A free, open-source tool for creating beautiful App Store screenshots with customizable backgrounds, text overlays, and 3D device mockups.


**[Start using it now. Hosted on GitHub Pages](https://yuzu-hub.github.io/appscreen/)**

![App Store Screenshot Generator](img/screenshot-generator.png)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

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

### User Interface
- **Dark Theme**: Easy on the eyes for extended editing sessions
- **Side Preview Carousel**: See adjacent screenshots while editing
- **Drag & Drop**: Reorder screenshots by dragging
- **Collapsible Sections**: Clean UI with expandable settings panels
- **Tab Persistence**: Remembers your active tab between sessions

## Getting Started

### Option 1: Use Online

Visit **[yuzu-hub.github.io/appscreen](https://yuzu-hub.github.io/appscreen/)** to use the tool directly in your browser.

### Option 2: Run Locally

Since this app uses IndexedDB for persistence, you need to serve it through a local web server:

```bash
# Using Python
cd appscreen
python3 -m http.server 8000

# Using Node.js
npx serve .
```

Then open `http://localhost:8000` in your browser.

### Option 3: VS Code Live Server

If you have the "Live Server" extension installed in VS Code, right-click `index.html` and select "Open with Live Server".

### Option 4: Docker

Run the pre-built Docker image from GitHub Container Registry:

```bash
# Using Docker directly
docker run -d -p 8080:80 ghcr.io/yuzu-hub/appscreen:latest

# Using Docker Compose
docker compose up -d
```

Then open `http://localhost:8080` in your browser.

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

## Tech Stack

- Vanilla JavaScript (no frameworks)
- HTML5 Canvas for 2D rendering
- Three.js for 3D device mockups
- IndexedDB for local storage
- JSZip for batch export
- Google Fonts API for font picker
- Claude/OpenAI/Google APIs for translations
- Docker + nginx for containerized deployment

## Apps Using This Project

Built something with this tool? Add your app to the list by submitting a pull request!

| App | Description | Link |
|-----|-------------|------|
| Cable | Manage your 12V systems like Boats and RVs | [cable.yuzuhub.com](https://cable.yuzuhub.com) |
| Eno | Wine pairings and food pairings made easy | [eno.yuzuhub.com](https://eno.yuzuhub.com) |
| TravelRates Currency Converter* | Exchange Rates for Travelers | [apple.com](https://apps.apple.com/sg/app/travelrates-currency-converter/id6756080378) |
| *Your app here* | *Submit a PR to add your app* | *Your app link* |

## License

MIT License - feel free to use, modify, and distribute.

## Credits
- **Samsung Galaxy S25 Ultra 3D Model** by [mistJS](https://sketchfab.com/mistjs) - Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

- **iPhone 15 Pro Max 3D Model** by [MajdyModels](https://sketchfab.com/majdymodels) - Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

## Author

Proudly vibe coded by [Stefan from yuzuhub.com](https://yuzuhub.com/en)

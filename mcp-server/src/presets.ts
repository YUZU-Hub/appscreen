// Output sizes and gradient presets, ported verbatim from appscreen (app.js).

export interface Size {
  width: number;
  height: number;
}

// app.js:1239-1252 — outputSizes map
export const OUTPUT_SIZES: Record<string, Size> = {
  "iphone-6.9": { width: 1320, height: 2868 },
  "iphone-6.7": { width: 1290, height: 2796 },
  "iphone-6.5": { width: 1284, height: 2778 },
  "iphone-5.5": { width: 1242, height: 2208 },
  "ipad-13": { width: 2064, height: 2752 },
  "ipad-12.9": { width: 2048, height: 2732 },
  "ipad-11": { width: 1668, height: 2388 },
  "mac-2880": { width: 2880, height: 1800 },
  "mac-2560": { width: 2560, height: 1600 },
  "mac-1440": { width: 1440, height: 900 },
  "mac-1280": { width: 1280, height: 800 },
  "android-phone": { width: 1080, height: 1920 },
  "android-phone-hd": { width: 1440, height: 2560 },
  "android-tablet-7": { width: 1200, height: 1920 },
  "android-tablet-10": { width: 1600, height: 2560 },
  "web-og": { width: 1200, height: 630 },
  "web-twitter": { width: 1200, height: 675 },
  "web-hero": { width: 1920, height: 1080 },
  "web-feature": { width: 1024, height: 500 },
};

export const OUTPUT_DEVICES = Object.keys(OUTPUT_SIZES);

export interface GradientStop {
  color: string;
  position: number; // 0-100
}

export interface Gradient {
  angle: number; // degrees, stored verbatim from the CSS preset (app.js:4204)
  stops: GradientStop[];
}

// The 25 quick-access presets from the UI (index.html), as raw CSS strings.
export const GRADIENT_PRESET_CSS: Record<string, string> = {
  "Midnight Abyss": "linear-gradient(160deg, #0a0a0f 0%, #1a1033 50%, #0d1b2a 100%)",
  "Obsidian Plum": "linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)",
  "Carbon Slate": "linear-gradient(180deg, #1c1c1e 0%, #2c2c2e 100%)",
  "Steel Blue": "linear-gradient(135deg, #29323c 0%, #485563 100%)",
  "Neon Horizon": "linear-gradient(125deg, #0d0221 0%, #711c91 50%, #0abdc6 100%)",
  "Electric Surge": "linear-gradient(135deg, #1a0533 0%, #5b21b6 50%, #06b6d4 100%)",
  "Synthwave Dusk": "linear-gradient(150deg, #2d1b69 0%, #ff2d78 50%, #ff901f 100%)",
  "Indigo Rush": "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  "Northern Lights": "linear-gradient(135deg, #172347 0%, #015268 40%, #0ef3c5 100%)",
  "Deep Forest": "linear-gradient(160deg, #0f2027 0%, #203a43 50%, #2c5364 100%)",
  "Emerald Canopy": "linear-gradient(145deg, #134e4a 0%, #065f46 50%, #14532d 100%)",
  "Ocean Pulse": "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
  "Desert Dusk": "linear-gradient(170deg, #c84c28 0%, #d89c60 50%, #bb8a36 100%)",
  "Ember Glow": "linear-gradient(140deg, #7c2d12 0%, #c2410c 50%, #fb923c 100%)",
  "Mocha Silk": "linear-gradient(160deg, #292018 0%, #6b4226 60%, #a07850 100%)",
  "Golden Hour": "linear-gradient(135deg, #f7971e 0%, #ffd200 100%)",
  "Pacific Sunset": "linear-gradient(145deg, #f953c6 0%, #b91d73 50%, #4a1942 100%)",
  "Volcanic Dawn": "linear-gradient(130deg, #f12711 0%, #f5af19 100%)",
  "Deep Ocean": "linear-gradient(180deg, #011627 0%, #003459 50%, #007ea7 100%)",
  "Reef Lagoon": "linear-gradient(135deg, #1a6b7c 0%, #40b3c8 50%, #7de8dc 100%)",
  "Gold Noir": "linear-gradient(135deg, #020b13 0%, #1a1200 50%, #c9a227 100%)",
  "Velvet Noir": "linear-gradient(150deg, #1a0000 0%, #400128 50%, #6b0f1a 100%)",
  "Morning Mist": "linear-gradient(135deg, #e0eafc 0%, #cfdef3 100%)",
  "Sage Whisper": "linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)",
  "Royal Navy": "linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)",
};

export const GRADIENT_PRESET_NAMES = Object.keys(GRADIENT_PRESET_CSS);

// Parse a CSS `linear-gradient(<deg>deg, #hex <pos>%, ...)` string exactly the
// way appscreen does (app.js:4200-4216).
export function parseGradient(css: string): Gradient {
  const angleMatch = css.match(/(\d+)deg/);
  const angle = angleMatch ? parseInt(angleMatch[1], 10) : 135;
  const stops: GradientStop[] = [];
  const colorMatches = css.matchAll(/(#[a-fA-F0-9]{6})\s+(\d+)%/g);
  for (const m of colorMatches) {
    stops.push({ color: m[1], position: parseInt(m[2], 10) });
  }
  if (stops.length < 2) {
    throw new Error(`Gradient must have at least 2 color stops: "${css}"`);
  }
  return { angle, stops };
}

export function getPresetGradient(name: string): Gradient {
  const css = GRADIENT_PRESET_CSS[name];
  if (!css) {
    throw new Error(
      `Unknown gradient preset "${name}". Available: ${GRADIENT_PRESET_NAMES.join(", ")}`,
    );
  }
  return parseGradient(css);
}

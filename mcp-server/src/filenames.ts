// Filename parsing for bulk imports — a port of stripLanguageSuffix() in
// language-utils.js. The web app groups drag-and-dropped files by base name and
// reads the locale off the suffix ("home_de.png" → screen "home", language
// "de"); a bulk import over MCP has to slot files exactly the same way, or the
// two entry points would build different projects from the same folder.

/** Every language the app supports, longest-first so "pt-br" matches before "pt". */
export const SUPPORTED_LANGUAGES = [
  "en", "en-au", "en-ca", "en-gb", "de", "fr", "fr-ca", "es", "es-mx",
  "it", "pt", "pt-br", "nl", "ru", "ja", "ko", "zh", "zh-tw", "ar",
  "hi", "tr", "pl", "sv", "da", "no", "fi", "th", "vi", "id",
  "uk", "ca", "cs", "el", "he", "hr", "hu", "ms", "ro", "sk",
  "sl", "bn", "gu", "kn", "ml", "mr", "or", "pa", "ta", "te", "ur",
];

const BY_LENGTH = [...SUPPORTED_LANGUAGES].sort((a, b) => b.length - a.length);

/**
 * Split "screens/home_pt-br.png" into { base: "home", lang: "pt-br" }.
 * The suffix must be anchored at the end and separated by "_" or "-", so a file
 * called "made.png" isn't read as language "de".
 */
export function stripLanguageSuffix(filename: string): { base: string; lang: string | null } {
  const leaf = String(filename || "").split(/[\\/]/).pop() || "";
  const withoutExt = leaf.replace(/\.[^.]+$/, "");
  for (const lang of BY_LENGTH) {
    const escaped = lang.replace(/-/g, "[-_]");
    const pattern = new RegExp(`[_-]${escaped}(?:[-_][a-z]{2,4})?$`, "i");
    if (pattern.test(withoutExt)) {
      return { base: withoutExt.replace(pattern, ""), lang };
    }
  }
  return { base: withoutExt, lang: null };
}

/** Sort so "screen2" comes before "screen10" — plain sort gets that backwards. */
export function naturalCompare(a: string, b: string): number {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"]);

export function isImageFile(name: string): boolean {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return IMAGE_EXT.has(ext);
}

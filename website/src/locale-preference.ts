/**
 * Picks the site locale for a visitor who lands on the English home page. A language picked in the
 * navbar menu wins (the English site included); otherwise the browser's languages, in order.
 */

/** Where the navbar menu's pick is kept, per browser. */
const STORAGE_KEY = "linkedin-docs.locale";

export function rememberLocale(locale: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Storage blocked (private window, disabled site data): the menu still works, it is just not remembered.
  }
}

function rememberedLocale(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** The site locale for one BCP 47 tag (`pt-BR`, `es-MX`, `zh-TW`, `de`), or `undefined`. */
function matchLocale(tag: string, locales: readonly string[]): string | undefined {
  const exact = locales.find((locale) => locale.toLowerCase() === tag.toLowerCase());
  if (exact) return exact;

  const [language = "", ...rest] = tag.toLowerCase().split("-");
  const subtags = new Set(rest);
  const pick = (locale: string) => (locales.includes(locale) ? locale : undefined);
  const hasRegion = rest.some((subtag) => /^([a-z]{2}|\d{3})$/.test(subtag));

  switch (language) {
    case "zh":
      return ["hant", "tw", "hk", "mo"].some((subtag) => subtags.has(subtag)) ? pick("zh-Hant") : pick("zh-Hans");
    case "es":
      // Any Spanish outside Spain reads the Latin American translation.
      return hasRegion && !subtags.has("es") ? pick("es-419") : pick("es-ES");
    case "pt":
      return hasRegion && !subtags.has("br") ? pick("pt-PT") : pick("pt-BR");
    case "de":
      return subtags.has("ch") || subtags.has("li") ? pick("de-CH") : pick("de-DE");
    case "fr":
      return subtags.has("ca") ? pick("fr-CA") : pick("fr-FR");
    default:
      // English (`en`, `en-US`, …) and anything else: the first locale that shares the language.
      return locales.find((locale) => locale.toLowerCase().split("-")[0] === language);
  }
}

export function preferredLocale(locales: readonly string[]): string | undefined {
  const remembered = rememberedLocale();
  if (remembered && locales.includes(remembered)) return remembered;
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of languages) {
    const locale = tag && matchLocale(tag, locales);
    if (locale) return locale;
  }
  return undefined;
}

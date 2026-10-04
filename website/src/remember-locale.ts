/**
 * Client module: remembers the language picked in the navbar menu, so the English home page stops
 * sending that visitor to their browser's language once they have asked for another one.
 */
import ExecutionEnvironment from "@docusaurus/ExecutionEnvironment";
import siteConfig from "@generated/docusaurus.config";
import { rememberLocale } from "./locale-preference";

if (ExecutionEnvironment.canUseDOM) {
  const { locales } = siteConfig.i18n;
  // The locale menu's items (desktop dropdown and mobile sidebar) carry `lang`, the locale's htmlLang.
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest(".navbar a[lang]") : null;
    const locale = link?.getAttribute("lang");
    if (locale && locales.includes(locale)) rememberLocale(locale);
  });
}

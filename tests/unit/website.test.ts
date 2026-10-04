import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.join(__dirname, "..", "..");
const WEBSITE = path.join(REPO_ROOT, "website");
const DOCS = path.join(WEBSITE, "docs");

/** The locales `i18n.locales` in website/docusaurus.config.ts declares, the default one included. */
function configuredLocales(): string[] {
  const config = fs.readFileSync(path.join(WEBSITE, "docusaurus.config.ts"), "utf8");
  const list = /locales:\s*\[([^\]]*)\]/.exec(config);
  if (list === null) throw new Error("website/docusaurus.config.ts declares no i18n.locales");
  return [...list[1]!.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
}

/** Every Markdown page under `dir`, relative to it. `api/` is TypeDoc output, generated on build. */
function pages(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const found: string[] = [];
  const walk = (at: string): void => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      const relative = path.relative(dir, full).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (relative !== "api") walk(full);
      } else if (entry.name.endsWith(".md")) found.push(relative);
    }
  };
  walk(dir);
  return found.sort();
}

const translated = fs
  .readdirSync(path.join(WEBSITE, "i18n"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe("the docs site", () => {
  it("has a translation directory for every locale the config declares, and no other", () => {
    // website/scripts/build.mjs builds the locales it finds under website/i18n/.
    expect(translated).toEqual(
      configuredLocales()
        .filter((locale) => locale !== "en")
        .sort()
    );
  });

  it.each(translated)("mirrors every English guide in %s, page for page", (locale) => {
    const mirrored = pages(path.join(WEBSITE, "i18n", locale, "docusaurus-plugin-content-docs", "current"));
    expect(mirrored).toEqual(pages(DOCS));
  });
});

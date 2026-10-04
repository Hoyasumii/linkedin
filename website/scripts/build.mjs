// Builds the site one locale per process: `docusaurus build` alone runs every locale in a single
// process, and each locale leaves its memory behind, which runs a 15 GB machine out of memory before
// the eleventh. The default locale goes first and alone, because its build clears the whole of
// build/ (every other locale clears only build/<locale>/) and it is the only one that generates and
// compiles the TypeDoc reference. The translated locales are small, so they then build
// several at a time, each with its own generated-files directory (.docusaurus/<locale>/): Docusaurus
// writes its per-locale state (i18n, translations, route modules) there, and two builds sharing it
// link each other's pages.
//
// `node scripts/build.mjs`               every locale
// `node scripts/build.mjs pt-BR de-CH`   only these (build/ keeps the others from an earlier run)
// `node scripts/build.mjs --jobs 2`      at most two translated locales at a time (default 4)
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const DEFAULT_LOCALE = "en";
const DEFAULT_JOBS = 4;
const siteDir = fileURLToPath(new URL("..", import.meta.url));
const docusaurus = createRequire(import.meta.url).resolve("@docusaurus/core/bin/docusaurus.mjs");

// tests/unit/website.test.ts holds website/i18n/ to the locales the config declares.
const translated = readdirSync(new URL("../i18n/", import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const all = [DEFAULT_LOCALE, ...translated];

const args = process.argv.slice(2);
let jobs = DEFAULT_JOBS;
const requested = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--jobs" || arg.startsWith("--jobs=")) {
    const value = arg === "--jobs" ? args[++i] : arg.slice("--jobs=".length);
    jobs = Number(value);
    if (!Number.isInteger(jobs) || jobs < 1) {
      process.stderr.write(`--jobs takes a positive integer, not ${value}.\n`);
      process.exit(1);
    }
  } else {
    requested.push(arg);
  }
}

const unknown = requested.filter((locale) => !all.includes(locale));
if (unknown.length > 0) {
  process.stderr.write(`Unknown locale(s): ${unknown.join(", ")}. Known: ${all.join(", ")}.\n`);
  process.exit(1);
}
const locales = requested.length > 0 ? all.filter((locale) => requested.includes(locale)) : all;

/**
 * Builds one locale into its own generated-files directory; when others run beside it, its output
 * lines are prefixed with the locale.
 */
function build(locale, prefixed) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [docusaurus, "build", "--locale", locale], {
      cwd: siteDir,
      env: { ...process.env, DOCUSAURUS_GENERATED_FILES_DIR_NAME: `.docusaurus/${locale}` },
      stdio: prefixed ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    if (prefixed) {
      for (const [source, sink] of [
        [child.stdout, process.stdout],
        [child.stderr, process.stderr],
      ]) {
        let pending = "";
        source.setEncoding("utf8");
        source.on("data", (chunk) => {
          const lines = (pending + chunk).split("\n");
          pending = lines.pop();
          for (const line of lines) sink.write(`[${locale}] ${line}\n`);
        });
        source.on("end", () => {
          if (pending) sink.write(`[${locale}] ${pending}\n`);
        });
      }
    }
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function fail(locale, code) {
  process.stderr.write(`Build failed for locale ${locale}.\n`);
  process.exit(code);
}

const rest = locales.filter((locale) => locale !== DEFAULT_LOCALE);
if (locales.includes(DEFAULT_LOCALE)) {
  const code = await build(DEFAULT_LOCALE, false);
  if (code !== 0) fail(DEFAULT_LOCALE, code);
}

const queue = [...rest];
const prefixed = Math.min(jobs, rest.length) > 1;
await Promise.all(
  Array.from({ length: Math.min(jobs, rest.length) }, async () => {
    for (let locale = queue.shift(); locale !== undefined; locale = queue.shift()) {
      const code = await build(locale, prefixed);
      if (code !== 0) fail(locale, code);
    }
  })
);

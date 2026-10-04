import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import { themes as prismThemes } from "prism-react-renderer";

const repository = "https://github.com/Hoyasumii/linkedin";
const baseUrl = "/linkedin/";

// Docusaurus sets DOCUSAURUS_CURRENT_LOCALE before it loads this file for each locale.
const isDefaultLocale = (process.env.DOCUSAURUS_CURRENT_LOCALE ?? "en") === "en";

/** The language menu's labels, one per locale; `htmlLang` is the locale itself. */
const labels: Record<string, string> = {
  en: "English",
  "pt-BR": "Português (Brasil)",
};

/**
 * TypeDoc 0.28's default block tags (`OptionDefaults.blockTags`, spelled out: importing typedoc here
 * loads it a second time) plus the validation tags orval writes on src/generated/model/ (`@minLength`,
 * `@minimum`, …), which TypeDoc would warn about once each.
 */
const TYPEDOC_BLOCK_TAGS = [
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "pattern",
  "nullable",
  "defaultValue",
  "deprecated",
  "example",
  "jsx",
  "param",
  "privateRemarks",
  "remarks",
  "returns",
  "see",
  "throws",
  "typeParam",
  "author",
  "callback",
  "category",
  "categoryDescription",
  "default",
  "document",
  "extends",
  "augments",
  "yields",
  "group",
  "groupDescription",
  "import",
  "inheritDoc",
  "license",
  "module",
  "mergeModuleWith",
  "prop",
  "property",
  "return",
  "satisfies",
  "since",
  "sortStrategy",
  "template",
  "this",
  "type",
  "typedef",
  "summary",
  "preventInline",
  "inlineType",
  "preventExpand",
  "expandType",
].map((tag) => `@${tag}`);

const config: Config = {
  title: "@hoyasumii/linkedin",
  tagline: "An unofficial TypeScript SDK and MCP server to create, edit and delete your own LinkedIn posts.",
  favicon: "img/favicon.png",

  // GitHub Pages, published from the `gh-pages` branch by `pnpm docs:deploy` (run by .github/workflows/cd.yml).
  url: "https://hoyasumii.github.io",
  baseUrl,
  organizationName: "Hoyasumii",
  projectName: "linkedin",
  deploymentBranch: "gh-pages",
  trailingSlash: false,

  onBrokenLinks: "throw",

  // Rspack, SWC and Lightning CSS (@docusaurus/faster) instead of webpack and Babel, with a
  // persistent cache. The English build compiles the whole TypeDoc reference, which is most of its
  // build time. Static pages are not rendered on worker threads: every worker loads its own copy
  // of the server bundle with every reference page, which multiplies the memory a build needs.
  // scripts/build.mjs builds one locale per process for the same reason.
  future: {
    faster: {
      swcJsLoader: true,
      swcJsMinimizer: true,
      swcHtmlMinimizer: true,
      lightningCssMinimizer: true,
      mdxCrossCompilerCache: true,
      rspackBundler: true,
      rspackPersistentCache: true,
      gitEagerVcs: true,
      ssgWorkerThreads: false,
    },
  },

  headTags: [
    { tagName: "link", attributes: { rel: "preconnect", href: "https://fonts.googleapis.com" } },
    { tagName: "link", attributes: { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "anonymous" } },
  ],
  stylesheets: [
    "https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap",
  ],
  markdown: {
    // Plain Markdown, not MDX: a `{` in prose is just a brace.
    format: "md",
    hooks: { onBrokenMarkdownLinks: "throw" },
  },

  i18n: {
    defaultLocale: "en",
    locales: ["en", "pt-BR"],
    // Every baseUrl is explicit. scripts/build.mjs builds one locale per `docusaurus build --locale`,
    // and a build given a single locale drops the /<locale>/ segment from every inferred baseUrl
    // (meant for one domain per locale), which would serve pt-BR at /linkedin/ and point the language
    // menu at the wrong pages.
    localeConfigs: Object.fromEntries(
      Object.entries(labels).map(([locale, label]) => [
        locale,
        { label, htmlLang: locale, baseUrl: locale === "en" ? baseUrl : `${baseUrl}${locale}/` },
      ])
    ),
  },

  // Remembers the language picked in the navbar menu; src/pages/index.tsx reads it on the English
  // home page before falling back to the browser's languages.
  clientModules: ["./src/remember-locale.ts"],

  plugins: [
    // The TypeDoc reference is English whatever the locale, so only the English build generates and
    // compiles it: every translated locale would otherwise compile its own copy of the same pages. The translated sites exclude docs/api/ (see presets below) and link to the English one.
    ...(isDefaultLocale
      ? [
          [
            "docusaurus-plugin-typedoc",
            {
              entryPoints: ["../src/index.ts", "../src/mcp/index.ts"],
              tsconfig: "../tsconfig.json",
              out: "docs/api",
              readme: "none",
              excludePrivate: true,
              excludeInternal: true,
              skipErrorChecking: true,
              blockTags: TYPEDOC_BLOCK_TAGS,
              sidebar: { autoConfiguration: true, pretty: true },
            },
          ] as [string, object],
        ]
      : []),
    // Writes llms.txt and llms-full.txt from the English guides on every build. It always reads
    // website/docs/, so it runs for the default locale only: every other locale would get an English
    // copy. The TypeDoc reference stays out: it repeats the published .d.ts files.
    ...(isDefaultLocale
      ? [
          [
            "docusaurus-plugin-llms",
            {
              ignoreFiles: ["api/**"],
              includeOrder: ["intro.md", "linkedin-app.md", "mcp/**", "sdk/**", "cli/**", "contributing.md"],
            },
          ] as [string, object],
        ]
      : []),
  ],

  themes: [
    [
      // Offline search, indexed at build time (no search in `docusaurus start`). Ctrl/Cmd+K opens it.
      // One index per locale; the TypeDoc reference stays out, it would drown the guides.
      "@easyops-cn/docusaurus-search-local",
      {
        hashed: true,
        indexBlog: false,
        language: ["en", "pt"],
        ignoreFiles: [/(^|\/)docs\/api(\/|$)/],
        highlightSearchTermsOnTargetPage: true,
      },
    ],
  ],

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          // The translated sites leave out the TypeDoc reference (see plugins above).
          exclude: isDefaultLocale ? undefined : ["api/**"],
          editUrl: ({ locale, docPath }) =>
            locale === "en"
              ? `${repository}/edit/main/website/docs/${docPath}`
              : `${repository}/edit/main/website/i18n/${locale}/docusaurus-plugin-content-docs/current/${docPath}`,
        },
        blog: false,
        theme: { customCss: "./src/css/custom.css" },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: "img/social-card.png",
    colorMode: { defaultMode: "dark", respectPrefersColorScheme: true },
    docs: { sidebar: { hideable: true } },
    navbar: {
      title: "@hoyasumii/linkedin",
      logo: { alt: "hoyasumii", src: "img/logo.png" },
      items: [
        { type: "docSidebar", sidebarId: "guides", position: "left", label: "Docs" },
        { type: "doc", docId: "mcp/overview", position: "left", label: "MCP" },
        { type: "doc", docId: "sdk/overview", position: "left", label: "SDK" },
        { type: "doc", docId: "cli/overview", position: "left", label: "CLI" },
        // Only the English site has the reference. `pathname://` makes it a full page load, since the
        // page is not in the translated bundles; `autoAddBaseUrl: false` (passed through to <Link>)
        // keeps the locale's baseUrl off it, which <Link> would otherwise prepend to /linkedin/docs/api.
        isDefaultLocale
          ? { type: "docSidebar", sidebarId: "api", position: "left", label: "API Reference" }
          : { to: `pathname://${baseUrl}docs/api`, autoAddBaseUrl: false, position: "left", label: "API Reference" },
        { type: "localeDropdown", position: "right" },
        { href: repository, label: "GitHub", position: "right" },
      ],
    },
    footer: {
      style: "light",
      links: [
        {
          title: "Docs",
          items: [
            { label: "Getting started", to: "/docs/intro" },
            { label: "MCP server", to: "/docs/mcp/overview" },
            { label: "SDK", to: "/docs/sdk/overview" },
            { label: "CLI", to: "/docs/cli/overview" },
          ],
        },
        {
          title: "Package",
          items: [
            { label: "npm", href: "https://www.npmjs.com/package/@hoyasumii/linkedin" },
            { label: "GitHub", href: repository },
            { label: "Issues", href: `${repository}/issues` },
          ],
        },
      ],
      copyright:
        "MIT licensed. An independent client of the LinkedIn API: not affiliated with or endorsed by LinkedIn Corporation.",
    },
    prism: {
      theme: prismThemes.oneLight,
      darkTheme: prismThemes.oneDark,
      additionalLanguages: ["bash", "json", "powershell"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;

---
sidebar_position: 100
title: Contributing
description: "Set up the repository, run the checks and the tests, follow API changes, and build this documentation site."
---

# Contributing

The repository is [Hoyasumii/linkedin](https://github.com/Hoyasumii/linkedin), managed with pnpm (Node.js 20 or later).

```bash
pnpm install          # dependencies, plus the git hooks (husky)
pnpm build            # tsc → dist/ (CommonJS + .d.ts)
pnpm test:unit        # jest, with a fake LinkedIn on node:http (no network)
pnpm test:live        # against the real LinkedIn: posts, edits and deletes (.env.test, from env.example)
pnpm check:types      # tsc --noEmit over src and tests
pnpm check:lint       # oxlint (`pnpm fix:lint` fixes what it can)
pnpm check:format     # oxfmt, 120 columns (`pnpm fix:format` rewrites)
pnpm check:knip       # unused files, exports and dependencies
```

Every script is cross-platform: no `rm`, `$VAR` or `VAR=1 cmd`. `.gitattributes` keeps LF, with `.cmd`/`.vbs` in
CRLF.

The checks run locally through git hooks. `pre-commit` runs `check:lint` and `check:format`,
`commit-msg` runs commitlint with the conventional config (`feat: …`, `fix(mcp): …`), and `pre-push` runs
`check:types`, `check:knip` and `test:unit`.

Every push to `main` runs the Continuous Delivery workflow (`.github/workflows/cd.yml`). It runs the same checks
and the build, then:

- publishes `package.json`'s version to npm when that version is not on the registry yet (through Trusted
  Publishing, with provenance), tags it `v<version>` and opens a GitHub release;
- builds the site and deploys it to the `gh-pages` branch when the push touches `website/` or `src/` (a manual run
  of the workflow always deploys it).

To release, bump `version` in `package.json` and merge to `main`.

## Generated code

```bash
pnpm codegen          # spec/openapi.yml → src/generated/ (orval)
```

`spec/openapi.yml` is the single source: an OpenAPI 3.1 description of the part of LinkedIn's API this package
uses (Posts, Images, Videos, Documents and OpenID Connect `userinfo`), written for this package from LinkedIn's
public documentation on Microsoft Learn. `orval.config.ts` generates the `fetch` functions (through
`src/transport.ts`), the model types and the zod schemas. Never edit `src/generated/` by hand: change the spec and
run `pnpm codegen`.

To follow a change in the API: update the spec, run `pnpm codegen`, adjust `src/client.ts` and the tools, and
check it against LinkedIn with `pnpm test:live`. When LinkedIn retires a version, bump `DEFAULT_API_VERSION` in
`src/client.ts`.

## This site

The site is a Docusaurus workspace package in `website/`, in English and Portuguese (Brazil).

```bash
pnpm docs:dev                    # preview (append `--locale pt-BR` for the translation)
pnpm docs:build                  # build every locale into website/build/
pnpm docs:serve                  # serve the build (search only works on a build)
GIT_USER=<user> pnpm docs:deploy # build and push to the gh-pages branch
```

- The guides are plain Markdown in `website/docs/`, mirrored page for page in
  `website/i18n/pt-BR/docusaurus-plugin-content-docs/current/`: change both together.
- The [API reference](pathname://../docs/api) is generated from `src/index.ts` and `src/mcp/index.ts` by TypeDoc
  on every English build.
- `llms.txt` and `llms-full.txt` are generated at the site's root from the English guides on every build.

---
sidebar_position: 100
title: Contribuindo
description: "Prepare o repositório, rode as verificações e os testes, acompanhe mudanças da API e construa este site de documentação."
---

# Contribuindo

O repositório é [Hoyasumii/linkedin](https://github.com/Hoyasumii/linkedin), gerenciado com pnpm (Node.js 20 ou mais
recente).

```bash
pnpm install          # dependências, mais os git hooks (husky)
pnpm build            # tsc → dist/ (CommonJS + .d.ts)
pnpm test:unit        # jest, com um LinkedIn falso em node:http (sem rede)
pnpm test:live        # contra o LinkedIn real: posta, edita e remove (.env.test, a partir de env.example)
pnpm check:types      # tsc --noEmit sobre src e tests
pnpm check:lint       # oxlint (`pnpm fix:lint` corrige o que der)
pnpm check:format     # oxfmt, 120 colunas (`pnpm fix:format` reescreve)
pnpm check:knip       # arquivos, exports e dependências não usados
```

Todo script é multiplataforma: nada de `rm`, `$VAR` ou `VAR=1 cmd`. O `.gitattributes` mantém LF, com `.cmd`/`.vbs`
em CRLF.

As verificações rodam localmente por git hooks. `pre-commit` roda `check:lint` e `check:format`,
`commit-msg` roda o commitlint com a config convencional (`feat: …`, `fix(mcp): …`), e `pre-push` roda
`check:types`, `check:knip` e `test:unit`.

Todo push na `main` roda o workflow de Continuous Delivery (`.github/workflows/cd.yml`). Ele roda as mesmas
verificações e o build, e depois:

- publica a versão do `package.json` no npm quando ela ainda não está no registro (por Trusted Publishing, com
  provenance), cria a tag `v<versão>` e abre uma release no GitHub;
- constrói o site e faz o deploy na branch `gh-pages` quando o push toca em `website/` ou `src/` (uma execução manual
  do workflow sempre faz o deploy).

Para lançar uma versão, suba o `version` do `package.json` e faça o merge na `main`.

## Código gerado

```bash
pnpm codegen          # spec/openapi.yml → src/generated/ (orval)
```

`spec/openapi.yml` é a fonte única: uma descrição OpenAPI 3.1 da parte da API do LinkedIn que este pacote usa
(Posts, Images, Videos, Documents e o `userinfo` do OpenID Connect), escrita para este pacote a partir da
documentação pública do LinkedIn no Microsoft Learn. O `orval.config.ts` gera as funções `fetch` (passando por
`src/transport.ts`), os tipos do modelo e os schemas zod. Nunca edite `src/generated/` à mão: mude a spec e rode
`pnpm codegen`.

Para acompanhar uma mudança na API: atualize a spec, rode `pnpm codegen`, ajuste `src/client.ts` e as tools, e
confira contra o LinkedIn com `pnpm test:live`. Quando o LinkedIn aposentar uma versão, suba o
`DEFAULT_API_VERSION` em `src/client.ts`.

## Este site

O site é um pacote de workspace Docusaurus em `website/`, em inglês e português (Brasil).

```bash
pnpm docs:dev                    # pré-visualização (acrescente `--locale pt-BR` para a tradução)
pnpm docs:build                  # constrói todos os idiomas em website/build/
pnpm docs:serve                  # serve o build (a busca só funciona num build)
GIT_USER=<usuário> pnpm docs:deploy # constrói e envia para a branch gh-pages
```

- Os guias são Markdown puro em `website/docs/`, espelhados página a página em
  `website/i18n/pt-BR/docusaurus-plugin-content-docs/current/`: mude os dois juntos.
- A [referência da API](pathname://../../docs/api) é gerada de `src/index.ts` e `src/mcp/index.ts` pelo TypeDoc a
  cada build em inglês.
- `llms.txt` e `llms-full.txt` são gerados na raiz do site a partir dos guias em inglês a cada build.

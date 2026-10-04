---
sidebar_position: 1
title: Visão geral
description: "createLinkedInClient: o token, o autor, a versão da API e as opções que toda chamada aceita."
---

# SDK

```ts
import { createLinkedInClient } from "@hoyasumii/linkedin";

const linkedin = createLinkedInClient({
  accessToken: process.env.LINKEDIN_ACCESS_TOKEN!, // ou () => string | Promise<string>, chamada a cada request
  author: "urn:li:person:Ab12Cd34", // opcional: senão é lido uma vez do userinfo do OpenID Connect
  apiVersion: "202609", // opcional: o header LinkedIn-Version (YYYYMM)
  timeoutMs: 120_000, // opcional: por request; 0 desliga
});
```

| Método                                           | O que faz                                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| `createPost(params)`                             | Publica um post; responde `{ urn, url, author }`. Veja [Posts](./posts.md) |
| `editPost(post, { text })`                       | Troca o texto de um post; `post` é uma URN ou uma URL que contenha uma     |
| `deletePost(post)`                               | Remove um post (idempotente)                                               |
| `uploadImage` / `uploadVideo` / `uploadDocument` | Envia uma mídia sozinha; responde a URN. Veja [Mídia](./media.md)          |
| `me()`                                           | O membro logado (`userinfo` do OpenID Connect)                             |
| `author()`                                       | A person URN usada como autor dos posts                                    |

Todo método aceita um último argumento `{ signal }` para cancelá-lo.

## O token

O SDK não faz login sozinho: passe a ele um token de acesso de membro com `w_member_social` (e `openid profile`
quando você omitir `author`). Três jeitos de conseguir um:

- `linkedin mcp config --web` salva um; leia com `readCredentials(credentialsPath(configFilePath()))`, ou use
  `credentialSource(file)`, que relê o arquivo e renova o token quando consegue;
- o [gerador de tokens OAuth](https://www.linkedin.com/developers/tools/oauth/token-generator) do LinkedIn, para um
  teste rápido;
- o seu próprio fluxo OAuth, com os helpers `authorizationUrl`, `exchangeCode` e `credentialsFrom`.

```ts
import { createLinkedInClient, credentialSource, credentialsPath } from "@hoyasumii/linkedin";
import { configFilePath } from "@hoyasumii/linkedin/mcp";

const credentials = credentialSource(credentialsPath(configFilePath()));
const linkedin = createLinkedInClient({
  accessToken: async () => (await credentials()).accessToken,
  author: async () => (await credentials()).personUrn,
});
```

## O que ele envia

Toda chamada a `/rest/…` leva `Authorization: Bearer …`, `LinkedIn-Version` e
`X-Restli-Protocol-Version: 2.0.0`. URNs nos paths vão com percent-encoding. Uma criação responde `201` com a nova
URN no header `x-restli-id`, que o SDK devolve como `urn`. O token só é enviado aos hosts do próprio LinkedIn (as
URLs de upload ficam em `www.linkedin.com`) e nunca aparece num erro.

O LinkedIn mantém cada `LinkedIn-Version` por cerca de um ano. Quando a padrão for aposentada, defina uma mais
nova com `apiVersion` (ou `LINKEDIN_API_VERSION`), ou atualize o pacote.

## A lista local de posts

`PostRegistry` é a lista dos posts feitos pelo servidor MCP (`posts.json`). O cliente do SDK não escreve nela.
Veja [Lendo seus posts](../mcp/tools.md#lendo-seus-posts).

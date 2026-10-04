---
sidebar_position: 1
title: Primeiros passos
description: "Um SDK TypeScript e um servidor MCP não oficiais para criar, editar e remover seus próprios posts no LinkedIn, com uma CLI que faz o login e registra o servidor nos seus clientes de IA."
slug: /intro
---

# Primeiros passos

O `@hoyasumii/linkedin` permite que você, ou um agente de IA trabalhando para você, **crie, edite e remova seus
próprios posts no LinkedIn**: texto, imagens, um vídeo, um documento ou um link de artigo.

- **Servidor MCP** (`@hoyasumii/linkedin/mcp`, bin `linkedin-mcp`): seis ferramentas por stdio, para o Claude
  Code, o Codex, o OpenCode ou qualquer cliente MCP. Comece em [Servidor MCP](./mcp/overview.md).
- **SDK**: `createLinkedInClient`, métodos tipados sobre as APIs de Posts, Images, Videos e Documents do LinkedIn.
  Ele é gerado pelo [orval](https://orval.dev) a partir de uma spec OpenAPI escrita para este pacote. Comece em
  [SDK](./sdk/overview.md).
- **CLI** (`linkedin`): ela mesma não posta nada. `linkedin mcp config --web` faz o seu login no LinkedIn, e
  `linkedin mcp install` registra o servidor nos seus clientes de IA. Comece em [CLI](./cli/overview.md).

É um cliente independente e **não oficial**, com licença MIT. Não tem afiliação nem endosso do LinkedIn.

## O que o LinkedIn permite

A API do LinkedIn está aberta ao app de qualquer membro para **escrever** posts, mas não para **lê-los**:

| Você quer                                    | Permissão         | Disponível para o seu próprio app?                      |
| -------------------------------------------- | ----------------- | ------------------------------------------------------- |
| Criar, editar (o texto) e remover seus posts | `w_member_social` | Sim, pelo produto "Share on LinkedIn", liberado na hora |
| Saber quem fez login                         | `openid profile`  | Sim, por "Sign In with LinkedIn using OpenID Connect"   |
| Ler seus posts de volta                      | `r_member_social` | Não: o LinkedIn fechou essa permissão para apps novos   |

Por isso este pacote mantém uma **lista local dos posts que ele criou ou editou**, e é ela que as ferramentas
de "leitura" mostram. Posts feitos em linkedin.com não aparecem na lista. Mesmo assim, dá para editá-los ou
removê-los pela URN ou pela URL. Veja [Lendo seus posts](./mcp/tools.md#lendo-seus-posts).

## Instalação

Requer Node.js 20 ou mais recente e um app seu no LinkedIn, que leva cinco minutos para criar:
[Criando o app no LinkedIn](./linkedin-app.md).

```bash
npm i -g @hoyasumii/linkedin     # ou: pnpm add -g @hoyasumii/linkedin
linkedin mcp config --web        # cole o Client ID e o Secret do app e faça login no LinkedIn
linkedin mcp install             # registra o linkedin-mcp (stdio) no Claude Code / Codex / OpenCode
```

Depois, peça ao seu agente: _"Posta no LinkedIn que acabei de lançar a v1.0 do meu projeto, com o screenshot.png."_

Como biblioteca, `npm install @hoyasumii/linkedin`:

```ts
import { createLinkedInClient } from "@hoyasumii/linkedin";

const linkedin = createLinkedInClient({ accessToken: process.env.LINKEDIN_ACCESS_TOKEN! });
const { urn, url } = await linkedin.createPost({ text: "Olá pela API (sim, com parênteses)!" });
await linkedin.editPost(urn, { text: "Olá pela API, editado." });
await linkedin.deletePost(urn);
```

`linkedin docs` abre este site.

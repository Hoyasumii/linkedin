---
sidebar_position: 2
title: linkedin mcp
description: "config, status, logout, install e uninstall: todas as flags, e como o login funciona."
---

# linkedin mcp

## linkedin mcp config

Salva o seu [app do LinkedIn](../linkedin-app.md) e faz o seu login.

```bash
linkedin mcp config --web                 # tudo numa página web local (recomendado)
linkedin mcp config                       # pergunta o Client ID e o Secret aqui, depois abre o login
linkedin mcp config --client-id … --client-secret …   # sem perguntas (scripts)
```

Com `--web`, ele serve uma página em `http://localhost:3769` que lista os passos de configuração do app, com a URL
de redirect para copiar. Você cola o Client ID e o Client Secret ali e clica em _Save and sign in with LinkedIn_.
O LinkedIn pede para você autorizar o app e manda você de volta para `http://localhost:3769/callback`. A página
então salva o login e diz quem você é e até quando. O comando espera até 10 minutos.

| Flag                             | Efeito                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| `--web`                          | Faz tudo na página web                                                                     |
| `--client-id`, `--client-secret` | Salva esses valores sem perguntar (o secret fica no histórico do shell)                    |
| `--redirect-port <porta>`        | Escuta nessa porta em vez da 3769 (`''` volta ao padrão); o app precisa listar a mesma URL |
| `--api-version <YYYYMM>`         | A `LinkedIn-Version` a enviar (`''` volta ao padrão)                                       |
| `--no-login`                     | Só salva as configurações                                                                  |
| `--no-open`                      | Mostra o link em vez de abrir o navegador                                                  |
| `--config <arquivo>`             | Outro `.env` (env `LINKEDIN_CONFIG`)                                                       |

Um secret em branco mantém o salvo. Rodar de novo mais tarde, quando o token de 60 dias vencer, é um clique só.

A página é protegida à altura do token que salva. Toda URL dela leva um token aleatório, o header `Host` é
conferido, e o redirect do LinkedIn precisa trazer um `state` de uso único emitido por essa página.

## linkedin mcp status

Quem está logado, até quando, o Client ID do app e a URL de redirect. Sai com `3` quando ninguém está logado ou o
login venceu.

## linkedin mcp logout

Apaga o `credentials.json`. As configurações do app ficam. Para revogar também o acesso do app do lado do
LinkedIn, remova-o em
[linkedin.com/psettings/permitted-services](https://www.linkedin.com/psettings/permitted-services).

## linkedin mcp install

Registra o `linkedin-mcp` (stdio) no Claude Code, no Codex e no OpenCode, com o nome `linkedin`. Exige um login.
Sem `--client`, mostra uma lista dos clientes encontrados no PATH.

| Flag                    | Efeito                                                                    |
| ----------------------- | ------------------------------------------------------------------------- |
| `--client claude,codex` | Pula a lista (`claude`, `codex`, `opencode`; `…@windows` a partir do WSL) |
| `--force`               | Com `--client`: substitui uma entrada `linkedin` que já exista            |
| `--dry-run`             | Mostra os comandos em vez de executá-los                                  |
| `--config <arquivo>`    | Registra com outro `.env` (passado como `LINKEDIN_CONFIG`)                |

Reinicie o cliente, ou reconecte os servidores MCP dele, para carregá-lo.

## linkedin mcp uninstall

Remove a entrada `linkedin` dos clientes escolhidos (ou de `--client`), com `--dry-run` para conferir antes. Roda
sem login, então dá para limpar um cliente depois. O OpenCode não tem `mcp remove`, então o arquivo de
configuração dele é editado no lugar, mantendo os comentários.

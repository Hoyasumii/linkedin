---
sidebar_position: 1
title: Visão geral
description: "A CLI linkedin: ela faz o login e registra o servidor MCP; postar é trabalho do servidor MCP."
---

# CLI

O comando `linkedin` não posta nada. Postar é trabalho do [servidor MCP](../mcp/overview.md), ou do
[SDK](../sdk/overview.md) no seu próprio código. A CLI faz a configuração:

```bash
linkedin mcp config --web    # salva o seu app do LinkedIn e faz login, numa página web local
linkedin mcp install         # registra o linkedin-mcp no Claude Code, no Codex ou no OpenCode
linkedin mcp status          # quem está logado, e por mais quantos dias
linkedin mcp logout          # esquece o login neste computador
linkedin mcp uninstall       # remove o servidor dos seus clientes
linkedin docs                # abre este site
```

Todos os comandos: [`linkedin mcp`](./mcp-commands.md). No Windows e no WSL: [Windows e WSL](./windows.md).

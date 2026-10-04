---
sidebar_position: 1
title: Visão geral
description: "O servidor MCP do LinkedIn: seis ferramentas por stdio que postam, editam e removem como você, e listam o que postaram."
---

# Servidor MCP

O `linkedin-mcp` é um servidor MCP que posta no **seu** perfil do LinkedIn. Um cliente MCP (Claude Code, Codex,
OpenCode, Claude Desktop…) o inicia e conversa com ele por stdio.

| Ferramenta             | O que faz                                                                  |
| ---------------------- | -------------------------------------------------------------------------- |
| `linkedin_whoami`      | Quem está logado, e quando o login vence                                   |
| `linkedin_create_post` | Publica um post: texto, mais imagens, um vídeo, um documento ou um link    |
| `linkedin_edit_post`   | Troca o texto de um post                                                   |
| `linkedin_delete_post` | Remove um post (exige `confirm: true`)                                     |
| `linkedin_list_posts`  | Os posts feitos ou editados por este servidor, do mais novo ao mais antigo |
| `linkedin_get_post`    | Um desses posts                                                            |

Detalhes de cada uma: [Ferramentas](./tools.md).

O servidor não guarda nenhum segredo na configuração do cliente: ele lê o login salvo pelo `linkedin mcp config`
(`credentials.json`) a cada chamada, então um novo login vale sem reiniciar o cliente.

Para configurar: [Configuração inicial](./setup.md). Para embutir no seu próprio programa:
[Uso programático](./programmatic.md).

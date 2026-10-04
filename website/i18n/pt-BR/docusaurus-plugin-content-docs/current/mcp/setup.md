---
sidebar_position: 2
title: Configuração inicial
description: "Faça login uma vez e registre o servidor MCP do LinkedIn no Claude Code, no Codex e no OpenCode, ou à mão em qualquer cliente."
---

# Configuração inicial

## O jeito rápido

Com [o seu app no LinkedIn](../linkedin-app.md) criado:

```bash
npx -p @hoyasumii/linkedin linkedin mcp config --web   # cole o Client ID e o Secret e faça login no LinkedIn
npx -p @hoyasumii/linkedin linkedin mcp install        # registra o linkedin-mcp nos clientes encontrados
```

Ou instale o pacote globalmente (`npm i -g @hoyasumii/linkedin`) e dispense o `npx -p …`.

O `install` mostra uma lista dos clientes que encontrou no PATH: Claude Code, Codex e OpenCode. Marque os que quiser,
e ele registra o servidor pela CLI de cada cliente, com o nome `linkedin`. Ele inicia
`node <pacote>/dist/mcp/cli.js` pelo caminho absoluto, então não depende do PATH que o cliente passa aos seus
servidores. Veja [`linkedin mcp install`](../cli/mcp-commands.md#linkedin-mcp-install) para as flags.

## À mão

Qualquer cliente que rode servidores stdio pode iniciá-lo. Ele só precisa do login salvo:

```json
{
  "mcpServers": {
    "linkedin": { "command": "npx", "args": ["-y", "-p", "@hoyasumii/linkedin", "linkedin-mcp"] }
  }
}
```

No Claude Code:

```bash
claude mcp add linkedin -s user -- npx -y -p @hoyasumii/linkedin linkedin-mcp
```

Para usar um token de outro lugar no lugar do login salvo (um job de CI, uma segunda conta), passe-o no ambiente:
`LINKEDIN_ACCESS_TOKEN`, mais `LINKEDIN_PERSON_URN` para evitar a chamada a `userinfo`. Veja
[Configuração](./configuration.md).

## Confira

Pergunte ao seu agente _"Quem sou eu no LinkedIn?"_: ele chama `linkedin_whoami`. No terminal,
`linkedin mcp status` mostra o mesmo.

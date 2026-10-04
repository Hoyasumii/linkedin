---
sidebar_position: 5
title: Uso programático
description: "Sirva o servidor MCP do LinkedIn a partir do seu próprio programa, por stdio ou qualquer transporte MCP."
---

# Uso programático

O `@hoyasumii/linkedin/mcp` exporta as peças do servidor:

```ts
import {
  buildLinkedInMcpServer,
  configFilePath,
  connectionFor,
  readEnvFile,
  resolveMcpConfig,
  serveLinkedInMcpStdio,
} from "@hoyasumii/linkedin/mcp";

const configFile = configFilePath();
const config = resolveMcpConfig({ env: process.env, file: readEnvFile(configFile), configFile });
const connection = connectionFor(config); // { client, registry, credentialsFile }

// Por stdio, como o linkedin-mcp faz:
const running = await serveLinkedInMcpStdio(connection);
await running.closed;

// Ou o McpServer puro, para qualquer transporte:
const server = buildLinkedInMcpServer(connection);
```

O `connectionFor` monta o cliente do SDK a partir do login salvo (ou de `LINKEDIN_ACCESS_TOKEN`) e a lista de
posts ao lado da configuração. Uma conexão sua também funciona:
`{ client: createLinkedInClient({ … }), registry: new PostRegistry("posts.json") }`.

---
sidebar_position: 5
title: Programmatic use
description: "Serve the LinkedIn MCP server from your own program, over stdio or any MCP transport."
---

# Programmatic use

`@hoyasumii/linkedin/mcp` exports the server's pieces:

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

// Over stdio, as linkedin-mcp does:
const running = await serveLinkedInMcpStdio(connection);
await running.closed;

// Or the bare McpServer, for any transport:
const server = buildLinkedInMcpServer(connection);
```

`connectionFor` builds the SDK client from the saved sign-in (or `LINKEDIN_ACCESS_TOKEN`) and the post list
beside the configuration. A connection of your own works too:
`{ client: createLinkedInClient({ … }), registry: new PostRegistry("posts.json") }`.

---
sidebar_position: 1
title: Overview
description: "createLinkedInClient: the token, the author, the API version and the options every call takes."
---

# SDK

```ts
import { createLinkedInClient } from "@hoyasumii/linkedin";

const linkedin = createLinkedInClient({
  accessToken: process.env.LINKEDIN_ACCESS_TOKEN!, // or () => string | Promise<string>, called per request
  author: "urn:li:person:Ab12Cd34", // optional: read once from OpenID Connect userinfo otherwise
  apiVersion: "202609", // optional: the LinkedIn-Version header (YYYYMM)
  timeoutMs: 120_000, // optional: per request; 0 turns it off
});
```

| Method                                           | What it does                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| `createPost(params)`                             | Publishes a post; answers `{ urn, url, author }`. See [Posts](./posts.md) |
| `editPost(post, { text })`                       | Replaces a post's text; `post` is a URN or a URL holding one              |
| `deletePost(post)`                               | Deletes a post (idempotent)                                               |
| `uploadImage` / `uploadVideo` / `uploadDocument` | Uploads media on its own; answers its URN. See [Media](./media.md)        |
| `me()`                                           | The signed-in member (OpenID Connect `userinfo`)                          |
| `author()`                                       | The person URN posts are made as                                          |

Every method takes a last `{ signal }` argument to cancel it.

## The token

The SDK does not sign in by itself: give it a member access token with `w_member_social` (and `openid profile`
when you leave `author` out). Three ways to get one:

- `linkedin mcp config --web` saves one; read it with `readCredentials(credentialsPath(configFilePath()))`, or
  use `credentialSource(file)`, which re-reads the file and refreshes it when it can;
- LinkedIn's [OAuth token generator](https://www.linkedin.com/developers/tools/oauth/token-generator), for a quick
  test;
- your own OAuth flow, with the helpers `authorizationUrl`, `exchangeCode` and `credentialsFrom`.

```ts
import { createLinkedInClient, credentialSource, credentialsPath } from "@hoyasumii/linkedin";
import { configFilePath } from "@hoyasumii/linkedin/mcp";

const credentials = credentialSource(credentialsPath(configFilePath()));
const linkedin = createLinkedInClient({
  accessToken: async () => (await credentials()).accessToken,
  author: async () => (await credentials()).personUrn,
});
```

## What it sends

Every call to `/rest/…` carries `Authorization: Bearer …`, `LinkedIn-Version` and
`X-Restli-Protocol-Version: 2.0.0`. URNs in paths are percent-encoded. A create answers `201` with the new
URN in the `x-restli-id` header, which the SDK returns as `urn`. The token is sent only to LinkedIn's own hosts
(upload URLs live on `www.linkedin.com`) and never appears in an error.

LinkedIn keeps each `LinkedIn-Version` for about a year. When the default one is retired, set a newer one
with `apiVersion` (or `LINKEDIN_API_VERSION`), or update the package.

## The local post list

`PostRegistry` is the list of posts the MCP server made (`posts.json`). The SDK client does not write to it.
See [Reading your posts](../mcp/tools.md#reading-your-posts).

---
sidebar_position: 2
title: Setup
description: "Sign in once and register the LinkedIn MCP server in Claude Code, Codex and OpenCode, or by hand in any client."
---

# Setup

## The quick way

With [your LinkedIn app](../linkedin-app.md) created:

```bash
npx -p @hoyasumii/linkedin linkedin mcp config --web   # paste the Client ID and Secret, sign in on LinkedIn
npx -p @hoyasumii/linkedin linkedin mcp install        # register linkedin-mcp in the clients found
```

Or install the package globally (`npm i -g @hoyasumii/linkedin`) and drop the `npx -p …`.

`install` shows a checklist of the clients it found on your PATH: Claude Code, Codex and OpenCode. Tick the ones
you want, and it registers the server through each client's own CLI, under the name `linkedin`. It launches
`node <package>/dist/mcp/cli.js` by absolute path, so it does not depend on the PATH the client hands its servers.
See [`linkedin mcp install`](../cli/mcp-commands.md#linkedin-mcp-install) for the flags.

## By hand

Any client that runs stdio servers can start it. It needs nothing but the saved sign-in:

```json
{
  "mcpServers": {
    "linkedin": { "command": "npx", "args": ["-y", "-p", "@hoyasumii/linkedin", "linkedin-mcp"] }
  }
}
```

In Claude Code:

```bash
claude mcp add linkedin -s user -- npx -y -p @hoyasumii/linkedin linkedin-mcp
```

To use a token from elsewhere instead of the saved sign-in (a CI job, a second account), pass it in the
environment: `LINKEDIN_ACCESS_TOKEN`, plus `LINKEDIN_PERSON_URN` to skip the `userinfo` call. See
[Configuration](./configuration.md).

## Check it

Ask your agent _"Who am I on LinkedIn?"_: it calls `linkedin_whoami`. From the terminal,
`linkedin mcp status` shows the same.

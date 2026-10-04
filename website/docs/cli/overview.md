---
sidebar_position: 1
title: Overview
description: "The linkedin CLI: it signs you in and registers the MCP server; posting is the MCP server's job."
---

# CLI

The `linkedin` command does not post anything. Posting is the job of the [MCP server](../mcp/overview.md), or of
the [SDK](../sdk/overview.md) in your own code. The CLI does the setup:

```bash
linkedin mcp config --web    # save your LinkedIn app and sign in, in a local web page
linkedin mcp install         # register linkedin-mcp in Claude Code, Codex or OpenCode
linkedin mcp status          # who is signed in, and for how many more days
linkedin mcp logout          # forget the sign-in on this computer
linkedin mcp uninstall       # remove the server from your clients
linkedin docs                # open this site
```

Every command: [`linkedin mcp`](./mcp-commands.md). On Windows and from WSL: [Windows and WSL](./windows.md).

---
sidebar_position: 2
title: linkedin mcp
description: "config, status, logout, install and uninstall: every flag, and how the sign-in works."
---

# linkedin mcp

## linkedin mcp config

Saves your [LinkedIn app](../linkedin-app.md) and signs you in.

```bash
linkedin mcp config --web                 # everything in a local web page (recommended)
linkedin mcp config                       # asks for the Client ID and Secret here, then opens the sign-in
linkedin mcp config --client-id … --client-secret …   # no questions (scripts)
```

With `--web` it serves a page on `http://localhost:3769` that lists the app setup steps, with the redirect URL to
copy. You paste the Client ID and the Client Secret there, then press _Save and sign in with LinkedIn_. LinkedIn
asks you to allow the app and sends you back to `http://localhost:3769/callback`. The page then saves the sign-in
and says who you are and until when. The command waits up to 10 minutes.

| Flag                             | Effect                                                                     |
| -------------------------------- | -------------------------------------------------------------------------- |
| `--web`                          | Do it in the web page                                                      |
| `--client-id`, `--client-secret` | Save these without asking (the secret stays in your shell history)         |
| `--redirect-port <port>`         | Listen there instead of 3769 (`''` resets); the app must list the same URL |
| `--api-version <YYYYMM>`         | The `LinkedIn-Version` to send (`''` resets)                               |
| `--no-login`                     | Only save the settings                                                     |
| `--no-open`                      | Print the link instead of opening the browser                              |
| `--config <file>`                | Another `.env` (env `LINKEDIN_CONFIG`)                                     |

A blank secret keeps the saved one. Running it again later, when the 60-day token expires, takes a single click.

The page is guarded like the token it saves. Every URL of ours carries a random token, the `Host` header is
checked, and LinkedIn's redirect must carry a one-time `state` issued by that page.

## linkedin mcp status

Who is signed in, until when, the app's Client ID and the redirect URL. It exits `3` when nobody is signed in or
the sign-in expired.

## linkedin mcp logout

Deletes `credentials.json`. The app settings stay. To also revoke the app's access on LinkedIn's side, remove it at
[linkedin.com/psettings/permitted-services](https://www.linkedin.com/psettings/permitted-services).

## linkedin mcp install

Registers `linkedin-mcp` (stdio) in Claude Code, Codex and OpenCode, as `linkedin`. It needs a sign-in. Without
`--client` it shows a checklist of the clients found on the PATH.

| Flag                    | Effect                                                                   |
| ----------------------- | ------------------------------------------------------------------------ |
| `--client claude,codex` | Skip the checklist (`claude`, `codex`, `opencode`; `…@windows` from WSL) |
| `--force`               | With `--client`: replace an existing `linkedin` entry                    |
| `--dry-run`             | Print the commands instead of running them                               |
| `--config <file>`       | Register with another `.env` (passed as `LINKEDIN_CONFIG`)               |

Restart the client, or reconnect its MCP servers, to load it.

## linkedin mcp uninstall

Removes the `linkedin` entry from the clients picked (or `--client`), with `--dry-run` to preview. It runs
without a sign-in, so a client can be cleaned up afterwards. OpenCode has no `mcp remove`, so its config file
is edited in place, keeping its comments.

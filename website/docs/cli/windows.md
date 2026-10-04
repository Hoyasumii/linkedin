---
sidebar_position: 3
title: Windows and WSL
description: "Using the CLI on Windows 10/11 from PowerShell or cmd, and registering the server in Windows clients from WSL."
---

# Windows and WSL

The package runs on Windows 10/11 with Node.js 20 or later, from PowerShell or cmd.

- The settings, the sign-in and the post list live in `%APPDATA%\linkedin\`, protected by that folder's per-user
  permissions (file modes mean nothing on Windows).
- The client CLIs are run through `cross-spawn`, so Windows `.cmd` shims work.
- Files are written through a rename that retries, because antivirus and editors hold files open.

## From WSL

When the package is installed inside WSL, `linkedin mcp install` and `uninstall` also list the clients installed on
the Windows side, as `Claude Code (Windows)` and so on (`--client claude@windows`). They start the server with
`wsl.exe -d <distro> -e node …/dist/mcp/cli.js`, so it keeps reading the sign-in saved inside WSL. The first
call after WSL has been idle waits for the distro to start (a second or two).

The Windows side is reached through `powershell.exe`, taken from the PATH or, with `appendWindowsPath = false`,
from `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/`. When it cannot be reached, `--client claude@windows` says
which step failed.

`linkedin mcp config --web` inside WSL serves the page on `localhost:3769` inside WSL, which the Windows browser
reaches through WSL's localhost forwarding (on by default).

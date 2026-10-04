---
sidebar_position: 4
title: Configuration
description: "Where the app settings, the sign-in and the post list are saved, and the environment variables that override them."
---

# Configuration

`linkedin mcp config` saves three files in a per-user directory, each readable by you alone (mode `0600`; on
Windows, the folder's permissions):

| File               | Holds                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `.env`             | The app: `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, and optionally `LINKEDIN_REDIRECT_PORT` and `LINKEDIN_API_VERSION` |
| `credentials.json` | The sign-in: access token, expiry, person URN, name, scopes                                                                 |
| `posts.json`       | The [local list of posts](./tools.md#reading-your-posts)                                                                    |

The directory is `~/.config/linkedin` on Linux (`$XDG_CONFIG_HOME/linkedin`), `~/Library/Application
Support/linkedin` on macOS and `%APPDATA%\linkedin` on Windows. `LINKEDIN_CONFIG` points at another `.env`; the
other two files sit beside it.

## Environment

Read by `linkedin-mcp` at launch, over the saved values:

| Variable                                       | Effect                                                         |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `LINKEDIN_CONFIG`                              | Another `.env` (and so another sign-in and post list)          |
| `LINKEDIN_ACCESS_TOKEN`                        | Use this token instead of `credentials.json`; never saved      |
| `LINKEDIN_PERSON_URN`                          | With a token: the author, sparing the `userinfo` call          |
| `LINKEDIN_API_VERSION`                         | The `LinkedIn-Version` header, `YYYYMM` (default `202609`)     |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | The app, to refresh a token when LinkedIn gave a refresh token |

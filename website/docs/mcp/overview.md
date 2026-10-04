---
sidebar_position: 1
title: Overview
description: "The LinkedIn MCP server: six tools over stdio that post, edit and delete as you, and list what they posted."
---

# MCP server

`linkedin-mcp` is an MCP server that posts on **your** LinkedIn profile. An MCP client (Claude Code, Codex,
OpenCode, Claude Desktop…) launches it and speaks to it over stdio.

| Tool                   | What it does                                                                |
| ---------------------- | --------------------------------------------------------------------------- |
| `linkedin_whoami`      | Who is signed in, and when the sign-in expires                              |
| `linkedin_create_post` | Publishes a post: text, plus images, a video, a document or an article link |
| `linkedin_edit_post`   | Replaces a post's text                                                      |
| `linkedin_delete_post` | Deletes a post (needs `confirm: true`)                                      |
| `linkedin_list_posts`  | The posts made or edited through this server, newest first                  |
| `linkedin_get_post`    | One of those posts                                                          |

Details on each: [Tools](./tools.md).

The server holds no secret in the client's config: it reads the sign-in `linkedin mcp config` saved
(`credentials.json`) on every call, so signing in again takes effect without restarting the client.

To set it up: [Setup](./setup.md). To embed it in your own program: [Programmatic use](./programmatic.md).

---
sidebar_position: 3
title: Tools
description: "Every tool's inputs and answers, the confirmation before deleting, and why the server can only read the posts it made."
---

# Tools

## linkedin_create_post

Publishes a post on the signed-in member's profile, right away.

| Input             | Type                                        | Notes                                               |
| ----------------- | ------------------------------------------- | --------------------------------------------------- |
| `text`            | string                                      | Plain text; reserved characters are escaped for you |
| `visibility`      | `PUBLIC` \| `CONNECTIONS`                   | Default `PUBLIC`                                    |
| `images`          | `{ path, alt_text? }[]`                     | 1, or 2 to 20 for a gallery                         |
| `video`           | `{ path, title? }`                          | MP4                                                 |
| `document`        | `{ path, title? }`                          | PDF, PPT(X), DOC(X), shown as a carousel            |
| `article`         | `{ url, title?, description?, thumbnail? }` | A link card; `thumbnail` is a local image           |
| `reshare_of`      | string                                      | A post URN or URL to reshare                        |
| `disable_reshare` | boolean                                     |                                                     |
| `raw_text`        | boolean                                     | The text is already in little format (for mentions) |
| `hashtags`        | boolean                                     | Default `true`: `#word` stays a hashtag             |

One kind of media at most. Paths are local to the machine the server runs on. It answers the post's `urn`, `url`
and what was recorded in the local list. The server's instructions ask the agent to publish only what you asked
for, and to show you text it wrote before posting it.

## linkedin_edit_post

`post` (a URN or URL) and the new `text` (with `raw_text` and `hashtags` as above). Only the text changes: images,
video, documents and links cannot be swapped, so delete the post and post again for that.

## linkedin_delete_post

`post` and `confirm`. The server refuses unless `confirm` is `true`, and its description tells the agent to confirm
the post with you first. Deleting is permanent.

## linkedin_whoami

The member's name and person URN, when the sign-in expires and how many days are left.

## linkedin_list_posts and linkedin_get_post

`linkedin_list_posts` takes `query` (text to look for), `limit` (default 20) and `include_deleted`.
`linkedin_get_post` takes `post`. Both read the local list described below and never call LinkedIn.

## Reading your posts

LinkedIn lets any app **write** a member's posts (`w_member_social`), but reading them back needs
`r_member_social`, which LinkedIn has closed to new apps. Even fetching a single post by its URN needs it. Its
self-serve alternative, the Member Data Portability API, is open only to members in the EU/EEA and Switzerland.

So the server remembers what it does. `posts.json`, beside the saved configuration, holds every post it created,
edited or deleted: URN, URL, text as last written, visibility, media and dates. That is what `linkedin_list_posts`
and `linkedin_get_post` show.

- A post you made on linkedin.com is not in the list. To edit or delete it, give the agent its URN or URL
  (**⋯** → **Embed this post** shows the URN). Once edited here, it joins the list.
- An edit made on linkedin.com is not seen: the list keeps the last text written through the server.

## Errors

Tool errors come back as text the agent can act on:

- _Not signed in to LinkedIn …_ or _The LinkedIn sign-in expired …_: the sign-in is missing or expired, so run `linkedin mcp config --web`;
- _LinkedIn answered 403 (the token lacks a permission …)_: the app is missing a product, or the post is not yours;
- _LinkedIn answered 429_: the daily limit was reached;
- file and text problems (format, size, length) are refused before anything is sent.

---
sidebar_position: 2
title: Posts
description: "Create posts with text, images, a video, a document, an article or a reshare; edit their text; delete them. The little text format, escaped for you."
---

# Posts

## Create

```ts
const { urn, url } = await linkedin.createPost({
  text: "Shipped v1.0 (finally) #release",
  visibility: "PUBLIC", // or "CONNECTIONS": 1st-degree connections only
});
```

A post carries **one** kind of media at most:

```ts
await linkedin.createPost({ text: "One image", images: [{ file: "shot.png", altText: "The new dashboard" }] });
await linkedin.createPost({ text: "A gallery", images: ["a.jpg", "b.jpg", "c.png"] }); // 2 to 20
await linkedin.createPost({ text: "A video", video: { file: "demo.mp4", title: "Demo" } });
await linkedin.createPost({ text: "Slides", document: { file: "deck.pdf", title: "Our roadmap" } });
await linkedin.createPost({
  text: "Worth reading",
  article: { url: "https://example.com/post", title: "The post", description: "…", thumbnail: "cover.png" },
});
await linkedin.createPost({ text: "Agreed!", reshareOf: "https://www.linkedin.com/feed/update/urn:li:share:7…/" });
```

Media is given as a local path, or as `{ data: Uint8Array, filename, contentType }`. See [Media](./media.md) for the
formats and limits. `disableReshare: true` stops others from resharing the post.

LinkedIn does not fetch an article's page: the card shows only the `title`, `description` and `thumbnail` you set.
A bare URL in the text gets LinkedIn's usual link preview instead.

## The text

A post's text is in LinkedIn's _little_ format. Its reserved characters, `\ | { } @ [ ] ( ) < > # * _ ~`, must
be escaped even where they form nothing. An unescaped `(` can make LinkedIn cut the post short without any error.
The SDK escapes plain text for you:

- line breaks and emoji are kept;
- `#word` stays a hashtag (`hashtags: false` makes every `#` plain); a `#` that starts no word (`C#`) is escaped;
- the limit is 3,000 characters **after** escaping, checked before sending.

To mention someone, write the little format yourself and pass `rawText: true`:

```ts
await linkedin.createPost({ text: "Thanks @[Ada Lovelace](urn:li:person:Ab12Cd34)\\!", rawText: true });
```

`toLittle(text)` and `fromLittle(little)` convert by hand.

## Edit

```ts
await linkedin.editPost(urn, { text: "Shipped v1.0.1 (a hotfix)" });
```

Only the text can change: LinkedIn does not let a post's images, video, document or link be swapped. For that,
delete the post and post again. The post shows as edited.

## Delete

```ts
await linkedin.deletePost(urn); // or the post's URL
```

Deleting is permanent and takes the comments and reactions with it. Deleting a post again succeeds.

## Which posts

`editPost` and `deletePost` take a post URN (`urn:li:share:…` or `urn:li:ugcPost:…`) or a URL holding one, such as
`https://www.linkedin.com/feed/update/urn:li:share:…/`. The link from _Copy link to post_ names the feed
_activity_ (`…-activity-7…`), which the API does not accept. On linkedin.com, open the post's **⋯** menu →
**Embed this post** instead: the embed code holds the post's URN. `parsePostRef` accepts every form and explains
the activity case.

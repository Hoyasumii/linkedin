---
sidebar_position: 3
title: Media
description: "Image, video and document uploads: formats, sizes, the multi-part video upload and processing."
---

# Media

`createPost` uploads the files it is given. The upload methods are also exposed on their own:

```ts
const image = await linkedin.uploadImage("shot.png"); // urn:li:image:…
const video = await linkedin.uploadVideo("demo.mp4"); // urn:li:video:…, once processed
const document = await linkedin.uploadDocument("deck.pdf"); // urn:li:document:…, once processed
```

| Kind     | Formats                          | Size                           | Notes                               |
| -------- | -------------------------------- | ------------------------------ | ----------------------------------- |
| Image    | JPG, PNG, GIF (up to 250 frames) | under 36,152,320 pixels        | 1 per post, or 2 to 20 as a gallery |
| Video    | MP4                              | 75 KB to 500 MB, 3 s to 30 min | uploaded in 4 MB parts              |
| Document | PDF, PPT, PPTX, DOC, DOCX        | up to 100 MB and 300 pages     | shown as a swipeable carousel       |

The extension and the size are checked before anything is sent (`checkMedia`, `MEDIA_RULES`).

Each upload asks LinkedIn for an upload URL (`initializeUpload`), then PUTs the bytes there. A video is uploaded
in the parts LinkedIn lists, and finalized with each part's `ETag`. Videos and documents are then processed by
LinkedIn. The SDK polls their status until they are `AVAILABLE`, every 2 seconds for up to 10 minutes
(`poll: { intervalMs, timeoutMs }`). A token with only `w_member_social` may be refused that status read. The
post is then retried while LinkedIn says the media is still processing. A failed processing throws
`LinkedInMediaError` with LinkedIn's reason.

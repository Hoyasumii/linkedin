---
sidebar_position: 4
title: Errors
description: "The errors the SDK throws, with LinkedIn's status and codes, and the token always masked."
---

# Errors

| Class                  | When                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| `LinkedInApiError`     | LinkedIn answered a non-2xx status: `status`, `code` (`ACCESS_DENIED`…), `serviceErrorCode`, `message`, `body` |
| `LinkedInAuthError`    | No token, an expired one, or a 401: sign in again with `linkedin mcp config --web`                             |
| `LinkedInConfigError`  | Input refused before sending: a bad file, text too long, two kinds of media, a bad URN                         |
| `LinkedInMediaError`   | LinkedIn could not process a video or document, or did not finish in time                                      |
| `LinkedInTimeoutError` | No answer within `timeoutMs`                                                                                   |

```ts
import { LinkedInApiError, LinkedInAuthError } from "@hoyasumii/linkedin";

try {
  await linkedin.deletePost(urn);
} catch (error) {
  if (error instanceof LinkedInAuthError) console.error("Sign in again: linkedin mcp config --web");
  else if (error instanceof LinkedInApiError && error.status === 404) console.error("No such post");
  else throw error;
}
```

The common statuses:

- **403**: the token lacks a permission (the app is missing a product), or the post is not yours;
- **404**: the post does not exist, or was deleted;
- **429**: the daily limit (150 posts per member) was reached;
- **426** or a version message: the `LinkedIn-Version` was retired, so set a newer `apiVersion`.

`redact(value, secrets)` masks secrets in anything you log. Every error the SDK builds is already masked.

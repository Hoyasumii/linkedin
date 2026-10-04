import { LinkedInConfigError } from "./errors";

/** A post's URN: what the API creates, edits and deletes. */
const POST_URN = /urn:li:(share|ugcPost):\d+/;
const ACTIVITY_URN = /urn(?::|%3A)li(?::|%3A)activity(?::|%3A)\d+|-activity-\d+/i;

/**
 * The post URN in a URN or a LinkedIn URL (`/feed/update/urn:li:share:…`, an embed link).
 *
 * The "Copy link to post" URL names the *activity* (`…-activity-<id>-…`), which the API does not
 * accept and cannot be turned into the post URN without read access: the post's "Embed this post"
 * code carries the `urn:li:share:` or `urn:li:ugcPost:` URN instead.
 */
export function parsePostRef(ref: string): string {
  const text = ref.trim();
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    // Not percent-encoded: matched as is.
  }
  const match = POST_URN.exec(decoded);
  if (match) return match[0];
  if (ACTIVITY_URN.test(text)) {
    throw new LinkedInConfigError(
      `'${text}' names a feed activity, not a post: the API needs the post's urn:li:share:… or urn:li:ugcPost:… URN. ` +
        "On LinkedIn, open the post's ⋯ menu → Embed this post, and copy the URN from the embed code."
    );
  }
  throw new LinkedInConfigError(
    `'${text}' is not a LinkedIn post URN (urn:li:share:… or urn:li:ugcPost:…) or a URL with one`
  );
}

/** The post's page on LinkedIn. */
export function postUrl(urn: string): string {
  return `https://www.linkedin.com/feed/update/${urn}/`;
}

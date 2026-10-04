/**
 * LinkedIn's "little" text format, which a post's `commentary` is written in. Its reserved
 * characters must be escaped with `\` even where they form no element: an unescaped `(` or `[` can
 * make LinkedIn cut the post short without an error.
 */

/** Every character `little` reserves. */
const RESERVED = /[\\|{}@[\]()<>#*_~]/g;

/** The longest commentary LinkedIn accepts. */
export const MAX_COMMENTARY_LENGTH = 3000;

export interface LittleOptions {
  /**
   * Keep `#word` as a hashtag (the default). With `false` every `#` is plain text. A `#` that does
   * not start a word (`C#`, `# 1`) is always escaped.
   */
  hashtags?: boolean;
}

/** A hashtag: `#` at the start or after a non-word character, followed by letters and digits. */
const HASHTAG = /(^|[^\p{L}\p{N}_])#([\p{L}\p{N}]+)/gu;

/**
 * Plain text as `little`: every reserved character escaped, hashtags kept as hashtags unless
 * `hashtags: false`. A hashtag ends at the first character that is not a letter or a digit.
 */
export function toLittle(text: string, options: LittleOptions = {}): string {
  const escape = (part: string): string => part.replace(RESERVED, "\\$&");
  if (options.hashtags === false) return escape(text);
  let out = "";
  let last = 0;
  for (const match of text.matchAll(HASHTAG)) {
    const start = (match.index ?? 0) + match[1].length;
    out += `${escape(text.slice(last, start))}#${match[2]}`;
    last = start + 1 + match[2].length;
  }
  return out + escape(text.slice(last));
}

/** `little` back to the text a reader sees: escapes removed, hashtag templates and mentions resolved. */
export function fromLittle(little: string): string {
  return little
    .replace(/\{hashtag\|\\?[#＃]\|([^}]*)\}/g, "#$1")
    .replace(/@\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\\([\\|{}@[\]()<>#*_~])/g, "$1");
}

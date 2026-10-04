import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PostRegistry } from "../../src";

let dir: string;
let clock: number;
let registry: PostRegistry;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "linkedin-registry-"));
  clock = Date.parse("2026-10-04T12:00:00Z");
  registry = new PostRegistry(path.join(dir, "posts.json"), () => new Date((clock += 1000)));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const base = { author: "urn:li:person:A", visibility: "PUBLIC" };

it("lists the posts newest first, skipping deleted ones unless asked", () => {
  registry.added({ ...base, urn: "urn:li:share:1", text: "first" });
  registry.added({ ...base, urn: "urn:li:share:2", text: "second" });
  registry.added({ ...base, urn: "urn:li:share:3", text: "third" });
  registry.deleted("urn:li:share:2");
  expect(registry.list().map((post) => post.urn)).toEqual(["urn:li:share:3", "urn:li:share:1"]);
  expect(registry.list({ includeDeleted: true }).map((post) => post.urn)).toEqual([
    "urn:li:share:2",
    "urn:li:share:3",
    "urn:li:share:1",
  ]);
  expect(registry.list({ limit: 1 })).toHaveLength(1);
  expect(registry.list({ query: "FIR" }).map((post) => post.text)).toEqual(["first"]);
});

it("records edits, and adds a post first seen when edited", () => {
  registry.added({ ...base, urn: "urn:li:share:1", text: "first" });
  expect(registry.edited("urn:li:share:1", { text: "fixed", author: base.author })).toMatchObject({
    text: "fixed",
    createdHere: true,
    updatedAt: expect.any(String),
  });
  expect(registry.edited("urn:li:share:9", { text: "other", author: base.author })).toMatchObject({
    urn: "urn:li:share:9",
    url: "https://www.linkedin.com/feed/update/urn:li:share:9/",
    createdHere: false,
    visibility: "UNKNOWN",
  });
  expect(registry.list().map((post) => post.urn)).toEqual(["urn:li:share:9", "urn:li:share:1"]);
});

it("answers undefined for deleting a post never seen, and survives a missing or broken file", () => {
  expect(registry.deleted("urn:li:share:1")).toBeUndefined();
  expect(registry.list()).toEqual([]);
  fs.writeFileSync(registry.file, "not json");
  expect(registry.list()).toEqual([]);
});

it("writes the file readable by the owner only", () => {
  registry.added({ ...base, urn: "urn:li:share:1", text: "first" });
  if (process.platform !== "win32") expect(fs.statSync(registry.file).mode & 0o777).toBe(0o600);
});

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { RENAME_ATTEMPTS, renameWithRetry } from "../../../src/fs-util";

/** A rename that throws the given codes in order, then succeeds. */
function failing(codes: string[]) {
  const calls: string[] = [];
  const rename = (from: string, to: string): void => {
    calls.push(`${from}->${to}`);
    const code = codes.shift();
    if (code) throw Object.assign(new Error(`${code}: resource busy`), { code });
  };
  return { calls, rename };
}

describe("renameWithRetry", () => {
  it("retries a locked target on win32 with growing waits, then succeeds", () => {
    const fake = failing(["EBUSY", "EPERM"]);
    const waits: number[] = [];
    renameWithRetry("a.tmp", "a", { platform: "win32", rename: fake.rename, sleep: (ms) => waits.push(ms) });
    expect(fake.calls).toHaveLength(3);
    expect(waits).toEqual([50, 100]);
  });

  it("gives up after RENAME_ATTEMPTS and names the target", () => {
    const fake = failing(Array(10).fill("EACCES"));
    expect(() =>
      renameWithRetry("a.tmp", "C:\\cfg\\.env", { platform: "win32", rename: fake.rename, sleep: () => undefined })
    ).toThrow("C:\\cfg\\.env");
    expect(fake.calls).toHaveLength(RENAME_ATTEMPTS);
  });

  it("never retries off Windows, nor an error that waiting cannot fix", () => {
    const linux = failing(["EBUSY"]);
    expect(() => renameWithRetry("a.tmp", "a", { platform: "linux", rename: linux.rename })).toThrow("EBUSY");
    expect(linux.calls).toHaveLength(1);
    const missing = failing(["ENOENT"]);
    expect(() =>
      renameWithRetry("a.tmp", "a", { platform: "win32", rename: missing.rename, sleep: () => undefined })
    ).toThrow("ENOENT");
    expect(missing.calls).toHaveLength(1);
  });

  it("replaces a real file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plane-rename-"));
    try {
      fs.writeFileSync(path.join(dir, "x.tmp"), "new");
      fs.writeFileSync(path.join(dir, "x"), "old");
      renameWithRetry(path.join(dir, "x.tmp"), path.join(dir, "x"));
      expect(fs.readFileSync(path.join(dir, "x"), "utf8")).toBe("new");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

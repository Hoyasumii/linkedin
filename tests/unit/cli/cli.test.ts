import { McpDeps } from "../../../src/cli/mcp/deps";
import { runCli } from "../../../src/cli/run";
import { SERVER_VERSION } from "../../../src/mcp";

async function cli(argv: string[], deps: Partial<McpDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(
    argv,
    { stdout: (text) => out.push(text), stderr: (text) => err.push(text), env: { HOME: "/nonexistent" } },
    deps
  );
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

describe("linkedin CLI", () => {
  it("prints its usage, listing mcp and docs only: it posts nothing itself", async () => {
    for (const argv of [[], ["--help"]]) {
      const result = await cli(argv);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/`mcp`\s+Sign in/);
      expect(result.stdout).toMatch(/`docs`\s+Open the documentation/);
      expect(result.stdout).not.toMatch(/[ \t]$/m);
    }
  });

  it("prints its version", async () => {
    expect(await cli(["--version"])).toEqual({ code: 0, stdout: SERVER_VERSION, stderr: "" });
  });

  it("refuses an unknown command with the usage", async () => {
    const result = await cli(["post"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unknown command post");
  });

  it("opens the documentation site with `linkedin docs`", async () => {
    const opened: string[] = [];
    const result = await cli(["docs"], { openBrowser: async (url) => void opened.push(url) });
    expect(result).toEqual({ code: 0, stdout: "https://hoyasumii.github.io/linkedin/", stderr: "" });
    expect(opened).toEqual(["https://hoyasumii.github.io/linkedin/"]);
  });

  it("still prints the link when `linkedin docs` cannot open a browser", async () => {
    const result = await cli(["docs"], { openBrowser: () => Promise.reject(new Error("no browser")) });
    expect(result).toEqual({
      code: 0,
      stdout: "https://hoyasumii.github.io/linkedin/",
      stderr: "Could not open a browser; open the link above.",
    });
  });

  it("describes `linkedin docs` without opening anything on --help", async () => {
    const opened: string[] = [];
    const result = await cli(["docs", "--help"], { openBrowser: async (url) => void opened.push(url) });
    expect(result.code).toBe(0);
    expect(opened).toEqual([]);
  });
});

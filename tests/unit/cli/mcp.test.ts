import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { readCredentials, writeCredentials } from "../../../src/auth/credentials";
import { formPage, signedInPage } from "../../../src/cli/mcp/config-page";
import { describeAuthorizationError } from "../../../src/cli/mcp/config-ui";
import { ExecResult, McpDeps } from "../../../src/cli/mcp/deps";
import { runCli } from "../../../src/cli/run";
import { readEnvFile, writeEnvFile } from "../../../src/mcp/config";
import { CLIENT_ID, CLIENT_SECRET, FakeLinkedIn, GOOD_CODE, PERSON_URN } from "../fake-server";

let home: string;
let configFile: string;
let credentialsFile: string;
let linkedin: FakeLinkedIn;
let port: number;

/** A port nothing listens on, for the login server. */
async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port: free } = server.address() as net.AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return free;
}

beforeEach(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "linkedin-mcp-cli-"));
  configFile = path.join(home, ".config", "linkedin", ".env");
  credentialsFile = path.join(home, ".config", "linkedin", "credentials.json");
  linkedin = await FakeLinkedIn.start();
  port = await freePort();
});
afterEach(async () => {
  await linkedin.stop();
  fs.rmSync(home, { recursive: true, force: true });
});

function fakeDeps(overrides: Partial<McpDeps> = {}): Partial<McpDeps> {
  return {
    platform: "linux",
    nodePath: "/usr/bin/node",
    cliEntry: "/opt/linkedin/dist/cli/index.js",
    exec: async (): Promise<ExecResult> => ({ code: 0, stdout: "", stderr: "" }),
    openBrowser: async () => undefined,
    isWsl: () => false,
    ...overrides,
  };
}

async function cli(argv: string[], deps: Partial<McpDeps> = fakeDeps(), timeoutMs = 30_000) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(
    argv,
    { stdout: (text) => out.push(text), stderr: (text) => err.push(text), env: { HOME: home } },
    deps,
    { tokenUrl: linkedin.tokenUrl, apiBaseUrl: linkedin.url, authorizeUrl: `${linkedin.url}/authorize`, timeoutMs }
  );
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

function signedIn(expiresAt = "2099-01-01T00:00:00.000Z"): void {
  writeCredentials(credentialsFile, {
    accessToken: "token-0123456789",
    expiresAt,
    scopes: ["openid", "profile", "w_member_social"],
    personUrn: PERSON_URN,
    name: "Ada Lovelace",
    savedAt: "2026-10-04T00:00:00.000Z",
  });
}

/** Runs `argv`, answering the URL it opens with `browse`, and answers both. */
async function withBrowser(argv: string[], browse: (url: string) => Promise<void>, deps: Partial<McpDeps> = {}) {
  let browsing: Promise<void> = Promise.resolve();
  const result = await cli(
    argv,
    fakeDeps({
      openBrowser: async (url) => {
        browsing = browse(url);
      },
      ...deps,
    })
  );
  await browsing;
  return result;
}

/** Follows `/login` to the (fake) authorization page and comes back to `/callback` with `query`. */
async function authorize(loginUrl: string, query: (state: string) => string): Promise<Response> {
  const login = await fetch(loginUrl, { redirect: "manual" });
  expect(login.status).toBe(302);
  const authorizeUrl = new URL(login.headers.get("location") ?? "");
  expect(authorizeUrl.origin + authorizeUrl.pathname).toBe(`${linkedin.url}/authorize`);
  expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(`http://localhost:${port}/callback`);
  expect(authorizeUrl.searchParams.get("scope")).toBe("openid profile w_member_social");
  const state = authorizeUrl.searchParams.get("state") ?? "";
  return fetch(`http://localhost:${port}/callback?${query(state)}`);
}

describe("linkedin mcp", () => {
  it("prints its usage", async () => {
    const result = await cli(["mcp"]);
    expect(result.code).toBe(0);
    for (const command of ["config", "status", "logout", "install", "uninstall"])
      expect(result.stdout).toContain(command);
    expect(result.stdout).not.toMatch(/\bstart\b|\bboot\b/);
  });
});

describe("linkedin mcp config --web", () => {
  it("saves the app, signs in through LinkedIn and saves the credentials", async () => {
    writeEnvFile(configFile, { LINKEDIN_REDIRECT_PORT: String(port) });
    const result = await withBrowser(["mcp", "config", "--web"], async (url) => {
      expect(url).toMatch(new RegExp(`^http://localhost:${port}/\\?t=[0-9a-f]{48}$`));
      const token = new URL(url).searchParams.get("t") ?? "";
      const html = await (await fetch(url)).text();
      expect(html).toContain(`http://localhost:${port}/callback`);
      expect(html).toContain("Share on LinkedIn");
      expect(html).toContain("Not signed in yet.");

      expect((await fetch(`http://localhost:${port}/`)).status).toBe(403);
      const wrong = await fetch(`http://localhost:${port}/save`, {
        method: "POST",
        body: new URLSearchParams({ t: "nope", LINKEDIN_CLIENT_ID: "x" }),
      });
      expect(wrong.status).toBe(403);

      const missing = await fetch(`http://localhost:${port}/save`, {
        method: "POST",
        body: new URLSearchParams({ t: token, LINKEDIN_CLIENT_ID: CLIENT_ID }),
      });
      expect(missing.status).toBe(400);
      expect(await missing.text()).toContain("The Client Secret is required.");

      const saved = await fetch(`http://localhost:${port}/save`, {
        method: "POST",
        body: new URLSearchParams({ t: token, LINKEDIN_CLIENT_ID: CLIENT_ID, LINKEDIN_CLIENT_SECRET: CLIENT_SECRET }),
        redirect: "manual",
      });
      expect(saved.status).toBe(303);
      expect(saved.headers.get("location")).toBe(`/login?t=${token}`);
      expect(readEnvFile(configFile)).toEqual({
        LINKEDIN_CLIENT_ID: CLIENT_ID,
        LINKEDIN_CLIENT_SECRET: CLIENT_SECRET,
        LINKEDIN_REDIRECT_PORT: String(port),
      });

      const done = await authorize(
        `http://localhost:${port}/login?t=${token}`,
        (state) => `code=${GOOD_CODE}&state=${state}`
      );
      expect(done.status).toBe(200);
      expect(await done.text()).toContain("Signed in as Ada Lovelace");
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Signed in as Ada Lovelace (urn:li:person:Ab12Cd34)");
    expect(readCredentials(credentialsFile)).toMatchObject({
      personUrn: PERSON_URN,
      scopes: ["openid", "profile", "w_member_social"],
    });
    if (process.platform !== "win32") expect(fs.statSync(credentialsFile).mode & 0o777).toBe(0o600);
  });

  it("refuses a callback with a state it did not issue, and explains LinkedIn's errors", async () => {
    writeEnvFile(configFile, {
      LINKEDIN_CLIENT_ID: CLIENT_ID,
      LINKEDIN_CLIENT_SECRET: CLIENT_SECRET,
      LINKEDIN_REDIRECT_PORT: String(port),
    });
    const result = await withBrowser(["mcp", "config", "--web"], async (url) => {
      const token = new URL(url).searchParams.get("t") ?? "";
      const forged = await fetch(`http://localhost:${port}/callback?code=${GOOD_CODE}&state=forged`);
      expect(forged.status).toBe(400);
      expect(await forged.text()).toContain("stale or was not started here");

      const refused = await authorize(
        `http://localhost:${port}/login?t=${token}`,
        (state) => `error=unauthorized_scope_error&state=${state}`
      );
      expect(await refused.text()).toContain("add both &#39;Share on LinkedIn&#39;");

      const badCode = await authorize(
        `http://localhost:${port}/login?t=${token}`,
        (state) => `code=bad&state=${state}`
      );
      expect(await badCode.text()).toContain("LinkedIn refused the code");

      const ok = await authorize(
        `http://localhost:${port}/login?t=${token}`,
        (state) => `code=${GOOD_CODE}&state=${state}`
      );
      expect(ok.status).toBe(200);
    });
    expect(result.code).toBe(0);
  });

  it("refuses a sign-in without w_member_social", async () => {
    linkedin.grantedScope = "openid,profile";
    writeEnvFile(configFile, {
      LINKEDIN_CLIENT_ID: CLIENT_ID,
      LINKEDIN_CLIENT_SECRET: CLIENT_SECRET,
      LINKEDIN_REDIRECT_PORT: String(port),
    });
    await cli(
      ["mcp", "config", "--web"],
      fakeDeps({
        openBrowser: async (url) => {
          const token = new URL(url).searchParams.get("t") ?? "";
          const page = await authorize(
            `http://localhost:${port}/login?t=${token}`,
            (state) => `code=${GOOD_CODE}&state=${state}`
          );
          expect(await page.text()).toContain("without the w_member_social permission");
          linkedin.grantedScope = "openid,profile,w_member_social";
          await authorize(`http://localhost:${port}/login?t=${token}`, (state) => `code=${GOOD_CODE}&state=${state}`);
        },
      })
    );
    expect(readCredentials(credentialsFile)?.scopes).toContain("w_member_social");
  });

  it("gives up after the timeout", async () => {
    writeEnvFile(configFile, { LINKEDIN_REDIRECT_PORT: String(port) });
    const result = await cli(["mcp", "config", "--web", "--no-open"], fakeDeps(), 50);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Nobody signed in within");
  });

  it("says which port is busy", async () => {
    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen(port, "127.0.0.1", resolve));
    writeEnvFile(configFile, { LINKEDIN_REDIRECT_PORT: String(port) });
    const result = await cli(["mcp", "config", "--web", "--no-open"]);
    await new Promise((resolve) => blocker.close(resolve));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`Port ${port} is in use`);
  });

  it("takes only --redirect-port besides --web", async () => {
    const result = await cli(["mcp", "config", "--web", "--client-id", "x"]);
    expect(result).toMatchObject({
      code: 1,
      stderr: expect.stringContaining("--web takes no values but --redirect-port"),
    });
  });
});

describe("linkedin mcp config (terminal)", () => {
  /** A fake raw-mode terminal; each entry answers one prompt, in order. */
  function terminal(answers: string[]) {
    const input = Object.assign(new PassThrough(), {
      isRaw: false,
      setRawMode(mode: boolean) {
        this.isRaw = mode;
      },
    });
    const output = new PassThrough();
    let written = "";
    output.on("data", (chunk: Buffer) => (written += chunk.toString()));
    for (const answer of answers) input.write(answer);
    // oxlint-disable-next-line no-control-regex -- strips the prompts' ANSI codes
    return { input, output, text: () => written.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "") };
  }

  it("asks for the app, then signs in through the browser", async () => {
    writeEnvFile(configFile, { LINKEDIN_REDIRECT_PORT: String(port) });
    const term = terminal(["\r", `${CLIENT_ID}\r`, `${CLIENT_SECRET}\r`]);
    const result = await withBrowser(
      ["mcp", "config"],
      async (url) => {
        expect(url).toMatch(new RegExp(`^http://localhost:${port}/login\\?t=`));
        await authorize(url, (state) => `code=${GOOD_CODE}&state=${state}`);
      },
      { terminal: term }
    );
    expect(result.code).toBe(0);
    expect(term.text()).toContain("The Client ID is required.");
    expect(term.text()).not.toContain(CLIENT_SECRET);
    expect(result.stdout).toContain(`Saved ${configFile}.`);
    expect(readCredentials(credentialsFile)?.personUrn).toBe(PERSON_URN);
  });

  it("saves flags without asking and keeps the saved secret; --no-login only saves", async () => {
    writeEnvFile(configFile, { LINKEDIN_CLIENT_ID: "old", LINKEDIN_CLIENT_SECRET: CLIENT_SECRET });
    const result = await cli(["mcp", "config", "--client-id", CLIENT_ID, "--api-version", "202601", "--no-login"]);
    expect(result.code).toBe(0);
    expect(readEnvFile(configFile)).toEqual({
      LINKEDIN_CLIENT_ID: CLIENT_ID,
      LINKEDIN_CLIENT_SECRET: CLIENT_SECRET,
      LINKEDIN_API_VERSION: "202601",
    });
  });

  it("refuses values it cannot save", async () => {
    for (const [argv, message] of [
      [["--client-id", CLIENT_ID], "The Client Secret is required."],
      [["--client-id", "a b", "--client-secret", "s"], "The Client ID has only"],
      [["--client-id", "a", "--client-secret", "s", "--api-version", "2026"], "YYYYMM"],
      [["--client-id", "a", "--client-secret", "s", "--redirect-port", "0"], "from 1 to 65535"],
    ] as const) {
      const result = await cli(["mcp", "config", ...argv, "--no-login"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(message);
    }
    expect(fs.existsSync(configFile)).toBe(false);
  });

  it("saves nothing when a prompt is cancelled", async () => {
    const result = await cli(["mcp", "config"], fakeDeps({ terminal: terminal(["\x03"]) }));
    expect(result.code).toBe(130);
    expect(fs.existsSync(configFile)).toBe(false);
  });

  it("refuses to ask without an interactive terminal", async () => {
    const result = await cli(["mcp", "config"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("No interactive terminal to ask in: use --web");
  });
});

describe("linkedin mcp status and logout", () => {
  it("reports who is signed in, and exits 3 when nobody is or the sign-in expired", async () => {
    const nobody = await cli(["mcp", "status"]);
    expect(nobody.code).toBe(3);
    expect(nobody.stdout).toContain("Not signed in yet.");

    writeEnvFile(configFile, { LINKEDIN_CLIENT_ID: CLIENT_ID, LINKEDIN_CLIENT_SECRET: CLIENT_SECRET });
    signedIn();
    const ok = await cli(["mcp", "status"]);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain("Signed in as Ada Lovelace");
    expect(ok.stdout).toContain(`Client ID ${CLIENT_ID}`);
    expect(ok.stdout).toContain("http://localhost:3769/callback");
    expect(ok.stdout).not.toContain(CLIENT_SECRET);

    signedIn("2020-01-01T00:00:00.000Z");
    const expired = await cli(["mcp", "status"]);
    expect(expired.code).toBe(3);
    expect(expired.stdout).toContain("expired on 2020-01-01");
  });

  it("logs out by removing the credentials only", async () => {
    writeEnvFile(configFile, { LINKEDIN_CLIENT_ID: CLIENT_ID, LINKEDIN_CLIENT_SECRET: CLIENT_SECRET });
    signedIn();
    expect((await cli(["mcp", "logout"])).stdout).toContain("Signed out");
    expect(fs.existsSync(credentialsFile)).toBe(false);
    expect(readEnvFile(configFile).LINKEDIN_CLIENT_ID).toBe(CLIENT_ID);
    expect((await cli(["mcp", "logout"])).stdout).toContain("Nobody was signed in.");
  });
});

describe("linkedin mcp install", () => {
  it("refuses before a sign-in", async () => {
    const result = await cli(["mcp", "install", "--client", "claude"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Not signed in to LinkedIn");
  });
});

describe("config pages", () => {
  const page = (saved: Record<string, string>) =>
    formPage({
      token: "tok",
      values: saved,
      saved,
      configFile: "/tmp/linkedin/.env",
      redirectUri: "http://localhost:3769/callback",
    });
  const input = (html: string, name: string): string => new RegExp(`<input name="${name}"[^>]*>`).exec(html)?.[0] ?? "";

  it("never echoes the secret; a saved one is kept and no longer required", () => {
    expect(input(page({}), "LINKEDIN_CLIENT_SECRET")).toMatch(/\srequired/);
    const withSecret = page({ LINKEDIN_CLIENT_ID: "abc", LINKEDIN_CLIENT_SECRET: "s3cret-value" });
    expect(withSecret).not.toContain("s3cret-value");
    expect(input(withSecret, "LINKEDIN_CLIENT_SECRET")).toContain("saved — blank keeps it");
    expect(input(withSecret, "LINKEDIN_CLIENT_SECRET")).not.toMatch(/\srequired/);
    expect(input(withSecret, "LINKEDIN_CLIENT_ID")).toContain('value="abc"');
  });

  it("follows the system color scheme and escapes what it shows", () => {
    const html = signedInPage({
      accessToken: "t",
      expiresAt: "2099-01-01T00:00:00.000Z",
      scopes: [],
      personUrn: "urn:li:person:x",
      name: "<script>",
      savedAt: "",
    });
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("t</");
  });

  it("explains LinkedIn's authorization errors", () => {
    expect(describeAuthorizationError("user_cancelled_login", null)).toBe("The sign-in was cancelled on LinkedIn.");
    expect(describeAuthorizationError("redirect_uri_mismatch", "x")).toMatch(/redirect URL \(x\)/);
    expect(describeAuthorizationError("weird", null)).toBe("LinkedIn answered 'weird'.");
  });
});

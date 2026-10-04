import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeCredentials } from "../../../src/auth/credentials";
import {
  configDir,
  configFilePath,
  connectionFor,
  parseEnv,
  readEnvFile,
  redirectUri,
  resolveMcpConfig,
  writeEnvFile,
} from "../../../src/mcp/config";
import { CLIENT_ID, CLIENT_SECRET, FakeLinkedIn, PERSON_URN } from "../fake-server";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "linkedin-config-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("config locations", () => {
  it("uses the per-user config directory of each platform, with its separators", () => {
    expect(configDir({ HOME: "/home/ada" }, "linux")).toBe("/home/ada/.config/linkedin");
    expect(configDir({ HOME: "/home/ada", XDG_CONFIG_HOME: "/xdg" }, "linux")).toBe("/xdg/linkedin");
    expect(configDir({ HOME: "/Users/ada" }, "darwin")).toBe("/Users/ada/Library/Application Support/linkedin");
    expect(configDir({ APPDATA: "C:\\Users\\ada\\AppData\\Roaming" }, "win32")).toBe(
      "C:\\Users\\ada\\AppData\\Roaming\\linkedin"
    );
    expect(configDir({ USERPROFILE: "C:\\Users\\ada" }, "win32")).toBe("C:\\Users\\ada\\AppData\\Roaming\\linkedin");
  });

  it("puts the .env in it unless LINKEDIN_CONFIG says otherwise", () => {
    expect(configFilePath({ HOME: "/home/ada" }, "linux")).toBe("/home/ada/.config/linkedin/.env");
    expect(configFilePath({ APPDATA: "C:\\AppData" }, "win32")).toBe("C:\\AppData\\linkedin\\.env");
    expect(configFilePath({ HOME: "/home/ada", LINKEDIN_CONFIG: "/etc/x.env" }, "linux")).toBe(
      path.resolve("/etc/x.env")
    );
  });
});

describe(".env files", () => {
  it("parses comments, export, quotes, inline comments and CRLF", () => {
    expect(
      parseEnv(
        [
          "# comment",
          "",
          "export LINKEDIN_CLIENT_ID=abc",
          'LINKEDIN_CLIENT_SECRET="s3cr=t" ',
          "OTHER='kept # not a comment'",
          "LINKEDIN_REDIRECT_PORT=4000 # inline",
          "not a line",
        ].join("\r\n")
      )
    ).toEqual({
      LINKEDIN_CLIENT_ID: "abc",
      LINKEDIN_CLIENT_SECRET: "s3cr=t",
      OTHER: "kept # not a comment",
      LINKEDIN_REDIRECT_PORT: "4000",
    });
  });

  it("reads a missing file as empty and keeps only the known, non-empty keys", () => {
    const file = path.join(dir, ".env");
    expect(readEnvFile(file)).toEqual({});
    fs.writeFileSync(file, "LINKEDIN_CLIENT_ID=k\nLINKEDIN_CLIENT_SECRET=\nOTHER=1\n");
    expect(readEnvFile(file)).toEqual({ LINKEDIN_CLIENT_ID: "k" });
  });

  it("writes an owner-only file that reads back the same, with no temp file left", () => {
    const file = path.join(dir, "nested", ".env");
    const values = {
      LINKEDIN_CLIENT_ID: "abc",
      LINKEDIN_CLIENT_SECRET: 'a"b\\c d',
      LINKEDIN_REDIRECT_PORT: "4000",
    };
    writeEnvFile(file, values);
    expect(readEnvFile(file)).toEqual(values);
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(path.dirname(file))).toEqual([".env"]);
  });
});

describe("resolveMcpConfig", () => {
  const configFile = "/x/.env";
  const file = { LINKEDIN_CLIENT_ID: "file-id", LINKEDIN_CLIENT_SECRET: "file-secret", LINKEDIN_REDIRECT_PORT: "1111" };

  it("takes environment over file over default", () => {
    expect(resolveMcpConfig({ configFile })).toEqual({
      clientId: "",
      clientSecret: "",
      redirectPort: 3769,
      apiVersion: "202609",
      configFile,
    });
    expect(resolveMcpConfig({ configFile, file })).toMatchObject({ clientId: "file-id", redirectPort: 1111 });
    expect(
      resolveMcpConfig({
        configFile,
        file,
        env: { LINKEDIN_CLIENT_ID: "env-id", LINKEDIN_REDIRECT_PORT: "", LINKEDIN_API_VERSION: "202601" },
      })
    ).toMatchObject({ clientId: "env-id", clientSecret: "file-secret", redirectPort: 1111, apiVersion: "202601" });
  });

  it("takes an access token from the environment only", () => {
    expect(
      resolveMcpConfig({ configFile, env: { LINKEDIN_ACCESS_TOKEN: " t ", LINKEDIN_PERSON_URN: "urn:li:person:x" } })
    ).toMatchObject({ accessToken: "t", personUrn: "urn:li:person:x" });
  });

  it("refuses a bad port or API version", () => {
    expect(() => resolveMcpConfig({ configFile, env: { LINKEDIN_REDIRECT_PORT: "70000" } })).toThrow(
      "LINKEDIN_REDIRECT_PORT must be an integer"
    );
    expect(() => resolveMcpConfig({ configFile, env: { LINKEDIN_REDIRECT_PORT: "0" } })).toThrow("from 1 to 65535");
    expect(() => resolveMcpConfig({ configFile, env: { LINKEDIN_API_VERSION: "2026-09" } })).toThrow("YYYYMM");
  });

  it("names the redirect URL the app must list", () => {
    expect(redirectUri(3769)).toBe("http://localhost:3769/callback");
  });
});

describe("connectionFor", () => {
  let server: FakeLinkedIn | undefined;
  afterEach(async () => server?.stop());

  it("posts with the saved sign-in, and keeps the registry beside the .env", async () => {
    server = await FakeLinkedIn.start();
    const configFile = path.join(dir, ".env");
    writeCredentials(path.join(dir, "credentials.json"), {
      accessToken: "token-0123456789",
      expiresAt: "2099-01-01T00:00:00.000Z",
      scopes: [],
      personUrn: PERSON_URN,
      savedAt: "2026-10-04T00:00:00.000Z",
    });
    const connection = connectionFor(resolveMcpConfig({ configFile }), { baseUrl: server.url });
    expect(connection.credentialsFile).toBe(path.join(dir, "credentials.json"));
    expect(connection.registry.file).toBe(path.join(dir, "posts.json"));
    await connection.client.createPost({ text: "hi" });
    expect(server.hits("/v2/userinfo")).toHaveLength(0);
  });

  it("refreshes an expired sign-in with the saved app when LinkedIn gave a refresh token", async () => {
    server = await FakeLinkedIn.start();
    server.refreshToken = "refresh-0123456789";
    const configFile = path.join(dir, ".env");
    writeCredentials(path.join(dir, "credentials.json"), {
      accessToken: "token-old",
      expiresAt: "2020-01-01T00:00:00.000Z",
      refreshToken: "refresh-0123456789",
      scopes: [],
      personUrn: PERSON_URN,
      savedAt: "2020-01-01T00:00:00.000Z",
    });
    const config = resolveMcpConfig({
      configFile,
      file: { LINKEDIN_CLIENT_ID: CLIENT_ID, LINKEDIN_CLIENT_SECRET: CLIENT_SECRET },
    });
    const connection = connectionFor(config, { baseUrl: server.url, tokenUrl: server.tokenUrl });
    await expect(connection.client.createPost({ text: "hi" })).resolves.toMatchObject({ author: PERSON_URN });
  });
});

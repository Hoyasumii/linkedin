import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  LinkedInApiError,
  LinkedInAuthError,
  authorizationUrl,
  credentialSource,
  credentialsFrom,
  exchangeCode,
  readCredentials,
  writeCredentials,
} from "../../src";
import { CLIENT_ID, CLIENT_SECRET, FakeLinkedIn, GOOD_CODE, MEMBER } from "./fake-server";

let linkedin: FakeLinkedIn;
let dir: string;
beforeEach(async () => {
  linkedin = await FakeLinkedIn.start();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "linkedin-auth-"));
});
afterEach(async () => {
  await linkedin.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

it("builds the authorization URL with the three scopes", () => {
  const url = new URL(
    authorizationUrl({ clientId: "abc", redirectUri: "http://localhost:3769/callback", state: "s1" })
  );
  expect(url.origin + url.pathname).toBe("https://www.linkedin.com/oauth/v2/authorization");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    response_type: "code",
    client_id: "abc",
    redirect_uri: "http://localhost:3769/callback",
    state: "s1",
    scope: "openid profile w_member_social",
  });
});

it("exchanges a code for a token, posting the app's credentials as a form", async () => {
  const token = await exchangeCode({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    code: GOOD_CODE,
    redirectUri: "http://localhost:3769/callback",
    tokenUrl: linkedin.tokenUrl,
  });
  expect(token).toMatchObject({ access_token: expect.stringMatching(/^token-/), expires_in: 5184000 });
  const hit = linkedin.hits("/oauth/v2/accessToken")[0];
  expect(hit.headers["content-type"]).toBe("application/x-www-form-urlencoded");
  expect(new URLSearchParams(hit.body.toString()).get("grant_type")).toBe("authorization_code");
});

it("masks the secret and the code when the exchange fails", async () => {
  const error = await exchangeCode({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    code: "wrong-code-123456",
    redirectUri: "http://localhost:3769/callback",
    tokenUrl: linkedin.tokenUrl,
  }).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(LinkedInApiError);
  expect((error as Error).message).toMatch(/Unable to retrieve access token/);
  expect(JSON.stringify(error)).not.toContain(CLIENT_SECRET);
});

it("turns a token answer and the member into credentials", () => {
  const now = Date.parse("2026-10-04T00:00:00Z");
  const credentials = credentialsFrom(
    { access_token: "t", expires_in: 86400, scope: "openid,profile,w_member_social" },
    MEMBER,
    now
  );
  expect(credentials).toEqual({
    accessToken: "t",
    expiresAt: "2026-10-05T00:00:00.000Z",
    scopes: ["openid", "profile", "w_member_social"],
    personUrn: "urn:li:person:Ab12Cd34",
    name: "Ada Lovelace",
    savedAt: "2026-10-04T00:00:00.000Z",
  });
});

describe("credentialSource", () => {
  const file = (): string => path.join(dir, "credentials.json");
  const saved = (expiresAt: string, extra: object = {}) =>
    writeCredentials(file(), {
      accessToken: "token-old-0123456789",
      expiresAt,
      scopes: ["w_member_social"],
      personUrn: "urn:li:person:A",
      savedAt: "2026-08-01T00:00:00.000Z",
      ...extra,
    });

  it("asks for a sign-in when nothing is saved", async () => {
    await expect(credentialSource(file())()).rejects.toThrow(/not signed in.*linkedin mcp config --web/);
  });

  it("answers a valid token, reading the file on every call", async () => {
    saved("2099-01-01T00:00:00.000Z");
    const source = credentialSource(file());
    await expect(source()).resolves.toMatchObject({ accessToken: "token-old-0123456789" });
    saved("2099-01-01T00:00:00.000Z", { accessToken: "token-new-0123456789" });
    await expect(source()).resolves.toMatchObject({ accessToken: "token-new-0123456789" });
  });

  it("refuses an expired token without a refresh token", async () => {
    saved("2026-01-01T00:00:00.000Z");
    const error = await credentialSource(file())().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LinkedInAuthError);
    expect((error as Error).message).toMatch(/expired on 2026-01-01/);
  });

  it("refreshes an expired token when LinkedIn gave a refresh token, and saves it", async () => {
    linkedin.refreshToken = "refresh-0123456789";
    saved("2026-01-01T00:00:00.000Z", { refreshToken: "refresh-0123456789" });
    const source = credentialSource(file(), {
      app: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET },
      tokenUrl: linkedin.tokenUrl,
    });
    const credentials = await source();
    expect(credentials.accessToken).toMatch(/^token-7/);
    expect(readCredentials(file())?.accessToken).toBe(credentials.accessToken);
    if (process.platform !== "win32") expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
  });
});

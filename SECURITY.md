# Security Policy

## Supported versions

Only the latest release of `@hoyasumii/linkedin` receives security fixes.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through
[GitHub's private vulnerability reporting](https://github.com/Hoyasumii/linkedin/security/advisories/new), or by
email to alanreisanjo@gmail.com.

Include the affected version, what an attacker can do, and the steps to reproduce it. You should get an answer
within a week. Once a fix is released, the advisory is published with credit to you, unless you prefer otherwise.

## Scope

Things worth reporting include, among others:

- a way to leak the access token or the Client Secret: through logs, error messages, tool answers, or the saved
  `.env` and `credentials.json`;
- a way for another web page, or another user of the machine, to read or complete the sign-in served by
  `linkedin mcp config` (its URL token, `Host` check and one-time OAuth `state`);
- a way to send the token to a host other than LinkedIn's;
- a way for a tool call to delete a post without `confirm: true`;
- command injection through `linkedin mcp install`/`uninstall`.

Vulnerabilities in LinkedIn itself belong to [LinkedIn's security program](https://www.linkedin.com/help/linkedin/answer/a1338323).

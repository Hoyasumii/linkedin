---
sidebar_position: 2
title: Creating the LinkedIn app
description: "The one-time setup: a LinkedIn developer app with the Share on LinkedIn and OpenID Connect products and a localhost redirect URL."
---

# Creating the LinkedIn app

LinkedIn only issues tokens to an app, and an app's Client Secret cannot ship inside an npm package. So you
create your own app, once. It is free and needs no review.

1. **A LinkedIn Page.** LinkedIn attaches every app to a Company Page. Any page you administer works. If you have
   none, [create one](https://www.linkedin.com/company/setup/new/): it can stay empty, and nothing is posted to it.
2. **The app.** At [linkedin.com/developers/apps/new](https://www.linkedin.com/developers/apps/new), give it a name
   (say, "My MCP"), pick the page, upload any logo and accept the terms.
3. **Its products.** In the app's **Products** tab, request:
   - **Share on LinkedIn**, which grants `w_member_social` to create, edit and delete your posts;
   - **Sign In with LinkedIn using OpenID Connect**, which grants `openid profile` to know who signed in.

   Both are granted at once.

4. **The redirect URL.** In the **Auth** tab, under _OAuth 2.0 settings_, add this **Authorized redirect URL**:

   ```text
   http://localhost:3769/callback
   ```

   It is where LinkedIn sends you back after you sign in, to the page `linkedin mcp config` serves. Another port
   works too (`linkedin mcp config --redirect-port <port>`), as long as both say the same.

5. **The credentials.** In the same **Auth** tab, copy the **Client ID** and the **Primary Client Secret**.

Then run `linkedin mcp config --web`: paste both, press _Save and sign in with LinkedIn_, and allow the app on
LinkedIn's page. The Client Secret and the token are saved on your computer only, readable by you alone (see
[Configuration](./mcp/configuration.md)).

## Renewing the sign-in

A LinkedIn member token lasts **60 days**, and LinkedIn gives ordinary apps no refresh token. When it runs out,
the tools answer "not signed in" and your agent tells you to run `linkedin mcp config --web` again. That takes a
click, since the app is already saved. `linkedin mcp status` shows how many days are left.

If LinkedIn does give your app a refresh token (an option it enables for some partners), the server refreshes
the token by itself.

## Limits

- 150 posts a day per member, and 100,000 calls a day per app.
- The token can post only as you, never as a page or another member.
- To revoke the app's access, remove it at
  [linkedin.com/psettings/permitted-services](https://www.linkedin.com/psettings/permitted-services).

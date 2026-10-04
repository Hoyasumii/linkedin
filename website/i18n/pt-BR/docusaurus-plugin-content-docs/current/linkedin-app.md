---
sidebar_position: 2
title: Criando o app no LinkedIn
description: "A configuração única: um app de desenvolvedor no LinkedIn com os produtos Share on LinkedIn e OpenID Connect e uma URL de redirect em localhost."
---

# Criando o app no LinkedIn

O LinkedIn só emite tokens para um app, e o Client Secret de um app não pode ir dentro de um pacote npm. Por isso
você cria o seu próprio app, uma única vez. É gratuito e não passa por revisão.

1. **Uma página no LinkedIn.** O LinkedIn vincula todo app a uma Company Page. Qualquer página que você administre
   serve. Se você não tiver nenhuma, [crie uma](https://www.linkedin.com/company/setup/new/): ela pode ficar
   vazia, e nada é postado nela.
2. **O app.** Em [linkedin.com/developers/apps/new](https://www.linkedin.com/developers/apps/new), dê um nome (por
   exemplo, "Meu MCP"), escolha a página, envie qualquer logo e aceite os termos.
3. **Os produtos.** Na aba **Products** do app, solicite:
   - **Share on LinkedIn**, que concede `w_member_social` para criar, editar e remover seus posts;
   - **Sign In with LinkedIn using OpenID Connect**, que concede `openid profile` para saber quem fez login.

   Os dois são liberados na hora.

4. **A URL de redirect.** Na aba **Auth**, em _OAuth 2.0 settings_, adicione esta **Authorized redirect URL**:

   ```text
   http://localhost:3769/callback
   ```

   É para lá que o LinkedIn manda você de volta depois do login, na página que o `linkedin mcp config` serve.
   Outra porta também funciona (`linkedin mcp config --redirect-port <porta>`), desde que os dois lados usem a
   mesma.

5. **As credenciais.** Na mesma aba **Auth**, copie o **Client ID** e o **Primary Client Secret**.

Depois rode `linkedin mcp config --web`: cole os dois, clique em _Save and sign in with LinkedIn_ e autorize o app
na página do LinkedIn. O Client Secret e o token ficam salvos só no seu computador, legíveis apenas por você
(veja [Configuração](./mcp/configuration.md)).

## Renovando o login

Um token de membro do LinkedIn dura **60 dias**, e o LinkedIn não dá refresh token para apps comuns. Quando ele
vence, as ferramentas respondem "not signed in" e o seu agente pede para você rodar `linkedin mcp config --web` de
novo. É um clique, porque o app já está salvo. `linkedin mcp status` mostra quantos dias faltam.

Se o LinkedIn der um refresh token ao seu app (uma opção que ele habilita para alguns parceiros), o servidor
renova o token sozinho.

## Limites

- 150 posts por dia por membro e 100.000 chamadas por dia por app.
- O token só posta como você, nunca como uma página ou outro membro.
- Para revogar o acesso do app, remova-o em
  [linkedin.com/psettings/permitted-services](https://www.linkedin.com/psettings/permitted-services).

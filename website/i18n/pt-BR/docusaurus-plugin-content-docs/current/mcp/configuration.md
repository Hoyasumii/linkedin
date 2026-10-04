---
sidebar_position: 4
title: Configuração
description: "Onde ficam salvos as configurações do app, o login e a lista de posts, e as variáveis de ambiente que os substituem."
---

# Configuração

O `linkedin mcp config` salva três arquivos num diretório por usuário, cada um legível só por você (modo `0600`;
no Windows, as permissões da pasta):

| Arquivo            | Guarda                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `.env`             | O app: `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` e, opcionalmente, `LINKEDIN_REDIRECT_PORT` e `LINKEDIN_API_VERSION` |
| `credentials.json` | O login: token de acesso, validade, person URN, nome, escopos                                                             |
| `posts.json`       | A [lista local de posts](./tools.md#lendo-seus-posts)                                                                     |

O diretório é `~/.config/linkedin` no Linux (`$XDG_CONFIG_HOME/linkedin`), `~/Library/Application
Support/linkedin` no macOS e `%APPDATA%\linkedin` no Windows. `LINKEDIN_CONFIG` aponta para outro `.env`; os
outros dois arquivos ficam ao lado dele.

## Ambiente

Lidas pelo `linkedin-mcp` ao iniciar, por cima dos valores salvos:

| Variável                                       | Efeito                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| `LINKEDIN_CONFIG`                              | Outro `.env` (e portanto outro login e outra lista de posts)        |
| `LINKEDIN_ACCESS_TOKEN`                        | Usa este token no lugar do `credentials.json`; nunca é salvo        |
| `LINKEDIN_PERSON_URN`                          | Com um token: o autor, evitando a chamada a `userinfo`              |
| `LINKEDIN_API_VERSION`                         | O header `LinkedIn-Version`, `YYYYMM` (padrão `202609`)             |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | O app, para renovar um token quando o LinkedIn deu um refresh token |

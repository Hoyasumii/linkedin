---
sidebar_position: 3
title: Ferramentas
description: "As entradas e respostas de cada ferramenta, a confirmação antes de remover, e por que o servidor só lê os posts que ele mesmo fez."
---

# Ferramentas

## linkedin_create_post

Publica um post no perfil do membro logado, na hora.

| Entrada           | Tipo                                        | Observações                                                  |
| ----------------- | ------------------------------------------- | ------------------------------------------------------------ |
| `text`            | string                                      | Texto puro; os caracteres reservados são escapados para você |
| `visibility`      | `PUBLIC` \| `CONNECTIONS`                   | Padrão `PUBLIC`                                              |
| `images`          | `{ path, alt_text? }[]`                     | 1, ou de 2 a 20 numa galeria                                 |
| `video`           | `{ path, title? }`                          | MP4                                                          |
| `document`        | `{ path, title? }`                          | PDF, PPT(X), DOC(X), mostrado como carrossel                 |
| `article`         | `{ url, title?, description?, thumbnail? }` | Um card de link; `thumbnail` é uma imagem local              |
| `reshare_of`      | string                                      | A URN ou URL de um post para compartilhar                    |
| `disable_reshare` | boolean                                     |                                                              |
| `raw_text`        | boolean                                     | O texto já está no formato little (para menções)             |
| `hashtags`        | boolean                                     | Padrão `true`: `#palavra` continua hashtag                   |

No máximo um tipo de mídia. Os caminhos são locais à máquina onde o servidor roda. A resposta traz a `urn` e a
`url` do post e o que foi gravado na lista local. As instruções do servidor pedem ao agente que publique só o que
você pediu e que mostre antes qualquer texto que ele mesmo escreveu.

## linkedin_edit_post

`post` (uma URN ou URL) e o novo `text` (com `raw_text` e `hashtags` como acima). Só o texto muda: imagens, vídeo,
documentos e links não podem ser trocados, então para isso remova o post e poste de novo.

## linkedin_delete_post

`post` e `confirm`. O servidor recusa a menos que `confirm` seja `true`, e a descrição da ferramenta pede ao agente
que confirme o post com você antes. A remoção é permanente.

## linkedin_whoami

O nome e a person URN do membro, quando o login vence e quantos dias faltam.

## linkedin_list_posts e linkedin_get_post

`linkedin_list_posts` aceita `query` (texto a procurar), `limit` (padrão 20) e `include_deleted`.
`linkedin_get_post` aceita `post`. As duas leem a lista local descrita abaixo e nunca chamam o LinkedIn.

## Lendo seus posts

O LinkedIn deixa qualquer app **escrever** os posts de um membro (`w_member_social`), mas lê-los de volta exige
`r_member_social`, que o LinkedIn fechou para apps novos. Até buscar um único post pela URN exige essa permissão.
A alternativa self-serve, a Member Data Portability API, só está aberta a membros da UE/EEE e da Suíça.

Por isso o servidor guarda o que faz. O `posts.json`, ao lado da configuração salva, registra cada post que ele
criou, editou ou removeu: URN, URL, o último texto escrito, visibilidade, mídia e datas. É isso que
`linkedin_list_posts` e `linkedin_get_post` mostram.

- Um post feito em linkedin.com não está na lista. Para editá-lo ou removê-lo, passe ao agente a URN ou a URL dele
  (**⋯** → **Incorporar este post** mostra a URN). Depois de editado por aqui, ele entra na lista.
- Uma edição feita em linkedin.com não é vista: a lista guarda o último texto escrito pelo servidor.

## Erros

Os erros das ferramentas voltam como texto que o agente consegue usar:

- _Not signed in to LinkedIn …_ or _The LinkedIn sign-in expired …_: o login falta ou venceu, então rode `linkedin mcp config --web`;
- _LinkedIn answered 403 (the token lacks a permission …)_: falta um produto no app, ou o post não é seu;
- _LinkedIn answered 429_: o limite diário foi atingido;
- problemas de arquivo e de texto (formato, tamanho, comprimento) são recusados antes de qualquer envio.

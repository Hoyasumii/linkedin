---
sidebar_position: 2
title: Posts
description: "Crie posts com texto, imagens, um vídeo, um documento, um artigo ou um compartilhamento; edite o texto; remova. O formato de texto little, escapado para você."
---

# Posts

## Criar

```ts
const { urn, url } = await linkedin.createPost({
  text: "Lançamos a v1.0 (finalmente) #release",
  visibility: "PUBLIC", // ou "CONNECTIONS": só conexões de 1º grau
});
```

Um post leva **um** tipo de mídia, no máximo:

```ts
await linkedin.createPost({ text: "Uma imagem", images: [{ file: "tela.png", altText: "O novo dashboard" }] });
await linkedin.createPost({ text: "Uma galeria", images: ["a.jpg", "b.jpg", "c.png"] }); // 2 a 20
await linkedin.createPost({ text: "Um vídeo", video: { file: "demo.mp4", title: "Demo" } });
await linkedin.createPost({ text: "Slides", document: { file: "deck.pdf", title: "Nosso roadmap" } });
await linkedin.createPost({
  text: "Vale a leitura",
  article: { url: "https://example.com/post", title: "O post", description: "…", thumbnail: "capa.png" },
});
await linkedin.createPost({ text: "Concordo!", reshareOf: "https://www.linkedin.com/feed/update/urn:li:share:7…/" });
```

A mídia é um caminho local, ou `{ data: Uint8Array, filename, contentType }`. Veja [Mídia](./media.md) para os
formatos e limites. `disableReshare: true` impede que outras pessoas compartilhem o post.

O LinkedIn não busca a página de um artigo: o card mostra só o `title`, a `description` e a `thumbnail` que você
definir. Uma URL solta no texto ganha a prévia de link de sempre do LinkedIn.

## O texto

O texto de um post usa o formato _little_ do LinkedIn. Os caracteres reservados dele,
`\ | { } @ [ ] ( ) < > # * _ ~`, precisam ser escapados mesmo quando não formam nada. Um `(` sem escape pode fazer
o LinkedIn cortar o post sem dar erro. O SDK escapa o texto puro para você:

- quebras de linha e emoji são mantidos;
- `#palavra` continua hashtag (`hashtags: false` torna todo `#` texto comum); um `#` que não começa palavra
  (`C#`) é escapado;
- o limite é de 3.000 caracteres **depois** do escape, conferido antes do envio.

Para mencionar alguém, escreva você mesmo no formato little e passe `rawText: true`:

```ts
await linkedin.createPost({ text: "Valeu @[Ada Lovelace](urn:li:person:Ab12Cd34)\\!", rawText: true });
```

`toLittle(text)` e `fromLittle(little)` convertem manualmente.

## Editar

```ts
await linkedin.editPost(urn, { text: "Lançamos a v1.0.1 (um hotfix)" });
```

Só o texto muda: o LinkedIn não deixa trocar as imagens, o vídeo, o documento ou o link de um post. Para isso,
remova o post e poste de novo. O post aparece como editado.

## Remover

```ts
await linkedin.deletePost(urn); // ou a URL do post
```

A remoção é permanente e leva junto os comentários e as reações. Remover de novo um post já removido dá certo.

## Quais posts

`editPost` e `deletePost` aceitam uma URN de post (`urn:li:share:…` ou `urn:li:ugcPost:…`) ou uma URL que contenha
uma, como `https://www.linkedin.com/feed/update/urn:li:share:…/`. O link de _Copiar link do post_ aponta para a
_atividade_ do feed (`…-activity-7…`), que a API não aceita. Em linkedin.com, abra o menu **⋯** do post →
**Incorporar este post**: o código de incorporação traz a URN do post. `parsePostRef` aceita todas as formas e
explica o caso da atividade.

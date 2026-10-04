---
sidebar_position: 3
title: Mídia
description: "Uploads de imagem, vídeo e documento: formatos, tamanhos, o upload de vídeo em partes e o processamento."
---

# Mídia

O `createPost` envia os arquivos que recebe. Os métodos de upload também estão disponíveis sozinhos:

```ts
const image = await linkedin.uploadImage("tela.png"); // urn:li:image:…
const video = await linkedin.uploadVideo("demo.mp4"); // urn:li:video:…, depois de processado
const document = await linkedin.uploadDocument("deck.pdf"); // urn:li:document:…, depois de processado
```

| Tipo      | Formatos                        | Tamanho                            | Observações                           |
| --------- | ------------------------------- | ---------------------------------- | ------------------------------------- |
| Imagem    | JPG, PNG, GIF (até 250 quadros) | menos de 36.152.320 pixels         | 1 por post, ou de 2 a 20 numa galeria |
| Vídeo     | MP4                             | de 75 KB a 500 MB, de 3 s a 30 min | enviado em partes de 4 MB             |
| Documento | PDF, PPT, PPTX, DOC, DOCX       | até 100 MB e 300 páginas           | aparece como um carrossel deslizável  |

A extensão e o tamanho são conferidos antes de qualquer envio (`checkMedia`, `MEDIA_RULES`).

Cada upload pede ao LinkedIn uma URL de upload (`initializeUpload`) e então envia os bytes por PUT. Um vídeo vai
nas partes que o LinkedIn indicar e é finalizado com o `ETag` de cada parte. Vídeos e documentos são então
processados pelo LinkedIn. O SDK consulta o status deles até ficarem `AVAILABLE`, a cada 2 segundos e por até 10
minutos (`poll: { intervalMs, timeoutMs }`). Um token só com `w_member_social` pode ter essa leitura de status
recusada. Nesse caso o post é tentado de novo enquanto o LinkedIn disser que a mídia ainda está sendo processada.
Um processamento que falha lança `LinkedInMediaError` com o motivo dado pelo LinkedIn.

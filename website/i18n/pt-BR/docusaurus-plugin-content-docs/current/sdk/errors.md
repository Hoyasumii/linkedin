---
sidebar_position: 4
title: Erros
description: "Os erros que o SDK lança, com o status e os códigos do LinkedIn, e o token sempre mascarado."
---

# Erros

| Classe                 | Quando                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `LinkedInApiError`     | O LinkedIn respondeu um status fora de 2xx: `status`, `code` (`ACCESS_DENIED`…), `serviceErrorCode`, `message`, `body` |
| `LinkedInAuthError`    | Sem token, token vencido ou um 401: faça login de novo com `linkedin mcp config --web`                                 |
| `LinkedInConfigError`  | Entrada recusada antes do envio: arquivo inválido, texto longo demais, dois tipos de mídia, URN inválida               |
| `LinkedInMediaError`   | O LinkedIn não conseguiu processar um vídeo ou documento, ou não terminou a tempo                                      |
| `LinkedInTimeoutError` | Sem resposta dentro de `timeoutMs`                                                                                     |

```ts
import { LinkedInApiError, LinkedInAuthError } from "@hoyasumii/linkedin";

try {
  await linkedin.deletePost(urn);
} catch (error) {
  if (error instanceof LinkedInAuthError) console.error("Faça login de novo: linkedin mcp config --web");
  else if (error instanceof LinkedInApiError && error.status === 404) console.error("Esse post não existe");
  else throw error;
}
```

Os status mais comuns:

- **403**: falta uma permissão ao token (falta um produto no app), ou o post não é seu;
- **404**: o post não existe, ou foi removido;
- **429**: o limite diário (150 posts por membro) foi atingido;
- **426** ou uma mensagem sobre versão: a `LinkedIn-Version` foi aposentada, então defina uma `apiVersion` mais nova.

`redact(value, secrets)` mascara segredos em qualquer coisa que você registre em log. Todo erro criado pelo SDK
já vem mascarado.

---
sidebar_position: 3
title: Windows e WSL
description: "Usando a CLI no Windows 10/11 pelo PowerShell ou cmd, e registrando o servidor em clientes do Windows a partir do WSL."
---

# Windows e WSL

O pacote roda no Windows 10/11 com Node.js 20 ou mais recente, pelo PowerShell ou pelo cmd.

- As configurações, o login e a lista de posts ficam em `%APPDATA%\linkedin\`, protegidos pelas permissões por
  usuário dessa pasta (modos de arquivo não significam nada no Windows).
- As CLIs dos clientes rodam pelo `cross-spawn`, então os shims `.cmd` do Windows funcionam.
- Os arquivos são gravados por um rename que tenta de novo, porque antivírus e editores seguram arquivos abertos.

## A partir do WSL

Quando o pacote está instalado dentro do WSL, `linkedin mcp install` e `uninstall` também listam os clientes
instalados do lado do Windows, como `Claude Code (Windows)` e assim por diante (`--client claude@windows`). Eles
iniciam o servidor com `wsl.exe -d <distro> -e node …/dist/mcp/cli.js`, então ele continua lendo o login salvo
dentro do WSL. A primeira chamada depois de o WSL ficar ocioso espera a distro iniciar (um ou dois segundos).

O lado do Windows é alcançado pelo `powershell.exe`, pego do PATH ou, com `appendWindowsPath = false`, de
`/mnt/c/Windows/System32/WindowsPowerShell/v1.0/`. Quando ele não pode ser alcançado, `--client claude@windows` diz
qual etapa falhou.

O `linkedin mcp config --web` dentro do WSL serve a página em `localhost:3769` dentro do WSL, que o navegador do
Windows alcança pelo encaminhamento de localhost do WSL (ligado por padrão).

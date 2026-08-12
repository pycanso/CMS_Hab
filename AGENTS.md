# AGENTS.md

Assistente de Perguntas & Respostas 100% offline sobre o Regulamento Geral de Habitação do Município de Sintra. Consiste num site estático (`index.html`, `style.css`, `app.js`) alimentado por um corpus gerado a partir de PDFs.

## Estrutura e fluxo

- `build_index.py` extrai o texto de `REG HABITAÇÃO PUBLICAÇÃO EM DR II - 29 JAN 24.pdf` e gera `data.js` (o `window.CMS_HABITACAO`). **`data.js` é código gerado — nunca editar manualmente.** Regenerar com `python build_index.py` (requer `pymupdf`, já em `requirements.txt`; instalado com Python 3.12 no ambiente).
- `Regulamento Habitação A.M.S.pdf` tem a camada de texto bloqueada (anti-cópia) e **não é extraível**; o corpus vem sempre do documento DR II. Não perder tempo a tentar extrair o A.M.S.
- Não há servidor nem build: basta abrir `index.html` no browser. O histórico vive em `localStorage` (chave `cms_hab_hist_v1`).

## Convenções críticas

- A normalização/segmentação (`removeAccents`, `STOPWORDS`, `stem`, `tokenize`, `tokenMatch`) está **duplicada** em `build_index.py` e `app.js` — alterações a um lado têm de ser espelhadas no outro.
- `data.js` é escrito em UTF-8 pelo Python; manter essa codificação ao editá-lo (nunca em `Windows-1252`).
- Site inteiro em português (pt-PT): textos, `aria-label`, interface.

## Verificação

- Sem testes automatizados. Há um hook de inspeção `window.__CMS_TEST` exposto no console para testar `answerQuestion`, `tokenize`, `scoreChunk`, etc.
- Após alterar o motor de respostas (`app.js`), testar com as perguntas sugeridas em `index.html` e com casos fora do âmbito (deve recusá-los).
# Homologação no Bitrix24 real — passo a passo

Nenhum destes passos foi executado ainda. Depende de contas reais (Neon,
Vercel, um portal Bitrix24 de teste/homologação) que este ambiente não tem
acesso. Siga na ordem — cada passo depende do anterior.

## 1. Criar o projeto no Neon

1. Crie uma conta/projeto em https://neon.tech (região `sa-east-1` ou a mais
   próxima do público-alvo).
2. No dashboard do projeto, copie duas connection strings:
   - a **pooled** (host contém `-pooler`) → vai em `DATABASE_URL`.
   - a **direta** (sem `-pooler`) → vai em `DIRECT_URL`.
3. Guarde as duas — vão para o `.env` local e para as variáveis de ambiente
   da Vercel (nunca commitadas).

## 2. Aplicar as migrations

1. Copie `.env.example` para `.env` e preencha `DATABASE_URL`/`DIRECT_URL`.
2. Rode `npx prisma migrate deploy` — aplica as 3 migrations existentes (ver
   `docs/migrations.md`).
3. Rode `npm run check:env` — confirme que "Conexão com o banco" e
   "Migrations aplicadas" aparecem como `[OK]`.

## 3. Publicar na Vercel

1. Importe o repositório no dashboard da Vercel.
2. **Não** rode o build antes de configurar as variáveis (passo 4) — o build
   já falha sem elas (ver `getEnv()`).
3. Configure o Framework como Next.js (detectado automaticamente).

## 4. Configurar as variáveis de ambiente (na Vercel)

Preencha em Settings → Environment Variables, para os ambientes Production e
Preview:

- `DATABASE_URL`, `DIRECT_URL` (do passo 1)
- `BITRIX_CLIENT_ID`, `BITRIX_CLIENT_SECRET` (vêm do passo 5, preencher depois)
- `BITRIX_TOKEN_ENCRYPTION_KEY` — gere com
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
- `SESSION_JWT_SECRET` — gere com
  `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
- `APP_BASE_URL` — a URL pública da Vercel (ex.: `https://hecke-inventario.vercel.app`)
- `BITRIX_EXTRA_FRAME_ANCESTORS` — pode deixar vazio no início (o domínio do
  portor ACTIVE já libera sozinho depois da instalação)
- `BLOB_READ_WRITE_TOKEN` — criar um Blob Store em Storage → Blob e copiar o token
- `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` — do dashboard do Inngest (criar
  conta em https://inngest.com, conectar ao projeto)
- Depois de configurar tudo, faça o deploy.

## 5. Criar o Aplicativo Local no Bitrix24

No portal Bitrix24 (Configurações → Desenvolvedores → Outro → Aplicativo
Local):

Os rótulos do formulário em português são estes (conferidos no portal em
2026-08-20) — **não troque os dois caminhos de lugar**, é a causa da tela
branca ao abrir o app:

| Campo do formulário             | Valor                                    |
| ------------------------------- | ---------------------------------------- |
| Nome                            | Inventário de TI                         |
| Seu caminho do manipulador\*    | `{APP_BASE_URL}/bitrix/app`              |
| Caminho de instalação inicial   | `{APP_BASE_URL}/api/bitrix/install`      |
| Atribuir permissões (escopos)   | `user` e `department` — nada além disso  |
| Marcar "Aplicativo de servidor" | sim                                      |

Por que assim:

- `/bitrix/app` é onde o Bitrix24 faz **POST a cada abertura** do app (ver o
  comentário no topo de `app/(embedded)/bitrix/app/route.ts`), então é ele o
  "manipulador";
- `/api/bitrix/install` roda **uma vez**, na instalação: cria/ativa o portal e
  dispara a primeira sincronização;
- `/api/bitrix/handler` NÃO vai neste formulário — é chamado pelo próprio
  aplicativo (SDK, dentro do iframe) para trocar o `AUTH_ID` por sessão;
- só `user` e `department` porque os únicos métodos REST usados são
  `user.current`, `user.get` e `department.get`.

Ao salvar, o Bitrix24 mostra **Client ID** e **Client Secret** — copie os dois
para `BITRIX_CLIENT_ID`/`BITRIX_CLIENT_SECRET` na Vercel e faça um redeploy
(variável de ambiente só é lida em build/cold start).

## 6. Instalar

Abra o link de instalação do app dentro do portal (menu do app ou a URL que o
Bitrix24 mostra). Isso dispara `POST {APP_BASE_URL}/api/bitrix/handler`, que
deve responder confirmando a instalação.

## 7. Validar sessão

Abra o app pelo menu do Bitrix24 (não direto pela URL) — isso deve carregar
`/bitrix/app` dentro do iframe e mostrar o dashboard com seu nome e o domínio
do portal. Se aparecer "Este aplicativo precisa ser aberto de dentro do
Bitrix24", o handshake (`hs` na query string) não chegou — confira `APP_BASE_URL`.

**Nota técnica (bug real de produção, corrigido em 2026-07-24):** o Bitrix24
faz `POST {APP_BASE_URL}/bitrix/app` toda vez que o app é aberto — não só na
instalação, e não em `/api/bitrix/handler` como a tabela acima poderia sugerir.
Por isso `/bitrix/app` tem um `route.ts` próprio (não só a página React) que
valida esse POST e redireciona para `/bitrix/app/view?hs=...`, onde a UI de
fato renderiza. Sem esse `route.ts`, o POST batia numa página client-side
(GET-only) e voltava 405/406 — a causa da "tela branca" ao abrir o app.

## 8. Sincronizar usuários e departamentos

No dashboard, como administrador, clique em "Sincronizar agora" (ou aguarde a
sincronização automática pós-instalação). Confira em `/admin/diagnostics` que
"Sincronização de usuários/departamentos" aparece `[OK]` e que a contagem de
usuários/departamentos é maior que zero.

## 9. Criar formulário

`/admin/forms` → "+ Novo formulário" → adicionar ao menos um campo obrigatório.

## 10. Publicar

Na tela do formulário → "Publicar" → "Nova versão" (primeira publicação
sempre é nova versão, nunca correção simples).

## 11. Abrir solicitação

Como usuário comum (ou o mesmo admin, sem trocar de papel) → `/requests/new`
→ escolher o formulário → "Iniciar solicitação".

## 12. Enviar

Preencher os campos obrigatórios em `/requests/[id]/fill` → "Enviar".

## 13. Criar workflow

`/admin/workflows` → "+ Novo workflow" → escolher o mesmo formulário → no
editor, montar ao menos START → APPROVAL → END, com responsável `ADMIN` (mais
simples de testar sem precisar de um segundo usuário real).

## 14. Publicar workflow

No editor → "Validar" (deve dizer "Grafo válido") → "Publicar" → "Nova
versão".

## 15. Gerar tarefa

Enviar uma NOVA solicitação (depois do workflow publicado) — a tarefa de
aprovação deve aparecer em `/tasks`.

## 16. Aprovar

Em `/tasks`, clicar "Aprovar" na tarefa. Confirmar em `/requests/[id]` que o
workflow avançou (`workflow.status` deve virar `COMPLETED` se a etapa
seguinte for END).

## 17. Rejeitar

Repetir 11-15 com uma segunda solicitação; desta vez clicar "Rejeitar" (exige
justificativa no campo de comentário).

## 18. Devolver

Repetir 11-15 com uma terceira solicitação; clicar "Devolver" com uma
justificativa. Confirmar que o status da solicitação vira "Devolvida para
correção" e que aparece o botão "Corrigir e reenviar".

## 19. Reenviar

Como o solicitante, abrir `/requests/[id]/resubmit`, alterar o(s) campo(s)
liberado(s) e "Reenviar". Confirmar que volta a `SUBMITTED` e que o workflow
resume.

## 20. Registrar o resultado

Depois de rodar 1-19, preencha o relatório de homologação com: o que
funcionou sem alteração, o que precisou de correção (e qual foi), e o que
ainda não pôde ser testado (upload real, e-mail real, CIGAM real — fora do
escopo desta rodada).

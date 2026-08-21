# Migrations — como aplicar

Este projeto usa `prisma migrate`, nunca `prisma db push`. `db push` não gera
histórico nem SQL revisável — inadequado a partir do momento em que existe um
banco real com dados de verdade.

## Estado atual (nesta sessão)

Três migrations foram geradas **e aplicadas de verdade** em 2026-07-24 contra
um projeto Neon real (fornecido pelo usuário nesta sessão). Confirmado depois
de aplicar:

- `npm run check:env` reporta banco conectado, as 3 migrations aplicadas e o
  schema acessível.
- Consulta direta a `pg_indexes`/`pg_constraint` confirma que os 2 índices
  parciais e os 2 `CHECK` existem no banco.
- Teste funcional real: criado um `FormDefinition` + primeiro `FormVersion`
  `DRAFT`; a tentativa de criar um SEGUNDO `DRAFT` para o mesmo formulário foi
  rejeitada pelo banco com `P2002` (o mesmo código que `isUniqueConstraintError`
  já trata em `src/modules/forms/service.ts`) — o índice parcial funciona de
  ponta a ponta, não só "existe". Todos os dados de teste foram removidos
  depois (banco voltou a 0 portais).

Ainda pendente: deploy na Vercel e instalação num portal Bitrix24 real (fora
do alcance deste ambiente — dependem das contas do usuário).

As três migrations:

1. `prisma/migrations/20260724162412_init/` — todos os modelos das Fases 0 a 4
   (fundação, Bitrix24, formulários, solicitações, workflow, e-mail,
   integrações). Gerada com:

   ```
   npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
   ```

   (introspecção estática do `schema.prisma` — não precisa de banco).

2. `prisma/migrations/20260724162413_partial_unique_draft_indexes/` — os dois
   índices únicos parciais que o Prisma Schema DSL não expressa (`WHERE` em
   `@@unique`), escritos à mão:
   - `form_versions_one_draft_per_form` — no máximo um `DRAFT` por formulário.
   - `workflow_versions_one_draft_per_workflow` — no máximo um `DRAFT` por workflow.

3. `prisma/migrations/20260724162414_justification_check_constraints/` —
   endurecimento opcional (`CHECK` constraints) garantindo no banco duas
   regras que a aplicação já impõe: justificativa obrigatória em correção
   administrativa e em rejeição/devolução de aprovação. Nenhum código atual
   viola nenhum dos dois (conferido linha a linha antes de escrever).

Já aplicadas com sucesso no Neon de desenvolvimento fornecido nesta sessão
(ver "Estado atual" acima) — a sintaxe já foi validada rodando de verdade.
Continuam pendentes num banco de **produção** separado (nunca reaproveite o
mesmo projeto Neon de dev para produção).

## Aplicar em desenvolvimento (sua máquina, contra um Neon de dev/branch)

1. Preencha `.env` com `DATABASE_URL` (pooled) e `DIRECT_URL` (direta, sem
   pooler) do projeto Neon — ver `.env.example`.
2. Rode:
   ```bash
   npx prisma migrate deploy
   ```
   Isso aplica as 3 migrations em ordem e grava o histórico na tabela
   `_prisma_migrations` — não gera migration nova, só aplica as existentes.
3. Rode `npx prisma generate` (o `postinstall` já faz isso automaticamente).
4. Rode `npm run db:seed` se quiser os dados de exemplo (Fase 0 marker +
   formulário "Entrada de Colaborador", exige `SEED_PORTAL_ID`).

Se, depois disso, você alterar `schema.prisma` durante o desenvolvimento
normal (não nesta sessão), use `npx prisma migrate dev --name <descricao>` —
esse comando GERA uma migration nova a partir do diff contra o banco de dev e
já aplica. `migrate deploy` é só para aplicar migrations já existentes (dev
depois de puxar código novo, ou produção).

## Aplicar em produção (Vercel + Neon)

Nunca rode `migrate dev` em produção (ele pode perguntar interativamente e
pode resetar o banco de dev em cenários de drift — não é seguro para dados
reais).

1. Garanta que `DATABASE_URL`/`DIRECT_URL` de produção estão configuradas no
   projeto Vercel (Settings → Environment Variables).
2. Rode `npx prisma migrate deploy` **antes** do primeiro deploy que espera o
   schema novo — manualmente (de uma máquina com acesso ao `DIRECT_URL` de
   produção) ou como um passo de build/release separado. Não faça isso
   automaticamente dentro do `next build` da Vercel (o build não deve ter
   acesso de escrita ao banco por padrão).
3. Confirme com:
   ```sql
   SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at;
   ```
   Devem aparecer as 3 migrations, todas com `finished_at` preenchido (não
   nulo — nulo indica migration que falhou no meio).
4. Só então faça o deploy da aplicação em si.

## Se uma migration falhar no meio

`prisma migrate deploy` para na primeira migration que falhar e marca ela
como `failed` (nunca aplica as seguintes). Não rode `migrate resolve` sem
antes ler o erro exato — geralmente é objeto já existente (rodou parcialmente
antes) ou permissão insuficiente. Corrija a causa raiz; só use
`prisma migrate resolve --applied <nome>` se você mesmo confirmou, olhando o
banco, que aquela migration específica já foi aplicada por completo.

## Invariantes verificados que dependem de SQL manual

Além dos dois índices parciais (obrigatórios) e dois `CHECK` (opcionais,
já incluídos), foram avaliados e descartados por ora:

- `FormDefinition.currentPublishedVersionId` deveria apontar sempre para uma
  `FormVersion` do MESMO `formDefinitionId` — o Postgres não expressa isso
  como FK simples (precisaria de FK composta ou trigger). Hoje só a aplicação
  garante isso (`publishDraft` sempre atribui a partir de uma versão que ela
  mesma acabou de publicar para aquele formulário). Mesmo caso para
  `WorkflowDefinition.currentPublishedVersionId`. Não vale o custo/risco de um
  trigger nesta fase — documentado aqui para reavaliar se o volume de dados
  ou o número de pessoas com acesso direto ao banco crescer.

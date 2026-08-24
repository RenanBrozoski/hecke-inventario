# Handoff — Reforma completa do Inventário de TI (Bitrix24)

> Documento de continuidade. Qualquer IA/dev pode retomar a partir daqui.
> Escrito em 2026-08-24. Idioma do projeto: PT-BR.

## 0. Contexto rápido

App **Next.js 15 (App Router)** embutido como **Aplicativo Local do Bitrix24** (iframe).
Deploy na **Vercel** (auto-deploy no push para `main`), banco **Neon Postgres** via **Prisma 6**
(adapter serverless + `ws`). Testes em **Vitest**. Diretório do código:

```
C:\Users\Hecke\Documents\Projetos de Sistemas - Renan\Inventário TI - Bitrix
```

(O diretório `...\Inventário` ao lado é o sistema Flask legado — NÃO é onde se mexe.)

Dados em produção (aprox.): 422 equipamentos, 178 movimentações, 276 pessoas, 46 setores,
5 locais, 10 categorias/78 campos, 49 ramais, 226 recebimentos.
Status: ~360 ACTIVE / 55 STOCK / 7 BROKEN.

### Comandos

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest (151 testes passando antes da reforma)
npm run lint        # eslint
npm run build       # next build
```

Preview local: dev server na porta **3100** (ver `.claude/launch.json`, entrada
"Inventário TI - Bitrix (Next.js)"). Mas a maior parte da verificação é por
typecheck/test/build — o app só roda "de verdade" dentro do iframe do Bitrix
(precisa de sessão JWT).

### Regras de commit / deploy
- Commitar/pushar só quando fizer sentido entregar; `main` faz auto-deploy.
- Trailer de commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **NUNCA** expor segredos/tokens. Diagnósticos só mostram booleanos/nomes de campo.

## 1. Mapa da arquitetura

### Camada de dados — `prisma/schema.prisma` (865 linhas)
Modelos-chave do inventário (todos escopados por `portalId`):
- `InventoryEquipment` — patrimony, assetTag, name, categoryId, **status** (enum
  ACTIVE/STOCK/MAINTENANCE/BROKEN/LOANED/INACTIVE), currentHolderId, departmentId,
  locationId, locationDetail, serialNumber, invoiceNumber, datas (acquiredAt/receivedAt/
  deliveredAt/warrantyEndsAt), `specs` (JSON dinâmico), `legacyInvalidSpecs`, notes,
  **revision** (concorrência otimista), **archivedAt** (soft-delete/baixa).
- `InventoryMovement` — evento append-only (from/to person + department, com nomes
  snapshot), movedAt, reason, origin (MANUAL/IMPORT/INITIAL_REGISTRATION/BULK_TRANSFER),
  performedBy. É a base do HISTÓRICO de movimentação/responsável/setor.
- `InventoryPerson` (colaboradores), `InventoryDepartment` (setores, tem `active`),
  `InventoryLocation` (locais, tem `active`), `InventoryCategory` + `InventoryField`
  (campos dinâmicos por categoria), `InventoryCustomModule/Field/Record` (módulos
  personalizados), `InventoryTerm` (termos), `InventoryExtension` (ramais),
  `InventoryReceiving` (recebimentos), `InventoryAttachment` (anexos, Vercel Blob).
- `InventoryRoleAssignment` — RBAC (ADMIN/OPERATOR/VIEWER).
- `AuditLog` — trilha transversal (portalId, bitrixUserId, action, entityType,
  entityId, **metadata JSON**, createdAt). Ver ponto 6: hoje metadata só guarda
  nomes de campos alterados (`changedFields`), **não** valores antes/depois.

### Camada de serviço — `src/modules/inventory/`
- `service.ts` (1795 linhas) — CRUD de equipamentos/pessoas/setores/locais/categorias/
  campos + RBAC helpers usados nas rotas + `recordAuditEvent` embutido em cada mutação.
  Padrões: transações Prisma, `pg_advisory_xact_lock` por recurso, compare-and-swap por
  `revision`, `safeEquipment()` redige PASSWORD, `validateDynamicData()`.
- `secondary-service.ts` (822) — ramais, recebimentos, termos, módulos custom, anexos.
- `report-service.ts` (306) — expirations, movements (list), audit (list),
  `exportInventoryEquipmentCsv()` (CSV; **só** filtra por categoryId hoje),
  `serializeInventoryCsv()` (com proteção anti-fórmula e BOM).
- `schemas.ts` (377) — schemas Zod de entrada.
- `http.ts` — `requireInventoryContext()` (resolve portal+usuário+papel; admin do
  portal sempre ADMIN), `requireInventoryRole(ctx, 'OPERATOR'|'ADMIN')`, classes de
  erro + `inventoryErrorResponse()`, `jsonOk()`.
- `date.ts`, `import-*.ts`, `attachment-service.ts`.
- `src/modules/audit/log.ts` — `recordAuditEvent(input, tx?)`.

### Rotas de API — `app/api/inventory/**/route.ts` (37 arquivos)
Cada rota chama `requireInventoryContext()` e, nas mutações, `requireInventoryRole()`.
GET normalmente exige só contexto (VIEWER+). POST/PATCH/DELETE exigem OPERATOR ou ADMIN.

### UI — `src/components/inventory/*.tsx` + `app/(embedded)/inventory/**/page.tsx`
As `page.tsx` são finas; a lógica está nos componentes `'use client'`:
- `InventoryGate.tsx` — wrapper com sub-nav horizontal (NAV_ITEMS) + badge de papel;
  busca `/api/inventory/context` → `canEdit` (ADMIN|OPERATOR), `canAdmin` (ADMIN).
- `EquipmentListPage.tsx` — a TABELA do inventário (ponto 2/9/10).
- `EquipmentDetailPage.tsx` — detalhe do equipamento + timeline (ponto 8/11).
- `EquipmentFormPage.tsx` — form de criar/editar.
- `InventoryDashboardPage.tsx` — "Visão geral".
- `InventoryReportsPage.tsx` — relatórios/exportações (ponto 5/6).
- `InventorySettingsPage.tsx` — administração/config (ponto 4/7).
- `PeopleListPage / PersonDetailPage / PersonFormPage`, `LedgerPages` (ramais/
  recebimentos), `TermsPages`, `CustomModulesPages`, `BulkTransferPanel`,
  `InventoryAttachments`.
- `format.ts` — `EQUIPMENT_STATUS_LABELS`, `equipmentLabel()`, `statusTone()`,
  `readApiError()`.
- `inventory.module.css` — estilos com escopo do módulo.
- `types.ts` — tipos de resposta da API.

### Estilos globais — `app/globals.css` (604 linhas)
Tokens em `:root` (`--color-*`, `--space-1..6`, `--radius-*`, `--shadow-*`),
tema claro + escuro (`prefers-color-scheme`). Layout `.app-shell` (flex): nav
lateral `flex 0 0 220px` + `.app-shell__main` (**`max-width: 1100px`** ← ponto 1).
`AppShell.tsx` (`src/components/layout/`) é a nav de topo.

## 2. Pedido do usuário (13 pontos, na ordem de prioridade dele)

1. **Uso do espaço da tela** — app usa área pequena; aproveitar largura do
   navegador; foco em desktop corporativo. (Culpado: `.app-shell__main{max-width:1100px}`.)
2. **Tela de inventário como no sistema local antigo** — remover a "separação" de
   equipamentos que não existia no sistema antigo; visão unificada, simples, todos os
   equipamentos acessíveis naturalmente; menos divisões/agrupamentos.
3. **Melhorar muito o frontend** — profissional, moderno, limpo, corporativo,
   consistente. Sem excesso de efeitos/gradientes/animações; foco em produtividade,
   legibilidade e velocidade; padrão visual único em todas as telas.
4. **Controle de acesso** — Administrador / Operador / Consulta com permissões
   específicas; **validar no backend/API**, não só visual (RBAC); preparar para
   permissões granulares futuras.
5. **Exportação de dados** — inventário completo, equipamentos, equipamentos
   filtrados, histórico de movimentação, histórico de alterações, por setor/usuário/
   tipo/status; XLSX/CSV e PDF quando fizer sentido; **os filtros da tela devem valer
   na exportação**.
6. **Logs de auditoria** — quem/data/hora/ação/registro/**valor antes e depois**;
   cobrir criar/editar/excluir/movimentar/mudar responsável/setor/status/mudanças de
   admin/mudanças de permissão; tela de Logs/Auditoria (admin) com busca+filtros.
7. **Editar setores** — área de gestão: criar/editar/ativar-desativar/excluir quando
   possível/buscar/ver equipamentos vinculados; **preferir inativação a exclusão** para
   preservar histórico.
8. **Histórico do equipamento** — linha do tempo por equipamento (cadastro, alterações,
   movimentações, mudança de responsável/setor, manutenção, status, baixa, retorno,
   observações), com quando/quem/o quê.
9. **Filtros e busca melhores** — buscar por patrimônio, série, equipamento, tipo,
   marca, modelo, usuário, responsável, setor, status; filtros combináveis.
10. **Tabela do inventário melhor** — ordenar colunas, filtros, busca, paginação,
    contagem de registros, seleção de colunas, largura adequada, ações rápidas,
    indicação visual de status, persistência de filtros; manter TABELA (não cards).
11. **Detalhe do equipamento melhor** — seções: Identificação, Situação, Informações
    adicionais, Histórico.
12. **Segurança e consistência** — validação de entrada, auth, autorização, proteção
    de rotas, validação no backend, tratamento de erro, mensagens ao usuário, registros
    duplicados, integridade de relações, exclusões que quebram histórico.
13. **Melhorias adicionais** — UX, produtividade, navegação, performance, organização,
    segurança, confiabilidade, administração, histórico, consistência visual. Toda
    mudança deve melhorar o uso real. Não trocar tecnologias/arquitetura sem
    necessidade; reaproveitar o que existe.

Instruções de execução do usuário: **implementar tudo nesta sessão, sem parar para
confirmações desnecessárias; testar; corrigir regressões; resumir no fim.** Só
perguntar se uma questão estrutural realmente bloquear.

## 3. Estado atual x pedido (o que já existe)

| # | Já existe | Falta |
|---|-----------|-------|
| 1 | layout shell | remover/elevar `max-width:1100px` p/ inventário; revisar paddings/tabelas |
| 2 | `EquipmentListPage` já é tabela unificada dos 422 c/ filtros | confirmar o que é a "separação" que ele odeia (provável: nº de abas/módulos no topo, ou dashboard como landing). Simplificar nav; tornar Equipamentos o centro |
| 3 | tokens + estilos base decentes | polimento sistemático, consistência, estados hover/loading/erro |
| 4 | **RBAC backend pronto** (`requireInventoryRole` em todas as mutações; `ROLE_LEVEL`) + UI de papéis em `InventorySettingsPage` | auditar cada rota de mutação; nomear papéis "Administrador/Operador/Consulta" na UI; documentar matriz |
| 5 | `exportInventoryEquipmentCsv` (CSV, só categoryId) + rota `reports/equipment.csv` | aplicar TODOS os filtros; CSV de movimentações e de auditoria; export por setor/usuário/tipo/status; PDF |
| 6 | `AuditLog` + `recordAuditEvent` em todas as mutações; `listInventoryAudit` + rota | **capturar valores antes/depois** no metadata; tela de Auditoria (admin) com busca/filtros por ação/entidade/usuário/data |
| 7 | backend `create/updateDepartment` c/ `active` e trava de inativação (impede desativar setor com pessoas/equip.) | UI dedicada de setores (hoje só dentro de settings?) com listar/criar/editar/inativar/ver vínculos |
| 8 | `getEquipment` inclui `movements`; detalhe renderiza timeline de movimentos | somar eventos de `AuditLog` (cadastro/alterações/status/baixa) à timeline; rotular tipos |
| 9 | `listEquipment` busca q (patrimônio/tag/nome/série/holder/specs) + status/category/holder/department/location; UI expõe q/status/category/department | expor filtro de local; ordenação; busca por marca/modelo (estão em specs → q já cobre); persistência via querystring |
| 10 | paginação (pageSize 25 fixo), contagem, tableWrap | ordenar por coluna (precisa param `sort`/`dir` no service+schema+rota), seleção de colunas, pageSize configurável, filtros na URL |
| 11 | detalhe existe | reorganizar em seções nomeadas |
| 12 | Zod + RBAC + revision + unique | revisão final + mensagens |
| 13 | — | conforme couber |

## 4. Plano de implementação (ordem sugerida)

Fazer em fatias que compilam e passam nos testes a cada etapa. Priorizar 1→2→3
(mais visível) e depois backend (4/5/6/7/8).

### Fatia A — Layout e base visual (pontos 1, 3)
- `app/globals.css`: para telas de inventário, elevar `max-width` do `.app-shell__main`
  (ex.: `:has(.module)` → `max-width: none` ou 1600px). Já existe o padrão do editor:
  `.app-shell__main:has(.app-editor-page){max-width:none}` — replicar com `.module`.
- Revisar densidade de tabela, paddings de card/filtro, tipografia. Sem exageros.

### Fatia B — Tabela e filtros do inventário (pontos 2, 9, 10)
- `schemas.ts` `equipmentListQuerySchema`: adicionar `sort` (ex.: patrimony|name|
  category|status|holder|department|location|updatedAt) e `dir` (asc|desc); permitir
  `pageSize` configurável (limite p/ evitar abuso).
- `service.ts` `listEquipment`: aplicar `orderBy` conforme sort/dir; manter fallback
  determinístico `{ id: 'asc' }`.
- `EquipmentListPage.tsx`: cabeçalhos clicáveis p/ ordenar; filtro de Local; persistir
  filtros na querystring (`useSearchParams`/`router.replace`); seletor de colunas
  (guardar em `localStorage`); contagem já existe; ações rápidas.
- Ponto 2: simplificar a sub-nav / tornar Equipamentos o landing natural. **Antes de
  remover abas, confirmar com o usuário o que é a "separação"** (pode ser só a
  quantidade de módulos no topo). Mudança destrutiva de navegação = pergunta legítima.

### Fatia C — Auditoria antes/depois + tela (pontos 6, 8)
- Introduzir captura de before/after. Opção pragmática e seseura: em `updateEquipment`/
  `updatePerson`/`transferEquipment`/`update*`, montar um diff `{campo:{de,para}}`
  apenas dos campos escalares alterados (NUNCA specs PASSWORD; redigir specs) e passar
  em `metadata.changes`. Cuidar do tamanho do JSON.
- `report-service.listInventoryAudit`: já lista; adicionar filtros por `action`,
  `entityType`, `entityId`, `bitrixUserId`, intervalo de datas (`from`/`to`).
- Nova tela de Auditoria (admin): componente + `page.tsx` em
  `app/(embedded)/inventory/audit/page.tsx` + item no NAV_ITEMS só p/ `canAdmin`.
- Timeline do detalhe (ponto 8): mesclar movimentos + eventos de AuditLog do
  equipamento (buscar `auditLog` where entityType=InventoryEquipment, entityId=id)
  numa linha do tempo unificada, rotulada por tipo.

### Fatia D — Exportações filtradas + PDF (ponto 5)
- Generalizar `exportInventoryEquipmentCsv` p/ aceitar o MESMO objeto de filtros do
  `listEquipment` (q/status/category/holder/department/location/archived/sort).
- Rota `reports/equipment.csv`: repassar os filtros da querystring.
- Adicionar CSV de movimentações (`reports/movements.csv`) e de auditoria
  (`reports/audit.csv`), respeitando filtros.
- `EquipmentListPage`/`ReportsPage`: botão "Exportar" que anexa os filtros atuais à URL
  do CSV. XLSX é opcional (CSV com `;`+BOM já abre no Excel PT-BR). PDF: avaliar lib;
  se pesado, gerar via HTML de impressão (`@media print` já existe no module.css).

### Fatia E — Gestão de setores (ponto 7) e locais
- UI dedicada: `app/(embedded)/inventory/departments/page.tsx` (+ item de nav admin).
  Listar (com contagem de pessoas/equip. — já vem em `listDepartments`), criar, editar,
  ativar/inativar (backend já impede inativar com vínculos), ver equipamentos do setor
  (link filtrando a lista por `departmentId`). Reaproveitar padrão de locais/categorias
  que já estão em `InventorySettingsPage`.

### Fatia F — Detalhe em seções (ponto 11)
- `EquipmentDetailPage.tsx`: agrupar em Identificação / Situação / Informações
  adicionais / Histórico (timeline da Fatia C).

### Fatia G — Nomear papéis + revisão de segurança (pontos 4, 12, 13)
- UI: rotular ADMIN=Administrador, OPERATOR=Operador, VIEWER=Consulta; texto das
  permissões. Backend já pronto — só auditar que nenhuma rota de mutação está sem
  `requireInventoryRole`.
- Revisão final: mensagens de erro amigáveis, duplicidade, integridade.

## 5. Armadilhas conhecidas (não repetir)
- `$queryRaw` no Neon: colunas tipo `name`/`regclass` precisam de `::text`.
- Não quebrar `BX24.installFinish()` na página de sucesso de instalação (há teste).
- Sessão exige relógio correto (handshake TTL ~60s) — não é bug de código.
- CSP/frame-ancestors controlados por env (`BITRIX_EXTRA_FRAME_ANCESTORS`).
- `service.test.ts`/`schemas.test.ts` cobrem o serviço — rodar `npm test` a cada fatia.
- Ao adicionar campo obrigatório/alterar tipo de campo dinâmico há travas de segurança
  de dados existentes (ver `updateCategoryField`). Não afrouxar.
- Segredos: campos PASSWORD nunca saem pela API nem entram em auditoria/CSV.

## 6. Progresso desta sessão
- [x] Fatia A — o Inventário ocupa a largura disponível dentro do shell e as
      tabelas/filtros receberam densidade corporativa.
- [x] Fatia B — lista de equipamentos com filtros combináveis na URL,
      paginação configurável e ordenação no backend/UI; pessoas na tabela levam
      à ficha do colaborador.
- [x] Fatia F (parte visual) — detalhe de equipamento organizado em seções.
- [x] Linhas corporativas — novo modelo independente, migration local não aplicada,
      API com RBAC, normalização de telefone sem amarrar operadora, histórico
      append-only, auditoria, lista/filtros e vínculo opcional com colaborador e
      equipamento. A tela permite pesquisar e selecionar o aparelho (inclusive
      desvincular), sem exigir ID manual.
- [x] Ficha do colaborador — inclui linhas corporativas, ramais, equipamento
      atual, movimentações e alterações relevantes, com links para as fichas.
- [x] Importação administrativa XLSX/CSV — upload -> detecção de abas/modelo ->
      mapeamento/validação -> prévia/conflitos -> confirmação -> relatório. A
      prévia não escreve dados e não persiste colunas de senha/token/credencial.
      Smartphones podem gerar até duas linhas corporativas; vínculos ambíguos
      ficam para revisão. Estratégias: parar para revisar, ignorar, ou atualizar
      correspondências seguras. Eventos de linha importados recebem origem IMPORT.
- [x] Verificações executadas: `prisma format`, `prisma validate`, `prisma generate`,
      `npm run typecheck`, `npm run lint`, `npm test` (39 arquivos / 157 testes)
      e `npm run build`.
- [ ] Fatia C — a auditoria geral antes/depois e a tela administrativa dedicada
      ainda devem ser concluídas para todas as entidades legadas.
- [ ] Fatia D — exportações de movimentação/auditoria e propagação integral de
      todos os filtros continuam pendentes.
- [ ] Fatia E — página dedicada de gestão de setores/locais continua pendente.
- [ ] Validação humana pendente: não há `docs/import-samples/` neste repositório;
      testar em homologação com planilhas reais antes de aplicar a migration ou
      confirmar importações em produção.

Atualize esta seção conforme avançar.

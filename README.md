# Inventário de TI — Bitrix24

Sistema de inventário de equipamentos de TI da Hecke, rodando como
**Aplicativo Local (embedded)** do Bitrix24. Substitui o sistema anterior em
Flask/SQLite, preservando os dados e o histórico de movimentações.

É um **serviço separado** do "Portal de Solicitações" (formulários e fluxos de
aprovação): repositório próprio, deploy próprio e **banco próprio**. Os dois
compartilham apenas o padrão de integração com o Bitrix24 — nunca a mesma base.
O motivo é técnico, não estético: `BitrixPortal.domain`/`memberId` são únicos e
guardam um único par de tokens por portal, com `sessionVersion` incrementado a
cada instalação. Dois aplicativos gravando o mesmo registro sobrescreveriam os
tokens um do outro e derrubariam as sessões do outro app.

## O que o sistema faz

- **Equipamentos** com campos técnicos por categoria (10 categorias, 78 campos):
  desktop, notebook, monitor, smartphone, tablet, coletor, rádio, servidor,
  impressora e equipamento de rede.
- **Custódia e histórico**: quem está com cada equipamento, de quem para quem
  e quando. Movimentações são append-only, com controle otimista por `revision`.
- **Transferência individual e em lote** (mover a carteira inteira de um
  colaborador numa única transação atômica).
- **Termos** de entrega/responsabilidade/devolução/transferência, com snapshot
  imutável dos itens e página imprimível.
- **Anexos** (nota fiscal, termo assinado) no Vercel Blob, com download
  autorizado por rota — a URL do blob nunca é exposta em listagem.
- **Locais/filiais**, setores, colaboradores, ramais e recebimentos.
- **Módulos personalizados**: abas com campos definidos pelo usuário, sem
  programação.
- **Relatórios**: vencimentos (garantia e datas de alerta), movimentações,
  auditoria e exportação CSV compatível com Excel.
- **Permissões** por papel (`ADMIN`, `OPERATOR`, `VIEWER`); administrador do
  portal recebe `ADMIN` automaticamente. Toda rota reautoriza no servidor.

## Stack

- **Next.js 15** (App Router) — front-end e back-end no mesmo deploy (Vercel)
- **Prisma + Postgres (Neon)** — schema em `prisma/schema.prisma`
- **Inngest** — sincronização de usuários/departamentos do Bitrix24
- **Vercel Blob** — bytes dos anexos
- **Vitest** — testes

## Rodar localmente

```bash
npm ci
cp .env.example .env    # preencher DATABASE_URL, DIRECT_URL, SESSION_JWT_SECRET...
npm run db:migrate:deploy
npm run dev
```

As telas só abrem **dentro do iframe do Bitrix24** (o token de sessão existe
apenas em memória, por decisão de segurança). Em `localhost`, fora do portal, a
aplicação responde "precisa ser aberto de dentro do Bitrix24" — isso é o
comportamento correto, não um erro.

## Comandos

| Comando                     | O que faz                                  |
| --------------------------- | ------------------------------------------ |
| `npm run dev`               | servidor de desenvolvimento                |
| `npm test`                  | suíte Vitest                               |
| `npm run typecheck`         | `tsc --noEmit`                             |
| `npm run lint`              | ESLint                                     |
| `npm run build`             | build de produção                          |
| `npm run check:env`         | conferir variáveis de ambiente             |
| `npm run db:migrate:deploy` | aplicar migrations (produção)              |
| `npm run db:studio`         | Prisma Studio                              |
| `npm run inventory:import`  | importar o corte do sistema Flask (ver abaixo) |

## Documentação

- [`docs/inventario-bitrix.md`](docs/inventario-bitrix.md) — decisões de
  arquitetura, permissões, anexos, migração de dados e publicação
- [`docs/inventory-import.md`](docs/inventory-import.md) — procedimento de
  importação do sistema antigo
- [`docs/homologacao-bitrix24.md`](docs/homologacao-bitrix24.md) — cadastro do
  Aplicativo Local no portal e checklist de homologação
- [`docs/migrations.md`](docs/migrations.md) — regras de migration

## Importação do sistema antigo

O importador parte de um JSON exportado do sistema Flask, exige o portal de
destino explicitamente, oferece `--dry-run`, calcula SHA-256 do corte e é
idempotente (o mesmo snapshot rodado duas vezes é ignorado):

```bash
npm run inventory:import -- --file ./export_inventario.json --portal <BitrixPortal.id> --dry-run
npm run inventory:import -- --file ./export_inventario.json --portal <BitrixPortal.id> --apply
```

Senhas em texto puro encontradas no legado **não são migradas** — o importador
descarta qualquer valor de campo marcado como `PASSWORD`. O JSON do corte não
deve ser versionado.

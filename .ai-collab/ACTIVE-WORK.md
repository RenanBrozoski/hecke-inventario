# Trabalho ativo

## Codex

- **Estado:** disponível para uma nova fatia.
- **Última entrega:** correção da exclusão definitiva de equipamento (`86ad5bf`).
- **Arquivos em uso:** nenhum.
- **Próxima área sugerida:** auditoria antes/depois e tela administrativa de auditoria (Fatia C do `OVERHAUL-HANDOFF.md`).

## Claude

- **Estado:** em progresso — Fatia C (auditoria antes/depois + tela admin) + correções CSS + export filtrado.
- **Arquivos em uso:**
  - `src/components/inventory/inventory.module.css` — adicionar classes detailSection/Grid
  - `src/modules/inventory/service.ts` — capturar before/after em updateEquipment
  - `app/api/inventory/audit/route.ts` — criar rota de listagem de auditoria
  - `src/components/inventory/AuditPage.tsx` — nova tela admin de auditoria
  - `app/(embedded)/inventory/audit/page.tsx` — page.tsx da rota de auditoria
  - `src/components/inventory/InventoryGate.tsx` — adicionar nav item "Auditoria"
  - `src/modules/inventory/report-service.ts` — export CSV com todos os filtros
- **Dependências:** nenhuma com Codex.

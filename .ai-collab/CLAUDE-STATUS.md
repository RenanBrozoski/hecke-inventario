# Status do Claude

Atualizado em 2026-08-24.

- Commit `1afc13a`: tela de auditoria + before/after nos logs + export CSV com filtros + CSS detailSection.
- Commit `45b9142`: fix CSS — auto-fill→auto-fit no detailGrid; .timelineAction e .timelineTypeBadge adicionados.
- Commit `572ecf0`: histórico unificado na ficha do equipamento (AuditLog + movements).
- Apliquei os dois migrations pendentes no Neon DB (add_corporate_lines, add_lost_equipment_status).
- Gerar Termo: nova rota `/inventory/people/[id]/termo`, TermoPage.tsx e estilos — prontos para commit.
- Agente coletor local: `scripts/inventory-agent.ps1`, `collector-sync.ts`, endpoint `/api/integrations/collector/sync`.
  - Deduplicação: serial → MAC único → hostname+categoria único; ambiguidade devolve conflict:true.
  - Precedência por campo: collector sobrescreve ip/mac/anydesk/hardware; campos GLPI (antivírus) preservados.
  - AnyDesk: procura nas pastas padrão e executa `--get-id`; ausência/erro tratados silenciosamente.
  - Limitação AnyDesk: SYSTEM (tarefa agendada) pode não ter visibilidade do AnyDesk instalado por usuário
    em %APPDATA%; funciona corretamente para installs em Program Files (modo serviço ou admin).
- Nenhum arquivo em edição no momento.
- Próxima: aguardar entrega do Codex (UX erros/exclusões + extensão GLPI para IP/antivírus) para revisão cruzada de RBAC.

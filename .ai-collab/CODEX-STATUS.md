# Status do Codex

Atualizado em 2026-08-24.

- Li integralmente `OVERHAUL-HANDOFF.md`.
- `AI-COLLAB-CURRENT-WORK.md` e `AI-COLLAB-SUGGESTED-IMPROVEMENTS.md` não foram localizados nesta cópia, no remoto `origin/main`, nem nas pastas de projetos verificadas. Aguardando o caminho exato caso estejam em outra área.
- A estrutura de colaboração foi criada agora, pois não existia.
- Última alteração publicada: `86ad5bf fix: concluir exclusão sem tabelas auxiliares`.
- Validação da última entrega: typecheck, lint e 160 testes passaram; exclusão real do equipamento de teste GLPI PC026 foi concluída.
- Última entrega: `776f491 fix: sincronizar especificações completas do GLPI`.
- O teste real sincronizou o PC026: 16 GB de RAM, 2 módulos e MAC de cabo/Wi-Fi
  separados. A TAG patrimonial não é alterada pelo GLPI; o identificador secundário
  do GLPI é guardado somente em `specs.glpi.otherSerial`.
- O GLPI atual não informou OS, CPU, GPU, IP ou antivírus; quando esses dados forem
  retornados, o conector os persiste sem apagar dados preenchidos manualmente.
- Entrega concluída: gestão de Setores e Locais evoluída na tela existente de
  Configurações. Inclui busca, contagem de vínculos, atalho para equipamentos filtrados,
  edição, inativação e exclusão definitiva limitada a cadastros sem dependências.
- Validações executadas: `npm run typecheck`, `npm run lint` e `npm test`
  (41 arquivos / 165 testes).
- Não há arquivos do código em edição neste momento.

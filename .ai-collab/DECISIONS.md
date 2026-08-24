# Decisões

## 2026-08-24 — exclusão definitiva tolera a ausência da tabela de linhas corporativas

- **Problema:** o banco de produção ainda não tem a tabela de linhas corporativas, e a exclusão de equipamento falhava antes de removê-lo.
- **Decisão:** verificar a disponibilidade dessa tabela antes da transação; quando ausente, excluir os vínculos que existem e o equipamento, preservando a operação.
- **Impacto:** a exclusão administrativa volta a funcionar enquanto a migration pendente não é aplicada.

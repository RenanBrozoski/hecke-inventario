# Importação do Inventário legado

O importador é um CLI administrativo e nunca escolhe o portal automaticamente.
Antes de usá-lo, aplique a migration do módulo pelo processo normal de release
e configure `DIRECT_URL` (preferencial) ou `DATABASE_URL`.

## Validação sem escrita

```bash
npm run inventory:import -- \
  --file "C:/corte/export_inventario.json" \
  --portal "<BitrixPortal.id>" \
  --dry-run
```

`--dry-run` pode consultar o portal, os espelhos do Bitrix e os imports
anteriores, mas não abre transação nem cria/atualiza registros.

## Aplicação

Após revisar o relatório do dry-run:

```bash
npm run inventory:import -- \
  --file "C:/corte/export_inventario.json" \
  --portal "<BitrixPortal.id>" \
  --apply
```

O CLI exige exatamente um modo: `--dry-run` ou `--apply`. Se já houver outro
snapshot concluído para o portal, um arquivo diferente é bloqueado. Para
validar ou aplicar deliberadamente um novo corte, acrescente
`--allow-new-snapshot` e revise novamente as contagens.

## Garantias

- aceita o export legado v1 e o export seguro v2;
- no v2, confere integridade declarada, manifesto de contagens e fingerprint
  SHA-256 sobre codificação tipada UTF-8/IEEE-754 idêntica em Python e
  JavaScript; em ambos calcula SHA-256 dos bytes originais;
- valida enums, IDs, referências e chaves naturais antes da escrita;
- remove valores de campos `PASSWORD` do v1 e rejeita um v2 que ainda os
  contenha;
- normaliza campos dinâmicos conforme o `FieldType`: números em texto viram
  JSON number, booleanos legados viram `true`/`false` e datas brasileiras são
  convertidas para `AAAA-MM-DD`; MAC/IP inválidos são preservados numa
  quarentena visível por equipamento e os demais valores incompatíveis
  bloqueiam a carga;
- usa `portalId + legacySource + legacyId` nos upserts;
- executa a carga e a verificação final em uma única transação com timeout;
- preserva portador, setor, local e status atuais exatamente como exportados;
  as movimentações são importadas depois e nunca recalculam a posse;
- uma segunda execução do mesmo hash/fingerprint retorna `skipped`;
- `usuarios_sistema` é apenas contabilizado e nunca vira `BitrixUser`;
- anexos legados contêm somente metadados, sem bytes. Eles são contabilizados,
  reportados e pulados até existir uma migração de blobs.

## Reconciliação

Setores são associados somente por nome normalizado único. Pessoas são
associadas automaticamente por e-mail exato e único ou por nome normalizado
único com setor Bitrix confirmado. Qualquer evidência insuficiente fica
`AMBIGUOUS`/`UNMATCHED`; não existe associação fuzzy automática. Vínculos
revisados manualmente não são sobrescritos por um novo snapshot.

## Relatório

A saída JSON inclui hashes, formato, contagens de origem, saneamento de
segredos, registros pulados, resumo da reconciliação e, no modo de aplicação,
as contagens verificadas dentro da transação. `InventoryImportRun` registra o
mesmo resumo; em falha, todas as entidades são revertidas e a tentativa é
marcada como `FAILED` separadamente quando o banco continuar acessível.

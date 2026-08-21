# Inventário no Bitrix24

Este documento registra o port do Inventário Hecke (Flask/SQLite) para o
aplicativo Next.js embutido no Bitrix24.

## Decisões de arquitetura

- O inventário é um domínio próprio, multiportal. Toda consulta e mutação é
  escopada pelo `portalId` obtido da sessão autenticada; o cliente nunca envia
  nem escolhe esse valor.
- `InventoryPerson` e `InventoryDepartment` preservam os cadastros e snapshots
  do legado. O vínculo com `BitrixUser`/`BitrixDepartment` é opcional e serve
  somente para reconciliação. Os espelhos sincronizados do Bitrix não recebem
  os 276 colaboradores antigos.
- Posse e setor atuais em `InventoryEquipment` são a fonte canônica. O legado
  tem apenas 178 movimentações para 422 equipamentos e não permite reconstruir
  o estado atual a partir do histórico.
- `InventoryMovement` é append-only. Transferência, atualização do equipamento
  e auditoria acontecem na mesma transação, com controle otimista por `revision`.
- IDs do SQLite são preservados como `legacySource` + `legacyId`, nunca como PK
  global. Essa chave também torna o import idempotente.
- Exclusão funcional usa arquivamento/status. Registros históricos não são
  apagados em cascata.
- Transferências em lote usam CAS por equipamento e são atômicas: atualizam
  a custódia, criam os movimentos, o termo opcional e a auditoria na mesma
  transação.
- Relatórios reúnem garantias e datas de alerta dos módulos personalizados,
  movimentações e auditoria. A exportação CSV é compatível com Excel,
  neutraliza fórmulas e nunca inclui campos `PASSWORD`.

## Permissões

Administradores do portal recebem `ADMIN` automaticamente pela regra central do
aplicativo. Para os demais usuários, `InventoryRoleAssignment` aceita:

- `OPERATOR`: consulta e operações de cadastro/transferência;
- `VIEWER`: somente consulta/exportação;
- `ADMIN`: configuração e concessão de acesso ao módulo.

Sem atribuição explícita, o acesso ao módulo é negado. Todas as
rotas repetem a autorização no servidor; esconder um botão na interface não é
considerado controle de acesso.

## Migração dos dados

O corte legado esperado possui:

| Conjunto                     | Quantidade |
| ---------------------------- | ---------: |
| Categorias / campos          |    10 / 78 |
| Setores / locais             |     46 / 5 |
| Colaboradores                |        276 |
| Equipamentos                 |        422 |
| Movimentações                |        178 |
| Ramais / recebimentos        |   49 / 226 |
| Módulos / campos / registros |  1 / 5 / 2 |
| Termos / anexos              |      0 / 0 |

O importador exige o portal de destino explicitamente, oferece `--dry-run`,
calcula SHA-256, valida referências/contagens e registra um
`InventoryImportRun`. Uma segunda execução do mesmo snapshot é ignorada. Um
snapshot diferente exige confirmação explícita.

### Reconciliação Bitrix

O conjunto atual não possui e-mail, matrícula, cargo ou vínculo preenchidos nos
276 colaboradores. Portanto:

1. setores são comparados por nome normalizado e único;
2. e-mail exato e único tem prioridade quando existir em cortes futuros;
3. nome normalizado só é associado automaticamente quando for único nos dois
   lados e o setor também for compatível;
4. correspondência sem evidência suficiente fica `AMBIGUOUS` ou `UNMATCHED`
   para revisão manual; fuzzy matching nunca efetiva o vínculo sozinho.

## Tratamento de credenciais legadas

Foram encontrados 91 valores de `senha_email` em texto puro no SQLite e no
primeiro JSON de exportação. Eles **não são migrados**. O exportador seguro e o
importador removem qualquer valor cujo campo esteja configurado como
`PASSWORD`; as APIs também nunca devolvem esses valores em `specs`.

O JSON de corte não deve ser versionado. As credenciais encontradas devem ser
tratadas como expostas e rotacionadas ou movidas para um gerenciador de
segredos apropriado.

## Anexos

Equipamentos, colaboradores, termos e registros personalizados aceitam PDF,
imagens, documentos do Office, TXT e CSV de até 4 MB. O servidor confere em
conjunto extensão, MIME e assinatura/conteúdo; apenas renomear um arquivo não
é suficiente para enviá-lo. O alvo polimórfico também precisa existir no mesmo
portal da sessão.

Os bytes ficam no Vercel Blob e exigem `BLOB_READ_WRITE_TOKEN`. Listagens nunca
devolvem a URL pública do blob: o download passa pela API autenticada, valida o
portal e faz proxy do conteúdo com `nosniff`. Metadados e auditoria são gravados
na mesma transação; se ela falhar depois do upload, o blob é removido como
compensação.

O Flask aceitava 20 MB, mas o fluxo autenticado atual passa por uma Vercel
Function e usa 4 MB para permanecer abaixo do limite de request/response da
plataforma. Recuperar 20 MB exige uma fase posterior de upload direto com
callback seguro (e download sem proxy), sem relaxar a autorização.

## Publicação

A migration `20260820143000_add_inventory_module` é exclusivamente aditiva.
Ela deve ser aplicada com `prisma migrate deploy` antes do deploy da versão que
usa o módulo. Nunca usar `prisma db push` nem editar migrations já aplicadas.

Antes do corte definitivo:

1. gerar e revisar um export seguro da base parada;
2. aplicar a migration aditiva no ambiente de destino;
3. executar o importador com `--dry-run` e resolver erros bloqueantes;
4. revisar a reconciliação de pessoas/setores e autorizar o corte;
5. executar `--apply` uma vez e conferir as contagens;
6. validar busca, ficha, transferência, anexos, termos e permissões dentro do iframe;
7. manter o Flask somente leitura durante a janela de conferência.

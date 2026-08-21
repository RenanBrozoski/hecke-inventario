export interface DepartmentHeadLookup {
  bitrixDepartmentId: string
  headBitrixUserId: string | null
}

/**
 * Deriva o gestor do colaborador a partir da estrutura departamental — NUNCA
 * inventa um gestor. Só retorna um ID quando, simultaneamente:
 *
 *   1. o usuário pertence a EXATAMENTE um departamento;
 *   2. esse departamento tem responsável (UF_HEAD) definido;
 *   3. o responsável não é o próprio usuário.
 *
 * Em qualquer outro caso (zero ou múltiplos departamentos, departamento sem
 * responsável, ou responsável igual ao próprio usuário) retorna `null`. Esta é
 * uma inferência heurística baseada na estrutura departamental do Bitrix24 —
 * não uma garantia de "gestor real" — e pode ser revisada em fases futuras
 * (ex.: permitir configurar a regra por formulário).
 */
export function deriveManagerBitrixUserId(
  bitrixUserId: string,
  departmentIds: string[],
  departments: DepartmentHeadLookup[],
): string | null {
  if (departmentIds.length !== 1) return null

  const onlyDepartmentId = departmentIds[0]
  const department = departments.find((d) => d.bitrixDepartmentId === onlyDepartmentId)
  if (!department || !department.headBitrixUserId) return null
  if (department.headBitrixUserId === bitrixUserId) return null

  return department.headBitrixUserId
}

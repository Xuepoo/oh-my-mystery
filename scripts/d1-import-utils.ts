export function escapeSql(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function buildInsertSql(
  tableName: string,
  columns: string[],
  row: Record<string, unknown>,
): string {
  const values = columns.map((column) => escapeSql(row[column])).join(',');
  return `INSERT OR REPLACE INTO ${tableName} (${columns.join(',')}) VALUES(${values});`;
}

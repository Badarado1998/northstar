export function statements(sql: string): string[] {
  return sql.split(';').map(part => part.trim()).filter(part => part.length > 0);
}

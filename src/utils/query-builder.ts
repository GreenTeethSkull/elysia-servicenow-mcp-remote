export function buildSnQuery(query: string, searchFields: string[]): string {
  const trimmed = query.trim();
  if (trimmed.length === 0) return "";

  const conditions = searchFields.map(
    (field) => `${field}CONTAINS${trimmed}`,
  );
  return conditions.join("^OR");
}

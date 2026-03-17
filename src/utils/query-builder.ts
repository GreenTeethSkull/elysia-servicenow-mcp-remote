/**
 * ServiceNow encoded query builder utilities.
 *
 * Builds sysparm_query strings with CONTAINS operators for
 * phrase matching and individual word matching across fields.
 */

/**
 * Build a ServiceNow encoded query string that searches across multiple fields.
 * Uses phrase matching + individual word matching (AND between words, OR between fields).
 */
export function buildSearchQuery(
  query: string,
  searchFields: string[],
): string {
  const trimmed = query.trim();

  if (trimmed.length === 0) {
    return "sys_id=invalid";
  }

  // Exact phrase match across all fields (OR)
  const phraseConditions = searchFields.map(
    (field) => `${field}CONTAINS${trimmed}`,
  );
  let searchQuery = phraseConditions.join("^OR");

  // If multiple words, also try individual word matching
  const words = trimmed.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length > 1) {
    const wordConditions: string[] = [];
    for (const word of words) {
      const fieldConditions = searchFields.map(
        (field) => `${field}CONTAINS${word}`,
      );
      wordConditions.push(`(${fieldConditions.join("^OR")})`);
    }
    // Combine phrase + word matching with OR
    searchQuery = `(${searchQuery})^OR(${wordConditions.join("^")})`;
  }

  return searchQuery;
}

/**
 * Append a status filter to an existing query.
 */
export function appendStatusFilter(
  query: string,
  status: string | undefined,
  openCondition: string,
  closedCondition: string,
): string {
  if (!status || status === "all") return query;

  const stateQuery =
    status === "open" ? openCondition : closedCondition;
  return `(${query})^${stateQuery}`;
}

/**
 * Append a priority filter to an existing query.
 */
export function appendPriorityFilter(
  query: string,
  priority: string | undefined,
): string {
  if (!priority) return query;

  const priorityMap: Record<string, string> = {
    low: "4",
    medium: "3",
    high: "2",
    critical: "1",
  };
  const value = priorityMap[priority];
  if (!value) return query;

  return `(${query})^priority=${value}`;
}

/**
 * Append a category filter to an existing query.
 */
export function appendCategoryFilter(
  query: string,
  category: string | undefined,
): string {
  if (!category) return query;
  return `(${query})^category=${category}`;
}

/**
 * Append an urgency filter to an existing query.
 */
export function appendUrgencyFilter(
  query: string,
  urgency: string | undefined,
): string {
  if (!urgency) return query;

  const urgencyMap: Record<string, string> = {
    low: "3",
    medium: "2",
    high: "1",
  };
  const value = urgencyMap[urgency];
  if (!value) return query;

  return `(${query})^urgency=${value}`;
}

/**
 * Append an impact level filter to an existing query.
 */
export function appendImpactFilter(
  query: string,
  impactLevel: string | undefined,
): string {
  if (!impactLevel) return query;

  const impactMap: Record<string, string> = {
    low: "3",
    medium: "2",
    high: "1",
  };
  const value = impactMap[impactLevel];
  if (!value) return query;

  return `(${query})^impact=${value}`;
}

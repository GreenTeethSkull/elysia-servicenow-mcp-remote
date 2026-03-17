/**
 * Shared formatting utilities for ServiceNow tool responses.
 * Translates ServiceNow values to Spanish and formats display strings.
 */

/**
 * Strip HTML tags from a string and trim whitespace.
 */
export function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, "").trim();
}

/**
 * Extract a preview from a text field, breaking at sentence boundaries.
 */
export function extractPreview(
  text: string | undefined | null,
  maxLength: number,
  fallback = "Sin informacion disponible",
): string {
  if (!text) return fallback;

  const clean = stripHtml(text);
  if (clean.length <= maxLength) return clean;

  const preview = clean.substring(0, maxLength);
  const lastSentence = preview.lastIndexOf(".");
  if (lastSentence > maxLength * 0.5) {
    return preview.substring(0, lastSentence + 1);
  }
  return preview + "...";
}

/**
 * Format an ISO date string for Spanish display.
 */
export function formatDateEs(
  dateString: string | undefined | null,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
  },
  fallback = "Fecha desconocida",
): string {
  if (!dateString) return fallback;
  try {
    return new Date(dateString).toLocaleDateString("es-ES", options);
  } catch {
    return "Fecha invalida";
  }
}

/**
 * Format an ISO date string with time for Spanish display.
 */
export function formatDateTimeEs(
  dateString: string | undefined | null,
  fallback = "Fecha desconocida",
): string {
  return formatDateEs(
    dateString,
    {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
    fallback,
  );
}

// ── Translation maps ──

export function translatePriority(priority: string | undefined | null): string {
  if (!priority) return "Sin prioridad";
  const map: Record<string, string> = {
    "1": "Critica",
    "2": "Alta",
    "3": "Media",
    "4": "Baja",
    Critical: "Critica",
    High: "Alta",
    Medium: "Media",
    Low: "Baja",
  };
  return map[priority] || priority;
}

export function translateUrgency(urgency: string | undefined | null): string {
  if (!urgency) return "Sin urgencia";
  const map: Record<string, string> = {
    "1": "Alta",
    "2": "Media",
    "3": "Baja",
    High: "Alta",
    Medium: "Media",
    Low: "Baja",
  };
  return map[urgency] || urgency;
}

export function translateImpact(impact: string | undefined | null): string {
  if (!impact) return "Sin impacto";
  const map: Record<string, string> = {
    "1": "Alto",
    "2": "Medio",
    "3": "Bajo",
    High: "Alto",
    Medium: "Medio",
    Low: "Bajo",
  };
  return map[impact] || impact;
}

export function translateIncidentState(
  state: string | undefined | null,
): string {
  if (!state) return "Desconocido";
  const map: Record<string, string> = {
    "1": "Nuevo",
    "2": "En Progreso",
    "3": "En Espera",
    "6": "Resuelto",
    "7": "Cerrado",
    "8": "Cancelado",
    New: "Nuevo",
    "In Progress": "En Progreso",
    "On Hold": "En Espera",
    Resolved: "Resuelto",
    Closed: "Cerrado",
    Cancelled: "Cancelado",
  };
  return map[state] || state;
}

export function translateProblemState(
  state: string | undefined | null,
): string {
  if (!state) return "Desconocido";
  const map: Record<string, string> = {
    "1": "Nuevo",
    "2": "En Investigacion",
    "3": "Resuelto",
    "4": "Cerrado",
    "5": "Cancelado",
    New: "Nuevo",
    Open: "Abierto",
    "Under Investigation": "En Investigacion",
    "Root Cause Analysis": "Analisis de Causa Raiz",
    "Fix in Progress": "Solucion en Progreso",
    Resolved: "Resuelto",
    Closed: "Cerrado",
    Cancelled: "Cancelado",
  };
  return map[state] || state;
}

export function translateRequirementState(
  state: string | undefined | null,
): string {
  if (!state) return "Desconocido";
  const map: Record<string, string> = {
    "1": "Nuevo",
    "2": "En Progreso",
    "3": "Completado",
    "4": "Cerrado",
    "5": "Cancelado",
    "-5": "Rechazado",
    New: "Nuevo",
    "In Progress": "En Progreso",
    "Work in Progress": "Trabajo en Progreso",
    Completed: "Completado",
    "Closed Complete": "Cerrado Completo",
    "Closed Incomplete": "Cerrado Incompleto",
    Cancelled: "Cancelado",
    Rejected: "Rechazado",
    Pending: "Pendiente",
    Approved: "Aprobado",
  };
  return map[state] || state;
}

export function translateWorkflowState(
  state: string | undefined | null,
): string {
  if (!state) return "Desconocido";
  const map: Record<string, string> = {
    published: "Publicado",
    draft: "Borrador",
    review: "En Revision",
    approved: "Aprobado",
    retired: "Retirado",
  };
  return map[state.toLowerCase()] || state;
}

/**
 * Format a numeric rating as stars.
 */
export function formatRating(
  rating: unknown,
): string {
  if (!rating) return "Sin calificacion";
  const num =
    typeof rating === "string" ? parseFloat(rating) : Number(rating);
  if (isNaN(num) || num <= 0) return "Sin calificacion";
  const stars = "* ".repeat(Math.min(Math.round(num), 5)).trim();
  return `${stars} (${num.toFixed(1)}/5)`;
}

/**
 * Get a display value from a ServiceNow record field.
 * Handles both string values and display_value objects.
 */
export function getDisplayValue(
  value: unknown,
  fallback = "N/A",
): string {
  if (!value) return fallback;
  if (typeof value === "string") return value || fallback;
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.display_value === "string") return obj.display_value || fallback;
    if (typeof obj.value === "string") return obj.value || fallback;
  }
  return String(value);
}

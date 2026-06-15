export function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, "").trim();
}

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

/**
 * Requirement / Request Item search tool for ServiceNow.
 * Searches the sc_req_item table for service requests.
 */

import { z } from "zod";
import type { ServiceNowClient } from "../services/servicenow-client";
import {
  buildSearchQuery,
  appendStatusFilter,
  appendPriorityFilter,
  appendCategoryFilter,
} from "../utils/query-builder";
import {
  extractPreview,
  formatDateEs,
  formatDateTimeEs,
  translateRequirementState,
  translatePriority,
  getDisplayValue,
} from "../utils/formatters";

// ── Schema ──

export const requirementSearchSchema = {
  query: z
    .string()
    .min(3)
    .max(500)
    .describe("Consulta de busqueda para encontrar requerimientos relevantes"),
  status: z
    .enum(["open", "closed", "all"])
    .default("all")
    .describe(
      "Estado de los requerimientos a buscar: 'open' (abiertos), 'closed' (cerrados), 'all' (todos)",
    ),
  priority: z
    .enum(["low", "medium", "high", "critical"])
    .optional()
    .describe("Filtrar por prioridad especifica (opcional)"),
  category: z
    .string()
    .max(100)
    .optional()
    .describe("Categoria especifica de requerimiento (opcional)"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe(
      "Numero maximo de requerimientos a retornar (por defecto 20, maximo 100)",
    ),
};

// ── Annotations ──

export const requirementSearchAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

// ── Description ──

export const requirementSearchDescription =
  "Busca requerimientos y solicitudes en ServiceNow. " +
  "Encuentra solicitudes de servicios, cambios, nuevas funcionalidades y requerimientos de negocio. " +
  "Util para revisar solicitudes similares, procesos de aprobacion y estado de requerimientos.";

// ── Fields to return ──

const REQUIREMENT_FIELDS = [
  "sys_id",
  "number",
  "short_description",
  "description",
  "state",
  "priority",
  "category",
  "type",
  "requested_for",
  "opened_at",
  "sys_updated_on",
  "business_need",
  "justification",
  "expected_start",
  "expected_end",
].join(",");

// ── Handler ──

export async function handleRequirementSearch(
  client: ServiceNowClient,
  args: {
    query: string;
    status: string;
    priority?: string;
    category?: string;
    limit: number;
  },
): Promise<string> {
  const { query, status, priority, category, limit } = args;

  // Build the encoded query
  const searchFields = ["number", "short_description", "description"];
  let sysparmQuery = buildSearchQuery(query, searchFields);

  // Requirements: open = not Completed/Closed (state != 3 and != 4)
  sysparmQuery = appendStatusFilter(
    sysparmQuery,
    status,
    "state!=3^state!=4",
    "state=3^ORstate=4",
  );
  sysparmQuery = appendPriorityFilter(sysparmQuery, priority);
  sysparmQuery = appendCategoryFilter(sysparmQuery, category);

  // Build URL params
  const params = new URLSearchParams();
  params.set("sysparm_query", `${sysparmQuery}^ORDERBYDESCopened_at`);
  params.set("sysparm_limit", limit.toString());
  params.set("sysparm_fields", REQUIREMENT_FIELDS);

  const response = await client.tableRequest<Record<string, unknown>[]>(
    "sc_req_item",
    params,
  );

  const records = response.result || [];
  const total = response.total ?? records.length;

  // Build active filters summary
  const filters: Record<string, string> = {};
  if (status && status !== "all")
    filters.estado = status === "open" ? "Abiertos" : "Cerrados";
  if (priority) filters.prioridad = translatePriority(priority);
  if (category) filters.categoria = category;

  if (records.length === 0) {
    return JSON.stringify(
      {
        success: true,
        message: `No se encontraron requerimientos para "${query}".`,
        suggestions: [
          status === "open"
            ? "Busca tambien en requerimientos cerrados para ver implementaciones previas"
            : status === "closed"
              ? "Revisa requerimientos abiertos para solicitudes actuales"
              : "Intenta con terminos mas generales",
          "Especifica el tipo de servicio o sistema requerido",
          "Incluye el area de negocio que solicita el requerimiento",
          "Menciona si es un cambio, nueva funcionalidad o mejora",
        ],
        searchMetadata: {
          query,
          status,
          filters,
          timestamp: new Date().toISOString(),
        },
      },
      null,
      2,
    );
  }

  // Format requirements
  const requirements = records.map((record, index) => ({
    position: index + 1,
    number: getDisplayValue(record.number, "N/A"),
    title: getDisplayValue(record.short_description, "Sin titulo"),
    description: extractPreview(record.description as string, 300, "Sin descripcion disponible"),
    state: translateRequirementState(record.state as string),
    priority: translatePriority(record.priority as string),
    category: getDisplayValue(record.category, "Sin categoria"),
    type: getDisplayValue(record.type, "Requerimiento general"),
    requestedFor: getDisplayValue(record.requested_for, "Sin especificar"),
    businessNeed: extractPreview(
      record.business_need as string,
      200,
      "No especificada",
    ),
    justification: extractPreview(
      record.justification as string,
      200,
      "No especificada",
    ),
    openedAt: formatDateTimeEs(record.opened_at as string),
    updatedAt: formatDateTimeEs(record.sys_updated_on as string),
    expectedStart: formatDateEs(record.expected_start as string, undefined, "No especificada"),
    expectedEnd: formatDateEs(record.expected_end as string, undefined, "No especificada"),
    sysId: record.sys_id,
  }));

  const result: Record<string, unknown> = {
    success: true,
    summary: `Se encontraron ${total} requerimiento${total !== 1 ? "s" : ""} para "${query}". Mostrando ${records.length}.`,
    requirements,
    searchMetadata: {
      query,
      status,
      filters,
      totalFound: total,
      returned: records.length,
      hasMore: records.length < total,
      timestamp: new Date().toISOString(),
    },
  };

  if (records.length < total) {
    result.paginationInfo = {
      hasMore: true,
      message:
        `Hay ${total - records.length} requerimientos adicionales disponibles. ` +
        `Para ver mas resultados, aumenta el parametro limit (actual: ${limit}, maximo: 100) ` +
        `o refina la busqueda con terminos mas especificos o filtros adicionales (prioridad, categoria, estado).`,
    };
  }

  return JSON.stringify(result, null, 2);
}

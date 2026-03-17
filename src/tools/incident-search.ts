/**
 * Incident search tool for ServiceNow.
 * Searches the incident table using intelligent queries.
 */

import { z } from "zod";
import type { ServiceNowClient } from "../services/servicenow-client";
import {
  buildSearchQuery,
  appendStatusFilter,
  appendPriorityFilter,
  appendCategoryFilter,
  appendUrgencyFilter,
} from "../utils/query-builder";
import {
  extractPreview,
  formatDateTimeEs,
  translateIncidentState,
  translatePriority,
  translateUrgency,
  translateImpact,
  getDisplayValue,
} from "../utils/formatters";

// ── Schema ──

export const incidentSearchSchema = {
  query: z
    .string()
    .min(3)
    .max(500)
    .describe("Consulta de busqueda para encontrar incidentes relevantes"),
  status: z
    .enum(["open", "closed", "all"])
    .default("all")
    .describe(
      "Estado de los incidentes a buscar: 'open' (abiertos), 'closed' (cerrados), 'all' (todos)",
    ),
  priority: z
    .enum(["low", "medium", "high", "critical"])
    .optional()
    .describe("Filtrar por prioridad especifica (opcional)"),
  category: z
    .string()
    .max(100)
    .optional()
    .describe("Categoria especifica de incidente (opcional)"),
  urgency: z
    .enum(["low", "medium", "high"])
    .optional()
    .describe("Filtrar por urgencia especifica (opcional)"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe(
      "Numero maximo de incidentes a retornar (por defecto 20, maximo 100)",
    ),
};

// ── Annotations ──

export const incidentSearchAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

// ── Description ──

export const incidentSearchDescription =
  "Busca incidentes en ServiceNow utilizando consultas inteligentes. " +
  "Encuentra incidentes reportados, sus resoluciones, soluciones aplicadas y estado actual. " +
  "Util para revisar problemas similares y sus soluciones implementadas.";

// ── Fields to return ──

const INCIDENT_FIELDS = [
  "sys_id",
  "number",
  "short_description",
  "description",
  "state",
  "priority",
  "urgency",
  "category",
  "subcategory",
  "caller_id",
  "assigned_to",
  "assignment_group",
  "opened_at",
  "sys_updated_on",
  "close_notes",
  "resolution_code",
  "resolved_at",
  "closed_at",
].join(",");

// ── Handler ──

export async function handleIncidentSearch(
  client: ServiceNowClient,
  args: {
    query: string;
    status: string;
    priority?: string;
    category?: string;
    urgency?: string;
    limit: number;
  },
): Promise<string> {
  const { query, status, priority, category, urgency, limit } = args;

  // Build the encoded query
  const searchFields = ["short_description", "description", "number"];
  let sysparmQuery = buildSearchQuery(query, searchFields);

  // Incidents: open = not Resolved/Closed (state != 6 and != 7)
  sysparmQuery = appendStatusFilter(
    sysparmQuery,
    status,
    "state!=6^state!=7",
    "state=6^ORstate=7",
  );
  sysparmQuery = appendPriorityFilter(sysparmQuery, priority);
  sysparmQuery = appendCategoryFilter(sysparmQuery, category);
  sysparmQuery = appendUrgencyFilter(sysparmQuery, urgency);

  // Build URL params
  const params = new URLSearchParams();
  params.set("sysparm_query", `${sysparmQuery}^ORDERBYDESCsys_updated_on`);
  params.set("sysparm_limit", limit.toString());
  params.set("sysparm_fields", INCIDENT_FIELDS);

  const response = await client.tableRequest<Record<string, unknown>[]>(
    "incident",
    params,
  );

  const records = response.result || [];
  const total = response.total ?? records.length;

  // Build active filters summary
  const filters: Record<string, string> = {};
  if (status && status !== "all")
    filters.estado = status === "open" ? "Abiertos" : "Cerrados";
  if (priority) filters.prioridad = translatePriority(priority);
  if (urgency) filters.urgencia = translateUrgency(urgency);
  if (category) filters.categoria = category;

  if (records.length === 0) {
    return JSON.stringify(
      {
        success: true,
        message: `No se encontraron incidentes para "${query}".`,
        suggestions: [
          status === "open"
            ? "Busca tambien en incidentes cerrados para ver soluciones implementadas"
            : status === "closed"
              ? "Revisa incidentes abiertos para problemas actuales"
              : "Intenta con terminos mas generales",
          "Incluye codigos de error especificos si los tienes",
          "Menciona el sistema o aplicacion afectada",
          "Describe los sintomas especificos del problema",
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

  // Format incidents
  const incidents = records.map((record, index) => ({
    position: index + 1,
    number: getDisplayValue(record.number, "N/A"),
    title: getDisplayValue(record.short_description, "Sin titulo"),
    description: extractPreview(record.description as string, 300, "Sin descripcion disponible"),
    state: translateIncidentState(record.state as string),
    priority: translatePriority(record.priority as string),
    urgency: translateUrgency(record.urgency as string),
    impact: translateImpact(record.impact as string),
    category: getDisplayValue(record.category, "Sin categoria"),
    subcategory: getDisplayValue(record.subcategory, "N/A"),
    assignedTo: getDisplayValue(record.assigned_to, "Sin asignar"),
    assignmentGroup: getDisplayValue(record.assignment_group, "Sin grupo"),
    caller: getDisplayValue(record.caller_id, "Desconocido"),
    openedAt: formatDateTimeEs(record.opened_at as string),
    updatedAt: formatDateTimeEs(record.sys_updated_on as string),
    resolvedAt: formatDateTimeEs(record.resolved_at as string, "No resuelto"),
    closedAt: formatDateTimeEs(record.closed_at as string, "No cerrado"),
    closeNotes: extractPreview(record.close_notes as string, 200, "Sin notas de cierre"),
    resolutionCode: getDisplayValue(record.resolution_code, "N/A"),
    sysId: record.sys_id,
  }));

  const result: Record<string, unknown> = {
    success: true,
    summary: `Se encontraron ${total} incidente${total !== 1 ? "s" : ""} para "${query}". Mostrando ${records.length}.`,
    incidents,
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
        `Hay ${total - records.length} incidentes adicionales disponibles. ` +
        `Para ver mas resultados, aumenta el parametro limit (actual: ${limit}, maximo: 100) ` +
        `o refina la busqueda con terminos mas especificos o filtros adicionales (prioridad, urgencia, estado).`,
    };
  }

  return JSON.stringify(result, null, 2);
}

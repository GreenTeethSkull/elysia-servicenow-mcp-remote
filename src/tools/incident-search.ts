import { z } from "zod";
import type { ServiceNowClient } from "../services/servicenow-client";
import type { ServiceNowApiResponse } from "../services/servicenow-client";
import { ENDPOINTS } from "../constants";
import { buildSnQuery } from "../utils/query-builder";
import { extractPreview, formatDateTimeEs, getDisplayValue } from "../utils/formatters";

export const incidentSearchSchema = {
  query: z
    .string()
    .min(3)
    .max(500)
    .describe("Texto de busqueda para encontrar incidentes (busca en short_description y description)"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10)
    .describe("Numero maximo de incidentes a retornar (por defecto 20, maximo 100)"),
  assignment_group: z
    .string()
    .max(200)
    .optional()
    .describe("Filtrar por grupo de asignacion especifico (opcional)"),
  state: z
    .string()
    .max(100)
    .optional()
    .describe("Filtrar por estado especifico (opcional)"),
  priority: z
    .string()
    .max(100)
    .optional()
    .describe("Filtrar por prioridad especifica (opcional)"),
  u_categoria: z
    .string()
    .max(100)
    .optional()
    .describe("Filtrar por categoria (opcional)"),
  caller_id: z
    .string()
    .max(200)
    .optional()
    .describe("Filtrar por usuario que reporto el incidente (opcional)"),
};

export const incidentSearchAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

export const incidentSearchDescription =
  "Busca incidentes en ServiceNow. " +
  "Encuentra incidentes reportados, sus resoluciones, soluciones aplicadas y estado actual. " +
  "Util para revisar problemas similares y sus soluciones implementadas.";

export async function handleIncidentSearch(
  client: ServiceNowClient,
  args: {
    query: string;
    limit: number;
    assignment_group?: string;
    state?: string;
    priority?: string;
    u_categoria?: string;
    caller_id?: string;
  },
): Promise<string> {
  const { query, limit, assignment_group, state, priority, u_categoria, caller_id } = args;

  const searchFields = ["short_description", "description"];
  const snQuery = buildSnQuery(query, searchFields);

  const params = new URLSearchParams();
  params.set("sn_query", snQuery);
  params.set("limit", limit.toString());

  if (assignment_group) params.set("assignment_group", assignment_group);
  if (state) params.set("state", state);
  if (priority) params.set("priority", priority);
  if (u_categoria) params.set("u_categoria", u_categoria);
  if (caller_id) params.set("caller_id", caller_id);

  const response = await client.apiRequest<Record<string, unknown>>(
    ENDPOINTS.incidents,
    params,
  );

  const records = response.result?.result || [];
  const meta = response.result?.meta;
  const total = meta?.total ?? records.length;

  if (records.length === 0) {
    return JSON.stringify({
      success: true,
      message: `No se encontraron incidentes para "${query}".`,
      suggestions: [
        "Intenta con terminos mas generales",
        "Incluye codigos de error especificos si los tienes",
        "Menciona el sistema o aplicacion afectada",
        "Describe los sintomas especificos del problema",
      ],
      searchMetadata: { query, totalFound: 0, timestamp: new Date().toISOString() },
    }, null, 2);
  }

  const incidents = records.map((record, index) => ({
    position: index + 1,
    number: getDisplayValue(record.number),
    short_description: getDisplayValue(record.short_description, "Sin titulo"),
    description: extractPreview(record.description as string, 300),
    state: getDisplayValue(record.state),
    priority: getDisplayValue(record.priority),
    urgency: getDisplayValue(record.urgency),
    u_categoria: getDisplayValue(record.u_categoria),
    u_subcategoria_1: getDisplayValue(record.u_subcategoria_1),
    u_subcategoria_2: getDisplayValue(record.u_subcategoria_2),
    u_subcategoria_3: getDisplayValue(record.u_subcategoria_3),
    caller_id: getDisplayValue(record.caller_id),
    assigned_to: getDisplayValue(record.assigned_to, "Sin asignar"),
    assignment_group: getDisplayValue(record.assignment_group, "Sin grupo"),
    opened_at: formatDateTimeEs(record.opened_at as string),
    sys_updated_on: formatDateTimeEs(record.sys_updated_on as string),
    close_notes: extractPreview(record.close_notes as string, 200, "Sin notas de cierre"),
    resolution_code: getDisplayValue(record.resolution_code),
    resolved_at: formatDateTimeEs(record.resolved_at as string, "No resuelto"),
    closed_at: formatDateTimeEs(record.closed_at as string, "No cerrado"),
    sys_id: record.sys_id,
  }));

  const result: Record<string, unknown> = {
    success: true,
    summary: `Se encontraron ${total} incidente${total !== 1 ? "s" : ""} para "${query}". Mostrando ${records.length}.`,
    incidents,
    searchMetadata: {
      query,
      totalFound: total,
      returned: records.length,
      hasMore: records.length < total,
      queryUsed: meta?.query_used,
      timestamp: new Date().toISOString(),
    },
  };

  if (records.length < total) {
    result.paginationInfo = {
      hasMore: true,
      message:
        `Hay ${total - records.length} incidentes adicionales disponibles. ` +
        `Aumenta el parametro limit (actual: ${limit}, max: 100) o refina la busqueda.`,
    };
  }

  return JSON.stringify(result, null, 2);
}

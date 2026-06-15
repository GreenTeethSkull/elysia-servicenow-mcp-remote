import { z } from "zod";
import type { ServiceNowClient } from "../services/servicenow-client";
import type { ServiceNowApiResponse } from "../services/servicenow-client";
import { ENDPOINTS } from "../constants";
import { buildSnQuery } from "../utils/query-builder";
import { extractPreview, formatDateTimeEs, getDisplayValue } from "../utils/formatters";

export const changeSearchSchema = {
  query: z
    .string()
    // .min(3)
    .max(500)
    .optional()
    .describe("Texto de busqueda para encontrar cambios (busca en short_description y description)"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10)
    .describe("Numero maximo de cambios a retornar (por defecto 20, maximo 100)"),
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
  type: z
    .string()
    .max(100)
    .optional()
    .describe("Filtrar por tipo de cambio: Normal, Standard, Emergency (opcional)"),
  priority: z
    .string()
    .max(100)
    .optional()
    .describe("Filtrar por prioridad especifica (opcional)"),
  risk: z
    .string()
    .max(100)
    .optional()
    .describe("Filtrar por nivel de riesgo (opcional)"),
  u_ambiente: z
    .string()
    .max(100)
    .optional()
    .describe("Filtrar por ambiente: development, production, etc. (opcional)"),
};

export const changeSearchAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

export const changeSearchDescription =
  "Busca solicitudes de cambio (change requests) en ServiceNow. " +
  "Encuentra cambios programados, su estado, tipo, riesgo, fechas y elementos de configuracion afectados. " +
  "Util para revisar cambios realizados o planificados en la infraestructura.";

export async function handleChangeSearch(
  client: ServiceNowClient,
  args: {
    query?: string;
    limit: number;
    assignment_group?: string;
    state?: string;
    type?: string;
    priority?: string;
    risk?: string;
    u_ambiente?: string;
  },
): Promise<string> {
  const { query, limit, assignment_group, state, type, priority, risk, u_ambiente } = args;

  const searchFields = ["short_description", "description"];
  // const snQuery = buildSnQuery(query, searchFields);

  const params = new URLSearchParams();
  // params.set("sn_query", snQuery);

  if (query) {
    const snQuery = buildSnQuery(query, searchFields);
    params.set("sn_query", snQuery);
  }

  params.set("limit", limit.toString());

  if (assignment_group) params.set("assignment_group", assignment_group);
  if (state) params.set("state", state);
  if (type) params.set("type", type);
  if (priority) params.set("priority", priority);
  if (risk) params.set("risk", risk);
  if (u_ambiente) params.set("u_ambiente", u_ambiente);

  const response = await client.apiRequest<Record<string, unknown>>(
    ENDPOINTS.changes,
    params,
  );

  const records = response.result?.result || [];
  const meta = response.result?.meta;
  const total = meta?.total ?? records.length;

  if (records.length === 0) {
    return JSON.stringify({
      success: true,
      message: `No se encontraron cambios para "${query}".`,
      suggestions: [
        "Intenta con terminos mas generales",
        "Incluye el numero de cambio (CHG) si lo tienes",
        "Especifica el sistema o elemento de configuracion afectado",
        "Menciona el tipo de cambio: normal, estandar o emergencia",
      ],
      searchMetadata: { query, totalFound: 0, timestamp: new Date().toISOString() },
    }, null, 2);
  }

  const changes = records.map((record, index) => ({
    position: index + 1,
    number: getDisplayValue(record.number),
    short_description: getDisplayValue(record.short_description, "Sin titulo"),
    description: extractPreview(record.description as string, 300),
    state: getDisplayValue(record.state),
    type: getDisplayValue(record.type),
    priority: getDisplayValue(record.priority),
    risk: getDisplayValue(record.risk),
    assignment_group: getDisplayValue(record.assignment_group, "Sin grupo"),
    assigned_to: getDisplayValue(record.assigned_to, "Sin asignar"),
    requested_by: getDisplayValue(record.requested_by),
    start_date: formatDateTimeEs(record.start_date as string, "No programada"),
    end_date: formatDateTimeEs(record.end_date as string, "No programada"),
    sys_created_on: formatDateTimeEs(record.sys_created_on as string),
    sys_updated_on: formatDateTimeEs(record.sys_updated_on as string),
    cmdb_ci: getDisplayValue(record.cmdb_ci, "No especificado"),
    justification: extractPreview(record.justification as string, 200, "No especificada"),
    implementation_plan: extractPreview(record.implementation_plan as string, 200, "No especificado"),
    backout_plan: extractPreview(record.backout_plan as string, 200, "No especificado"),
    close_notes: extractPreview(record.close_notes as string, 200, "Sin notas de cierre"),
    u_ambiente: getDisplayValue(record.u_ambiente),
    u_clase_cambio: getDisplayValue(record.u_clase_cambio),
    u_tipo_tecnologia: getDisplayValue(record.u_tipo_tecnologia),
    u_squad: getDisplayValue(record.u_squad),
    u_asistente_cambio: getDisplayValue(record.u_asistente_cambio),
    sys_id: record.sys_id,
  }));

  const result: Record<string, unknown> = {
    success: true,
    summary: `Se encontraron ${total} cambio${total !== 1 ? "s" : ""} para "${query}". Mostrando ${records.length}.`,
    changes,
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
        `Hay ${total - records.length} cambios adicionales disponibles. ` +
        `Aumenta el parametro limit (actual: ${limit}, max: 100) o refina la busqueda.`,
    };
  }

  return JSON.stringify(result, null, 2);
}

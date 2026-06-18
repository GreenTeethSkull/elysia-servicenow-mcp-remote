import { z } from "zod";
import type { ServiceNowClient } from "../services/servicenow-client";
import type { ServiceNowApiResponse } from "../services/servicenow-client";
import { ENDPOINTS } from "../constants";
import { buildSnQuery } from "../utils/query-builder";
import { extractPreview, formatDateTimeEs, getDisplayValue } from "../utils/formatters";

export const requirementSearchSchema = {
  query: z
    .string()
    // .min(3)
    .max(500)
    .optional()
    .describe("Texto de busqueda para encontrar requerimientos (busca en short_description y description)"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10)
    .describe("Numero maximo de requerimientos a retornar (por defecto 20, maximo 100)"),
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
  approval: z
    .string()
    .max(100)
    .optional()
    .describe("Filtrar por estado de aprobacion (opcional)"),
  u_empresa: z
    .string()
    .max(100)
    .optional()
    .describe("Filtrar por empresa (opcional)"),
};

export const requirementSearchAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

export const requirementSearchDescription =
  "Busca requerimientos y solicitudes de servicio (RITM) en ServiceNow. " +
  "Encuentra solicitudes de servicios, su estado de aprobacion, fechas y responsables. " +
  "Util para revisar solicitudes similares y procesos de aprobacion.";

export async function handleRequirementSearch(
  client: ServiceNowClient,
  args: {
    query?: string;
    limit: number;
    assignment_group?: string;
    state?: string;
    priority?: string;
    approval?: string;
    u_empresa?: string;
  },
): Promise<string> {
  const { query, limit, assignment_group, state, priority, approval, u_empresa } = args;

  const searchFields = [
    "number",
    "short_description",
    "description",
    "state",
    "stage",
    "priority",
    "u_categoria",
    "u_subcategoria_1",
    "u_subcategoria_2",
    "u_subcategoria_3",
    "requested_for",
    "assignment_group",
    "assigned_to",
    "justification",
    "approval",
    "u_empresa",
    "u_categorias_concatenadas",
  ];
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
  if (priority) params.set("priority", priority);
  if (approval) params.set("approval", approval);
  if (u_empresa) params.set("u_empresa", u_empresa);

  const response = await client.apiRequest<Record<string, unknown>>(
    ENDPOINTS.requirements,
    params,
  );

  const records = response.result?.result || [];
  const meta = response.result?.meta;
  const total = meta?.total ?? records.length;

  if (records.length === 0) {
    return JSON.stringify({
      success: true,
      message: `No se encontraron requerimientos para "${query}".`,
      suggestions: [
        "Intenta con terminos mas generales",
        "Especifica el tipo de servicio o sistema requerido",
        "Incluye el area de negocio que solicita el requerimiento",
      ],
      searchMetadata: { query, totalFound: 0, timestamp: new Date().toISOString() },
    }, null, 2);
  }

  const requirements = records.map((record, index) => ({
    position: index + 1,
    number: getDisplayValue(record.number),
    short_description: getDisplayValue(record.short_description, "Sin titulo"),
    description: extractPreview(record.description as string, 300),
    state: getDisplayValue(record.state),
    stage: getDisplayValue(record.stage),
    priority: getDisplayValue(record.priority),
    u_categoria: getDisplayValue(record.u_categoria),
    u_subcategoria_1: getDisplayValue(record.u_subcategoria_1),
    u_subcategoria_2: getDisplayValue(record.u_subcategoria_2),
    u_subcategoria_3: getDisplayValue(record.u_subcategoria_3),
    requested_for: getDisplayValue(record.requested_for),
    assignment_group: getDisplayValue(record.assignment_group, "Sin grupo"),
    assigned_to: getDisplayValue(record.assigned_to, "Sin asignar"),
    opened_at: formatDateTimeEs(record.opened_at as string),
    sys_updated_on: formatDateTimeEs(record.sys_updated_on as string),
    due_date: formatDateTimeEs(record.due_date as string, "Sin fecha limite"),
    justification: extractPreview(record.justification as string, 200, "No especificada"),
    expected_start: formatDateTimeEs(record.expected_start as string, "No especificada"),
    approval: getDisplayValue(record.approval),
    u_empresa: getDisplayValue(record.u_empresa),
    u_categorias_concatenadas: getDisplayValue(record.u_categorias_concatenadas),
    pending_approvers: record.pending_approvers || [],
    sys_id: record.sys_id,
  }));

  const result: Record<string, unknown> = {
    success: true,
    summary: `Se encontraron ${total} requerimiento${total !== 1 ? "s" : ""} para "${query}". Mostrando ${records.length}.`,
    requirements,
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
        `Hay ${total - records.length} requerimientos adicionales disponibles. ` +
        `Aumenta el parametro limit (actual: ${limit}, max: 100) o refina la busqueda.`,
    };
  }

  return JSON.stringify(result, null, 2);
}

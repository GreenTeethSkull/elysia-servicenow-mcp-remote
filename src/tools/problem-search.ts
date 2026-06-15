import { z } from "zod";
import type { ServiceNowClient } from "../services/servicenow-client";
import type { ServiceNowApiResponse } from "../services/servicenow-client";
import { ENDPOINTS } from "../constants";
import { buildSnQuery } from "../utils/query-builder";
import { extractPreview, formatDateTimeEs, getDisplayValue } from "../utils/formatters";

export const problemSearchSchema = {
  query: z
    .string()
    .min(3)
    .max(500)
    .describe("Texto de busqueda para encontrar problemas (busca en short_description y description)"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10)
    .describe("Numero maximo de problemas a retornar (por defecto 20, maximo 100)"),
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
  impact: z
    .string()
    .max(100)
    .optional()
    .describe("Filtrar por nivel de impacto (opcional)"),
  u_categoria: z
    .string()
    .max(100)
    .optional()
    .describe("Filtrar por categoria (opcional)"),
  u_empresa: z
    .string()
    .max(100)
    .optional()
    .describe("Filtrar por empresa (opcional)"),
};

export const problemSearchAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

export const problemSearchDescription =
  "Busca problemas en ServiceNow para analisis de causa raiz. " +
  "Encuentra problemas identificados, sus causas raiz, workarounds y servicios afectados. " +
  "Util para analisis de tendencias y prevencion de incidentes recurrentes.";

export async function handleProblemSearch(
  client: ServiceNowClient,
  args: {
    query: string;
    limit: number;
    assignment_group?: string;
    state?: string;
    priority?: string;
    impact?: string;
    u_categoria?: string;
    u_empresa?: string;
  },
): Promise<string> {
  const { query, limit, assignment_group, state, priority, impact, u_categoria, u_empresa } = args;

  const searchFields = ["short_description", "description"];
  const snQuery = buildSnQuery(query, searchFields);

  const params = new URLSearchParams();
  params.set("sn_query", snQuery);
  params.set("limit", limit.toString());

  if (assignment_group) params.set("assignment_group", assignment_group);
  if (state) params.set("state", state);
  if (priority) params.set("priority", priority);
  if (impact) params.set("impact", impact);
  if (u_categoria) params.set("u_categoria", u_categoria);
  if (u_empresa) params.set("u_empresa", u_empresa);

  const response = await client.apiRequest<Record<string, unknown>>(
    ENDPOINTS.problems,
    params,
  );

  const records = response.result?.result || [];
  const meta = response.result?.meta;
  const total = meta?.total ?? records.length;

  if (records.length === 0) {
    return JSON.stringify({
      success: true,
      message: `No se encontraron problemas para "${query}".`,
      suggestions: [
        "Intenta con terminos mas generales",
        "Incluye terminos relacionados con sintomas o patrones",
        "Especifica el sistema o servicio afectado",
      ],
      searchMetadata: { query, totalFound: 0, timestamp: new Date().toISOString() },
    }, null, 2);
  }

  const problems = records.map((record, index) => ({
    position: index + 1,
    number: getDisplayValue(record.number),
    short_description: getDisplayValue(record.short_description, "Sin titulo"),
    description: extractPreview(record.description as string, 300),
    state: getDisplayValue(record.state),
    priority: getDisplayValue(record.priority),
    impact: getDisplayValue(record.impact),
    u_categoria: getDisplayValue(record.u_categoria),
    u_subcategoria_1: getDisplayValue(record.u_subcategoria_1),
    u_subcategoria_2: getDisplayValue(record.u_subcategoria_2),
    u_subcategoria_3: getDisplayValue(record.u_subcategoria_3),
    assigned_to: getDisplayValue(record.assigned_to, "Sin asignar"),
    assignment_group: getDisplayValue(record.assignment_group, "Sin grupo"),
    sys_created_on: formatDateTimeEs(record.sys_created_on as string),
    sys_updated_on: formatDateTimeEs(record.sys_updated_on as string),
    root_cause: extractPreview(record.root_cause as string, 200, "Pendiente de analisis"),
    work_around: extractPreview(record.work_around as string, 200, "No disponible"),
    business_service: getDisplayValue(record.business_service, "No especificado"),
    related_incidents: getDisplayValue(record.related_incidents, "0"),
    known_error: getDisplayValue(record.known_error),
    u_empresa: getDisplayValue(record.u_empresa),
    sys_id: record.sys_id,
  }));

  const result: Record<string, unknown> = {
    success: true,
    summary: `Se encontraron ${total} problema${total !== 1 ? "s" : ""} para "${query}". Mostrando ${records.length}.`,
    problems,
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
        `Hay ${total - records.length} problemas adicionales disponibles. ` +
        `Aumenta el parametro limit (actual: ${limit}, max: 100) o refina la busqueda.`,
    };
  }

  return JSON.stringify(result, null, 2);
}

/**
 * Problem search tool for ServiceNow.
 * Searches the problem table for root cause analysis.
 */

import { z } from "zod";
import type { ServiceNowClient } from "../services/servicenow-client";
import {
  buildSearchQuery,
  appendStatusFilter,
  appendPriorityFilter,
  appendCategoryFilter,
  appendImpactFilter,
} from "../utils/query-builder";
import {
  extractPreview,
  formatDateTimeEs,
  translateProblemState,
  translatePriority,
  translateImpact,
  getDisplayValue,
} from "../utils/formatters";

// ── Schema ──

export const problemSearchSchema = {
  query: z
    .string()
    .min(3)
    .max(500)
    .describe("Consulta de busqueda para encontrar problemas relevantes"),
  status: z
    .enum(["open", "closed", "all"])
    .default("all")
    .describe(
      "Estado de los problemas a buscar: 'open' (abiertos), 'closed' (cerrados), 'all' (todos)",
    ),
  priority: z
    .enum(["low", "medium", "high", "critical"])
    .optional()
    .describe("Filtrar por prioridad especifica (opcional)"),
  category: z
    .string()
    .max(100)
    .optional()
    .describe("Categoria especifica de problema (opcional)"),
  impactLevel: z
    .enum(["low", "medium", "high"])
    .optional()
    .describe("Filtrar por nivel de impacto especifico (opcional)"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe(
      "Numero maximo de problemas a retornar (por defecto 20, maximo 100)",
    ),
};

// ── Annotations ──

export const problemSearchAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

// ── Description ──

export const problemSearchDescription =
  "Busca problemas en ServiceNow para analisis de causa raiz. " +
  "Encuentra problemas identificados, sus causas raiz, soluciones implementadas y workarounds. " +
  "Util para analisis de tendencias, prevencion de incidentes recurrentes y gestion proactiva.";

// ── Fields to return ──

const PROBLEM_FIELDS = [
  "sys_id",
  "number",
  "short_description",
  "description",
  "problem_statement",
  "state",
  "priority",
  "impact",
  "category",
  "assigned_to",
  "sys_created_on",
  "sys_updated_on",
  "root_cause",
  "workaround",
  "business_service",
  "incident_count",
].join(",");

// ── Handler ──

export async function handleProblemSearch(
  client: ServiceNowClient,
  args: {
    query: string;
    status: string;
    priority?: string;
    category?: string;
    impactLevel?: string;
    limit: number;
  },
): Promise<string> {
  const { query, status, priority, category, impactLevel, limit } = args;

  // Build the encoded query
  const searchFields = [
    "number",
    "short_description",
    "description",
    "problem_statement",
  ];
  let sysparmQuery = buildSearchQuery(query, searchFields);

  // Problems: open = not Resolved/Closed (state != 3 and != 4)
  sysparmQuery = appendStatusFilter(
    sysparmQuery,
    status,
    "state!=3^state!=4",
    "state=3^ORstate=4",
  );
  sysparmQuery = appendPriorityFilter(sysparmQuery, priority);
  sysparmQuery = appendCategoryFilter(sysparmQuery, category);
  sysparmQuery = appendImpactFilter(sysparmQuery, impactLevel);

  // Build URL params
  const params = new URLSearchParams();
  params.set("sysparm_query", `${sysparmQuery}^ORDERBYDESCsys_updated_on`);
  params.set("sysparm_limit", limit.toString());
  params.set("sysparm_fields", PROBLEM_FIELDS);

  const response = await client.tableRequest<Record<string, unknown>[]>(
    "problem",
    params,
  );

  const records = response.result || [];
  const total = response.total ?? records.length;

  // Build active filters summary
  const filters: Record<string, string> = {};
  if (status && status !== "all")
    filters.estado = status === "open" ? "Abiertos" : "Cerrados";
  if (priority) filters.prioridad = translatePriority(priority);
  if (impactLevel) filters.impacto = translateImpact(impactLevel);
  if (category) filters.categoria = category;

  if (records.length === 0) {
    return JSON.stringify(
      {
        success: true,
        message: `No se encontraron problemas para "${query}".`,
        suggestions: [
          status === "open"
            ? "Busca tambien en problemas cerrados para ver analisis de causa raiz completados"
            : status === "closed"
              ? "Revisa problemas abiertos para analisis en curso"
              : "Intenta con terminos mas generales",
          "Incluye terminos relacionados con sintomas o patrones",
          "Especifica el sistema o servicio afectado",
          "Menciona si buscas causas raiz o workarounds",
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

  // Format problems
  const problems = records.map((record, index) => ({
    position: index + 1,
    number: getDisplayValue(record.number, "N/A"),
    title: getDisplayValue(record.short_description, "Sin titulo"),
    description: extractPreview(record.description as string, 300, "Sin descripcion disponible"),
    problemStatement: extractPreview(
      record.problem_statement as string,
      250,
      "No especificada",
    ),
    state: translateProblemState(record.state as string),
    priority: translatePriority(record.priority as string),
    impact: translateImpact(record.impact as string),
    category: getDisplayValue(record.category, "Sin categoria"),
    assignedTo: getDisplayValue(record.assigned_to, "Sin asignar"),
    rootCause: extractPreview(
      record.root_cause as string,
      200,
      "Pendiente de analisis",
    ),
    workaround: extractPreview(
      record.workaround as string,
      200,
      "No disponible",
    ),
    businessService: getDisplayValue(record.business_service, "No especificado"),
    incidentCount: record.incident_count ?? "N/A",
    createdOn: formatDateTimeEs(record.sys_created_on as string),
    updatedOn: formatDateTimeEs(record.sys_updated_on as string),
    sysId: record.sys_id,
  }));

  const result: Record<string, unknown> = {
    success: true,
    summary: `Se encontraron ${total} problema${total !== 1 ? "s" : ""} para "${query}". Mostrando ${records.length}.`,
    problems,
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
        `Hay ${total - records.length} problemas adicionales disponibles. ` +
        `Para ver mas resultados, aumenta el parametro limit (actual: ${limit}, maximo: 100) ` +
        `o refina la busqueda con terminos mas especificos o filtros adicionales (prioridad, impacto, estado).`,
    };
  }

  return JSON.stringify(result, null, 2);
}

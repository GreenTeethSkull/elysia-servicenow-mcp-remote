/**
 * Change Request search tool for ServiceNow.
 * Searches the change_request table for change management records.
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
  translatePriority,
  getDisplayValue,
} from "../utils/formatters";

// ── Schema ──

export const changeSearchSchema = {
  query: z
    .string()
    .min(3)
    .max(500)
    .describe("Consulta de busqueda para encontrar cambios relevantes"),
  status: z
    .enum(["open", "closed", "all"])
    .default("all")
    .describe(
      "Estado de los cambios a buscar: 'open' (abiertos), 'closed' (cerrados), 'all' (todos)",
    ),
  priority: z
    .enum(["low", "medium", "high", "critical"])
    .optional()
    .describe("Filtrar por prioridad especifica (opcional)"),
  type: z
    .enum(["normal", "standard", "emergency"])
    .optional()
    .describe("Tipo de cambio: 'normal', 'standard' (estandar) o 'emergency' (emergencia) (opcional)"),
  risk: z
    .enum(["low", "moderate", "high", "very_high"])
    .optional()
    .describe("Nivel de riesgo del cambio (opcional)"),
  category: z
    .string()
    .max(100)
    .optional()
    .describe("Categoria especifica del cambio (opcional)"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe(
      "Numero maximo de cambios a retornar (por defecto 20, maximo 100)",
    ),
};

// ── Annotations ──

export const changeSearchAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

// ── Description ──

export const changeSearchDescription =
  "Busca cambios (change requests) en ServiceNow. " +
  "Encuentra solicitudes de cambio, su estado, tipo, riesgo, fechas planificadas y elementos de configuracion afectados. " +
  "Util para revisar cambios programados, cambios de emergencia, aprobaciones y el historial de modificaciones en la infraestructura.";

// ── Fields to return ──

const CHANGE_FIELDS = [
  "sys_id",
  "number",
  "short_description",
  "description",
  "state",
  "type",
  "priority",
  "risk",
  "category",
  "assignment_group",
  "assigned_to",
  "requested_by",
  "start_date",
  "end_date",
  "sys_created_on",
  "sys_updated_on",
  "cmdb_ci",
  "justification",
  "implementation_plan",
  "backout_plan",
  "close_notes",
].join(",");

// ── Translation helpers ──

function translateChangeState(state: string | undefined | null): string {
  if (!state) return "Desconocido";
  const map: Record<string, string> = {
    "-5": "Nuevo",
    "-4": "Evaluacion",
    "-3": "Autorizacion",
    "-2": "Programado",
    "-1": "Pendiente de aprobacion",
    "0": "Implementacion",
    "1": "Revision",
    "3": "Cerrado",
    "4": "Cancelado",
    New: "Nuevo",
    Assess: "Evaluacion",
    Authorize: "Autorizacion",
    Scheduled: "Programado",
    Implement: "Implementacion",
    Review: "Revision",
    Closed: "Cerrado",
    Cancelled: "Cancelado",
  };
  return map[state] || state;
}

function translateChangeType(type: string | undefined | null): string {
  if (!type) return "Sin tipo";
  const map: Record<string, string> = {
    normal: "Normal",
    standard: "Estandar",
    emergency: "Emergencia",
    Normal: "Normal",
    Standard: "Estandar",
    Emergency: "Emergencia",
  };
  return map[type] || type;
}

function translateRisk(risk: string | undefined | null): string {
  if (!risk) return "Sin riesgo";
  const map: Record<string, string> = {
    "1": "Muy Alto",
    "2": "Alto",
    "3": "Moderado",
    "4": "Bajo",
    "Very High": "Muy Alto",
    High: "Alto",
    Moderate: "Moderado",
    Low: "Bajo",
  };
  return map[risk] || risk;
}

// ── Handler ──

export async function handleChangeSearch(
  client: ServiceNowClient,
  args: {
    query: string;
    status: string;
    priority?: string;
    type?: string;
    risk?: string;
    category?: string;
    limit: number;
  },
): Promise<string> {
  const { query, status, priority, type, risk, category, limit } = args;

  // Build the encoded query
  const searchFields = ["number", "short_description", "description"];
  let sysparmQuery = buildSearchQuery(query, searchFields);

  // Change requests: open = not Closed/Cancelled (state != 3 and != 4)
  sysparmQuery = appendStatusFilter(
    sysparmQuery,
    status,
    "state!=3^state!=4",
    "state=3^ORstate=4",
  );

  // Priority filter
  sysparmQuery = appendPriorityFilter(sysparmQuery, priority);

  // Category filter
  sysparmQuery = appendCategoryFilter(sysparmQuery, category);

  // Type filter
  if (type) {
    sysparmQuery = `(${sysparmQuery})^type=${type}`;
  }

  // Risk filter
  if (risk) {
    const riskMap: Record<string, string> = {
      low: "4",
      moderate: "3",
      high: "2",
      very_high: "1",
    };
    const riskValue = riskMap[risk];
    if (riskValue) {
      sysparmQuery = `(${sysparmQuery})^risk=${riskValue}`;
    }
  }

  // Build URL params
  const params = new URLSearchParams();
  params.set("sysparm_query", `${sysparmQuery}^ORDERBYDESCsys_updated_on`);
  params.set("sysparm_limit", limit.toString());
  params.set("sysparm_fields", CHANGE_FIELDS);

  const response = await client.tableRequest<Record<string, unknown>[]>(
    "change_request",
    params,
  );

  const records = response.result || [];
  const total = response.total ?? records.length;

  // Build active filters summary
  const filters: Record<string, string> = {};
  if (status && status !== "all")
    filters.estado = status === "open" ? "Abiertos" : "Cerrados";
  if (priority) filters.prioridad = translatePriority(priority);
  if (type) filters.tipo = translateChangeType(type);
  if (risk) filters.riesgo = translateRisk(risk);
  if (category) filters.categoria = category;

  if (records.length === 0) {
    return JSON.stringify(
      {
        success: true,
        message: `No se encontraron cambios para "${query}".`,
        suggestions: [
          status === "open"
            ? "Busca tambien en cambios cerrados para ver implementaciones previas"
            : status === "closed"
              ? "Revisa cambios abiertos para solicitudes actuales"
              : "Intenta con terminos mas generales",
          "Incluye el numero de cambio (CHG) si lo tienes",
          "Especifica el sistema o elemento de configuracion afectado",
          "Menciona el tipo de cambio: normal, estandar o emergencia",
          "Describe el objetivo o justificacion del cambio",
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

  // Format change requests
  const changes = records.map((record, index) => ({
    position: index + 1,
    number: getDisplayValue(record.number, "N/A"),
    title: getDisplayValue(record.short_description, "Sin titulo"),
    description: extractPreview(record.description as string, 300, "Sin descripcion disponible"),
    state: translateChangeState(record.state as string),
    type: translateChangeType(record.type as string),
    priority: translatePriority(record.priority as string),
    risk: translateRisk(record.risk as string),
    category: getDisplayValue(record.category, "Sin categoria"),
    assignmentGroup: getDisplayValue(record.assignment_group, "Sin grupo"),
    assignedTo: getDisplayValue(record.assigned_to, "Sin asignar"),
    requestedBy: getDisplayValue(record.requested_by, "Desconocido"),
    cmdbCi: getDisplayValue(record.cmdb_ci, "No especificado"),
    startDate: formatDateEs(record.start_date as string, undefined, "No programada"),
    endDate: formatDateEs(record.end_date as string, undefined, "No programada"),
    createdOn: formatDateTimeEs(record.sys_created_on as string),
    updatedOn: formatDateTimeEs(record.sys_updated_on as string),
    justification: extractPreview(record.justification as string, 200, "No especificada"),
    implementationPlan: extractPreview(record.implementation_plan as string, 200, "No especificado"),
    backoutPlan: extractPreview(record.backout_plan as string, 200, "No especificado"),
    closeNotes: extractPreview(record.close_notes as string, 200, "Sin notas de cierre"),
    sysId: record.sys_id,
  }));

  const result: Record<string, unknown> = {
    success: true,
    summary: `Se encontraron ${total} cambio${total !== 1 ? "s" : ""} para "${query}". Mostrando ${records.length}.`,
    changes,
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
        `Hay ${total - records.length} cambios adicionales disponibles. ` +
        `Para ver mas resultados, aumenta el parametro limit (actual: ${limit}, maximo: 100) ` +
        `o refina la busqueda con terminos mas especificos o filtros adicionales (prioridad, tipo, riesgo, estado).`,
    };
  }

  return JSON.stringify(result, null, 2);
}

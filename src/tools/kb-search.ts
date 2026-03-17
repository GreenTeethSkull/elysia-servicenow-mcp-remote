/**
 * Knowledge Base search tool for ServiceNow.
 * Searches kb_knowledge articles using intelligent queries.
 */

import { z } from "zod";
import type { ServiceNowClient } from "../services/servicenow-client";
import {
  buildSearchQuery,
  appendCategoryFilter,
} from "../utils/query-builder";
import {
  extractPreview,
  formatDateEs,
  translateWorkflowState,
  formatRating,
  getDisplayValue,
} from "../utils/formatters";

// ── Schema ──

export const kbSearchSchema = {
  query: z
    .string()
    .min(3)
    .max(500)
    .describe(
      "Consulta de busqueda en lenguaje natural para encontrar articulos relevantes en la base de conocimientos",
    ),
  category: z
    .string()
    .max(100)
    .optional()
    .describe(
      "Categoria especifica de conocimiento para filtrar resultados (opcional)",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe(
      "Numero maximo de articulos a retornar (por defecto 20, maximo 100)",
    ),
};

// ── Annotations ──

export const kbSearchAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

// ── Description ──

export const kbSearchDescription =
  "Busca articulos en la base de conocimientos de ServiceNow. " +
  "Ideal para encontrar procedimientos, guias tecnicas, soluciones documentadas y mejores practicas. " +
  "Utiliza busqueda inteligente en titulos y contenido completo de los articulos.";

// ── Fields to return ──

const KB_FIELDS = [
  "sys_id",
  "number",
  "short_description",
  "text",
  "category",
  "article_type",
  "workflow_state",
  "author",
  "sys_created_on",
  "sys_updated_on",
  "view_count",
  "rating",
].join(",");

// ── Handler ──

export async function handleKbSearch(
  client: ServiceNowClient,
  args: {
    query: string;
    category?: string;
    limit: number;
  },
): Promise<string> {
  const { query, category, limit } = args;

  // Build the encoded query
  const searchFields = ["number", "short_description", "text"];
  let sysparmQuery = buildSearchQuery(query, searchFields);
  sysparmQuery = appendCategoryFilter(sysparmQuery, category);

  // Build URL params
  const params = new URLSearchParams();
  params.set("sysparm_query", `${sysparmQuery}^ORDERBYDESCsys_updated_on`);
  params.set("sysparm_limit", limit.toString());
  params.set("sysparm_fields", KB_FIELDS);

  const response = await client.tableRequest<Record<string, unknown>[]>(
    "kb_knowledge",
    params,
  );

  const records = response.result || [];
  const total = response.total ?? records.length;

  if (records.length === 0) {
    return JSON.stringify(
      {
        success: true,
        message: `No se encontraron articulos para "${query}".`,
        suggestions: [
          "Intenta usar terminos tecnicos especificos",
          "Busca procedimientos paso a paso",
          "Incluye el nombre del sistema o aplicacion",
          "Verifica la ortografia de los terminos de busqueda",
          "Usa terminos mas generales o menos especificos",
        ],
        searchMetadata: {
          query,
          category: category || null,
          timestamp: new Date().toISOString(),
        },
      },
      null,
      2,
    );
  }

  // Format articles
  const articles = records.map((record, index) => ({
    position: index + 1,
    number: getDisplayValue(record.number, "N/A"),
    title: getDisplayValue(record.short_description, "Sin titulo"),
    category: getDisplayValue(record.category, "Sin categoria"),
    articleType: getDisplayValue(record.article_type, "Articulo"),
    status: translateWorkflowState(record.workflow_state as string),
    author: getDisplayValue(record.author, "Sin autor"),
    rating: formatRating(record.rating),
    viewCount: record.view_count || 0,
    lastUpdated: formatDateEs(record.sys_updated_on as string),
    content: extractPreview(record.text as string, 200, "Sin contenido disponible"),
    sysId: record.sys_id,
  }));

  const result: Record<string, unknown> = {
    success: true,
    summary: `Se encontraron ${total} resultado${total !== 1 ? "s" : ""} para "${query}". Mostrando ${records.length}.`,
    articles,
    searchMetadata: {
      query,
      category: category || null,
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
        `Hay ${total - records.length} articulos adicionales disponibles. ` +
        `Para ver mas resultados, aumenta el parametro limit (actual: ${limit}, maximo: 100) ` +
        `o refina la busqueda con terminos mas especificos.`,
    };
  }

  return JSON.stringify(result, null, 2);
}

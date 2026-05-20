/**
 * Tool registry - registers all ServiceNow MCP tools on the McpServer.
 *
 * Wraps every tool handler with rate limiting, error handling,
 * and structured logging for full observability.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { ServiceNowClient } from "../services/servicenow-client";
import { ServiceNowApiError } from "../services/servicenow-client";
import { RATE_LIMIT_MAX_CALLS, RATE_LIMIT_WINDOW_MS } from "../constants";
import { logger, generateCorrelationId } from "../services/logger";

// Tool imports
import {
  kbSearchSchema,
  kbSearchAnnotations,
  kbSearchDescription,
  handleKbSearch,
} from "./kb-search";
import {
  incidentSearchSchema,
  incidentSearchAnnotations,
  incidentSearchDescription,
  handleIncidentSearch,
} from "./incident-search";
import {
  problemSearchSchema,
  problemSearchAnnotations,
  problemSearchDescription,
  handleProblemSearch,
} from "./problem-search";
import {
  requirementSearchSchema,
  requirementSearchAnnotations,
  requirementSearchDescription,
  handleRequirementSearch,
} from "./requirement-search";
import {
  changeSearchSchema,
  changeSearchAnnotations,
  changeSearchDescription,
  handleChangeSearch,
} from "./change-search";

// Rate limiting state
let toolCallTimestamps: number[] = [];

/**
 * Summarize tool arguments for logging (truncate long strings, omit sensitive fields).
 */
function summarizeToolArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" && value.length > 150) {
      summary[key] = value.slice(0, 150) + "...";
    } else {
      summary[key] = value;
    }
  }
  return summary;
}

/**
 * Extract a short summary from the tool result for logging.
 * Returns record count and first few chars of the response.
 */
function summarizeToolResult(result: string): {
  responseLength: number;
  recordCount: number | null;
  success: boolean;
} {
  try {
    const parsed = JSON.parse(result);
    let recordCount: number | null = null;
    if (parsed.searchMetadata?.returned) {
      recordCount = parsed.searchMetadata.returned;
    } else if (parsed.articles) {
      recordCount = parsed.articles.length;
    } else if (parsed.incidents) {
      recordCount = parsed.incidents.length;
    } else if (parsed.problems) {
      recordCount = parsed.problems.length;
    } else if (parsed.requirements) {
      recordCount = parsed.requirements.length;
    } else if (parsed.changes) {
      recordCount = parsed.changes.length;
    }
    return {
      responseLength: result.length,
      recordCount,
      success: parsed.success ?? true,
    };
  } catch {
    return {
      responseLength: result.length,
      recordCount: null,
      success: true,
    };
  }
}

/**
 * Wrapper that adds rate limiting, error handling, and structured logging to each tool.
 */
function createToolHandler(
  name: string,
  handler: (args: any) => Promise<string>,
): (args: any) => Promise<CallToolResult> {
  return async (args: any): Promise<CallToolResult> => {
    const callId = generateCorrelationId();
    const startTime = performance.now();
    const toolLog = logger.child({ callId, toolName: name });

    // Rate limiting: max N calls per window
    const windowStart = Date.now() - RATE_LIMIT_WINDOW_MS;
    toolCallTimestamps = toolCallTimestamps.filter((ts) => ts > windowStart);

    if (toolCallTimestamps.length >= RATE_LIMIT_MAX_CALLS) {
      toolLog.warn("Tool call rate limited", {
        currentCalls: toolCallTimestamps.length,
        maxCalls: RATE_LIMIT_MAX_CALLS,
        windowMs: RATE_LIMIT_WINDOW_MS,
      });

      return {
        content: [
          {
            type: "text",
            text: "Rate limit exceeded: Maximum 5 tool calls per 60 seconds. Please try again later.",
          },
        ],
        isError: true,
      };
    }

    toolCallTimestamps.push(Date.now());

    // Log tool call start
    toolLog.info("Tool call started", {
      args: summarizeToolArgs(args),
    });

    try {
      const response = await handler(args);
      const durationMs = Math.round(performance.now() - startTime);
      const resultSummary = summarizeToolResult(response);

      toolLog.info("Tool call completed", {
        durationMs,
        responseLength: resultSummary.responseLength,
        recordCount: resultSummary.recordCount,
        success: resultSummary.success,
      });

      return {
        content: [{ type: "text", text: response }],
      };
    } catch (error: unknown) {
      const durationMs = Math.round(performance.now() - startTime);

      if (error instanceof ServiceNowApiError) {
        let additionalInfo = "";
        if (error.status === 401) {
          additionalInfo =
            " Verifica las credenciales de ServiceNow (usuario y contrasena).";
        } else if (error.status === 403) {
          additionalInfo =
            " El usuario no tiene permisos suficientes para acceder a este recurso.";
        } else if (error.status === 429) {
          additionalInfo =
            " Limite de velocidad alcanzado en ServiceNow. Reintenta en unos minutos.";
        }

        toolLog.error("Tool call failed: ServiceNow API error", {
          durationMs,
          httpStatus: error.status,
          errorBody: error.body ? error.body.slice(0, 500) : undefined,
          errorMessage: error.message,
        });

        return {
          content: [
            {
              type: "text",
              text: `ServiceNow API Error: ${error.message} (HTTP ${error.status}).${additionalInfo}${error.body ? ` Body: ${error.body}` : ""}`,
            },
          ],
          isError: true,
        };
      }

      const message = error instanceof Error ? error.message : String(error);

      toolLog.error("Tool call failed: unexpected error", {
        durationMs,
        errorMessage: message,
        stack: error instanceof Error ? error.stack : undefined,
      });

      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  };
}

/**
 * Register all ServiceNow MCP tools on the given McpServer.
 */
export function registerAllTools(
  server: McpServer,
  client: ServiceNowClient,
): void {
  const toolDefinitions = [
    {
      name: "kb_search",
      description: kbSearchDescription,
      schema: kbSearchSchema,
      annotations: kbSearchAnnotations,
      handler: (args: any) => handleKbSearch(client, args),
    },
    {
      name: "incident_search",
      description: incidentSearchDescription,
      schema: incidentSearchSchema,
      annotations: incidentSearchAnnotations,
      handler: (args: any) => handleIncidentSearch(client, args),
    },
    {
      name: "problem_search",
      description: problemSearchDescription,
      schema: problemSearchSchema,
      annotations: problemSearchAnnotations,
      handler: (args: any) => handleProblemSearch(client, args),
    },
    {
      name: "requirement_search",
      description: requirementSearchDescription,
      schema: requirementSearchSchema,
      annotations: requirementSearchAnnotations,
      handler: (args: any) => handleRequirementSearch(client, args),
    },
    {
      name: "change_search",
      description: changeSearchDescription,
      schema: changeSearchSchema,
      annotations: changeSearchAnnotations,
      handler: (args: any) => handleChangeSearch(client, args),
    },
  ];

  for (const tool of toolDefinitions) {
    server.tool(
      tool.name,
      tool.description,
      tool.schema,
      tool.annotations,
      createToolHandler(tool.name, tool.handler),
    );
  }

  logger.info("MCP tools registered", {
    toolCount: toolDefinitions.length,
    toolNames: toolDefinitions.map((t) => t.name),
  });
}

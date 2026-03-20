/**
 * Tool registry - registers all ServiceNow MCP tools on the McpServer.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { ServiceNowClient } from "../services/servicenow-client";
import { ServiceNowApiError } from "../services/servicenow-client";
import { RATE_LIMIT_MAX_CALLS, RATE_LIMIT_WINDOW_MS } from "../constants";

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
 * Wrapper that adds rate limiting, error handling, and response formatting to each tool.
 */
function createToolHandler(
  name: string,
  handler: (args: any) => Promise<string>,
): (args: any) => Promise<CallToolResult> {
  return async (args: any): Promise<CallToolResult> => {
    const startTime = Date.now();

    // Rate limiting: max N calls per window
    const windowStart = startTime - RATE_LIMIT_WINDOW_MS;
    toolCallTimestamps = toolCallTimestamps.filter((ts) => ts > windowStart);

    if (toolCallTimestamps.length >= RATE_LIMIT_MAX_CALLS) {
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

    toolCallTimestamps.push(startTime);

    try {
      const response = await handler(args);
      return {
        content: [{ type: "text", text: response }],
      };
    } catch (error: unknown) {
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
      console.error(`Tool ${name} error:`, error);
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
  // kb_search
  server.tool(
    "kb_search",
    kbSearchDescription,
    kbSearchSchema,
    kbSearchAnnotations,
    createToolHandler("kb_search", (args) => handleKbSearch(client, args)),
  );

  // incident_search
  server.tool(
    "incident_search",
    incidentSearchDescription,
    incidentSearchSchema,
    incidentSearchAnnotations,
    createToolHandler("incident_search", (args) =>
      handleIncidentSearch(client, args),
    ),
  );

  // problem_search
  server.tool(
    "problem_search",
    problemSearchDescription,
    problemSearchSchema,
    problemSearchAnnotations,
    createToolHandler("problem_search", (args) =>
      handleProblemSearch(client, args),
    ),
  );

  // requirement_search
  server.tool(
    "requirement_search",
    requirementSearchDescription,
    requirementSearchSchema,
    requirementSearchAnnotations,
    createToolHandler("requirement_search", (args) =>
      handleRequirementSearch(client, args),
    ),
  );

  // change_search
  server.tool(
    "change_search",
    changeSearchDescription,
    changeSearchSchema,
    changeSearchAnnotations,
    createToolHandler("change_search", (args) =>
      handleChangeSearch(client, args),
    ),
  );

  console.error("Registered 5 ServiceNow MCP tools.");
}

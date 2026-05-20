/**
 * ElysiaJS HTTP Server with MCP Streamable HTTP transport.
 *
 * This server exposes a single /mcp endpoint that handles:
 * - POST /mcp  -> receives JSON-RPC requests from MCP clients
 * - GET  /mcp  -> returns 405 (stateless mode, no SSE stream needed)
 * - DELETE /mcp -> returns 405 (stateless, no sessions to terminate)
 *
 * Plus utility endpoints:
 * - GET /health -> health check
 * - GET /       -> server info
 */

import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { SERVER_NAME, SERVER_VERSION } from "./constants";
import { ServiceNowClient } from "./services/servicenow-client";
import { getServiceNowEnv } from "./services/servicenow-env";
import { registerAllTools } from "./tools";
import { logger, generateCorrelationId } from "./services/logger";

/**
 * Extract the JSON-RPC method from a parsed MCP request body.
 * MCP uses JSON-RPC 2.0: { jsonrpc, id, method, params }
 */
function extractJsonRpcMethod(body: unknown): {
  method: string;
  id: string | number | null;
  params: unknown;
} {
  if (body && typeof body === "object" && "method" in body) {
    const obj = body as Record<string, unknown>;
    const rawId = obj.id;
    return {
      method: typeof obj.method === "string" ? obj.method : "unknown",
      id: typeof rawId === "string" || typeof rawId === "number" ? rawId : null,
      params: obj.params,
    };
  }
  return { method: "unknown", id: null, params: null };
}

/**
 * Summarize tool call args for logging (truncate long values, omit sensitive data).
 */
function summarizeArgs(args: unknown): Record<string, unknown> | undefined {
  if (!args || typeof args !== "object") return undefined;
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (typeof value === "string" && value.length > 100) {
      summary[key] = value.slice(0, 100) + "...";
    } else {
      summary[key] = value;
    }
  }
  return summary;
}

/**
 * Creates and configures the ElysiaJS application with MCP transport.
 */
export async function createApp() {
  // ── 1. Read and validate environment ──
  const env = getServiceNowEnv();

  // ── 2. Create ServiceNow client with Basic Auth ──
  const snClient = new ServiceNowClient({
    instanceUrl: env.instanceUrl,
    username: env.username,
    password: env.password,
    timeout: env.timeout,
  });

  // ── 3. Test connection to ServiceNow ──
  logger.info("Testing ServiceNow connection", {
    instanceUrl: env.instanceUrl,
  });

  const connectionTest = await snClient.testConnection();
  if (!connectionTest.success) {
    logger.error("ServiceNow connection failed", {
      error: connectionTest.error,
      instanceUrl: env.instanceUrl,
    });
    process.exit(2);
  }
  logger.info("ServiceNow connection established", {
    instanceUrl: env.instanceUrl,
  });

  // ── 4. Create McpServer and register tools ──
  const mcpServer = new McpServer(
    {
      name: "ServiceNow MCP Server (Elysia)",
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  registerAllTools(mcpServer, snClient);

  // ── 5. Build ElysiaJS app ──
  const corsOrigin = process.env.CORS_ORIGIN || "*";

  const app = new Elysia({ aot: true })
    .use(
      cors({
        origin: corsOrigin,
        allowedHeaders: [
          "Content-Type",
          "Accept",
          "Authorization",
          "Mcp-Session-Id",
          "Mcp-Protocol-Version",
        ],
        exposeHeaders: ["Mcp-Session-Id"],
        methods: ["GET", "POST", "DELETE", "OPTIONS"],
      }),
    )

    // ── Request logging (all HTTP requests) ──
    .onRequest(({ request }) => {
      logger.debug("HTTP request received", {
        method: request.method,
        url: request.url,
        userAgent: request.headers.get("user-agent") || undefined,
      });
    })

    // ── Health check ──
    .get("/health", () => {
      logger.debug("Health check requested");
      return {
        status: "healthy",
        service: SERVER_NAME,
        version: SERVER_VERSION,
        timestamp: new Date().toISOString(),
      };
    })

    // ── Server info ──
    .get("/", () => ({
      name: SERVER_NAME,
      version: SERVER_VERSION,
      status: "running",
      transport: "streamable-http",
      endpoints: {
        health: "/health",
        mcp: "/mcp (POST)",
      },
      message: "Send MCP requests via POST to /mcp endpoint",
    }))

    // ── MCP Endpoint: POST /mcp ──
    // Each POST creates a new stateless StreamableHTTPServerTransport
    .post("/mcp", async ({ request, set }) => {
      const correlationId = generateCorrelationId();
      const requestStart = performance.now();

      // Read the raw body
      const rawBody = await request.text();

      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        logger.error("MCP request: invalid JSON body", {
          correlationId,
          rawBodyLength: rawBody.length,
        });
        set.status = 400;
        return {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error: Invalid JSON" },
        };
      }

      // Extract JSON-RPC method for logging
      const { method, id: rpcId, params } = extractJsonRpcMethod(body);

      // For tool calls, extract the tool name from params
      const toolName: string | undefined =
        method === "tools/call" && params && typeof params === "object"
          ? typeof (params as Record<string, unknown>).name === "string"
            ? (params as Record<string, unknown>).name as string
            : undefined
          : undefined;

      // Build args summary for tool calls
      const toolArgs: Record<string, unknown> | undefined =
        method === "tools/call" && params && typeof params === "object"
          ? summarizeArgs((params as Record<string, unknown>).arguments)
          : undefined;

      logger.info("MCP request received", {
        correlationId,
        method,
        rpcId: rpcId != null ? String(rpcId) : undefined,
        toolName: toolName ?? undefined,
        toolArgs,
        clientIp: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
        userAgent: request.headers.get("user-agent") || undefined,
      });

      // Create a stateless HTTP transport for each request
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless - no sessions
      });

      // Bridge Elysia's Web Standard Request to the MCP SDK's Node.js-style API
      return new Promise(async (resolve) => {
        // Build a minimal Node-style response interface
        const chunks: Buffer[] = [];
        let statusCode = 200;
        const responseHeaders: Record<string, string> = {};

        const fakeRes = {
          statusCode: 200,
          headersSent: false,
          _headers: {} as Record<string, string>,
          setHeader(name: string, value: string) {
            this._headers[name.toLowerCase()] = value;
            responseHeaders[name.toLowerCase()] = value;
          },
          getHeader(name: string) {
            return this._headers[name.toLowerCase()];
          },
          writeHead(code: number, headers?: Record<string, string>) {
            statusCode = code;
            this.statusCode = code;
            if (headers) {
              for (const [k, v] of Object.entries(headers)) {
                this.setHeader(k, v);
              }
            }
            return this;
          },
          write(chunk: string | Buffer) {
            chunks.push(
              Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
            );
            return true;
          },
          end(data?: string | Buffer) {
            if (data) {
              chunks.push(
                Buffer.isBuffer(data) ? data : Buffer.from(data),
              );
            }
            this.headersSent = true;

            const responseBody = Buffer.concat(chunks).toString("utf-8");
            const durationMs = Math.round(performance.now() - requestStart);

            set.status = statusCode;
            for (const [k, v] of Object.entries(responseHeaders)) {
              set.headers[k] = v;
            }

            // Try to parse as JSON, otherwise return as text
            try {
              const parsed = JSON.parse(responseBody);

              // Log successful MCP response
              if (statusCode >= 400) {
                logger.warn("MCP request completed with error status", {
                  correlationId,
                  method,
                  rpcId: rpcId != null ? String(rpcId) : undefined,
                  toolName: toolName ?? undefined,
                  statusCode,
                  durationMs,
                });
              } else {
                logger.info("MCP request completed", {
                  correlationId,
                  method,
                  rpcId: rpcId != null ? String(rpcId) : undefined,
                  toolName: toolName ?? undefined,
                  statusCode,
                  durationMs,
                });
              }

              resolve(parsed);
            } catch {
              logger.info("MCP request completed (non-JSON)", {
                correlationId,
                method,
                rpcId,
                statusCode,
                durationMs,
                responseLength: responseBody.length,
              });
              resolve(responseBody);
            }
          },
          on(_event: string, _handler: Function) {
            return this;
          },
          once(_event: string, _handler: Function) {
            return this;
          },
          emit(_event: string, ..._args: unknown[]) {
            return false;
          },
          removeListener() {
            return this;
          },
          off(_event: string, _handler: Function) {
            return this;
          },
          flushHeaders() {},
          destroy(_err?: Error) {
            return this;
          },
        };

        // Build a minimal Node-style request interface
        const headersObj = Object.fromEntries(request.headers.entries());
        const rawHeaders: string[] = [];
        for (const [k, v] of Object.entries(headersObj)) {
          rawHeaders.push(k, v);
        }

        const fakeReq = {
          method: "POST",
          url: "/mcp",
          headers: headersObj,
          rawHeaders,
          on(_event: string, _handler: Function) {
            return this;
          },
          once(_event: string, _handler: Function) {
            return this;
          },
          emit(_event: string, ..._args: unknown[]) {
            return false;
          },
          removeListener() {
            return this;
          },
        };

        try {
          // Connect mcpServer to transport
          await mcpServer.connect(transport);

          // Handle the request through the MCP transport
          await transport.handleRequest(
            fakeReq as any,
            fakeRes as any,
            body,
          );
        } catch (error) {
          const durationMs = Math.round(performance.now() - requestStart);
          logger.error("MCP transport error", {
            correlationId,
            method,
            rpcId: rpcId != null ? String(rpcId) : undefined,
            toolName: toolName ?? undefined,
            durationMs,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
          set.status = 500;
          resolve({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32603, message: "Internal error" },
          });
        } finally {
          // Cleanup: close transport after response is sent
          transport.close().catch(() => {});
          mcpServer.close().catch(() => {});
        }
      });
    })

    // ── MCP Endpoint: GET /mcp (not supported in stateless mode) ──
    .get("/mcp", ({ set }) => {
      set.status = 405;
      set.headers["allow"] = "POST";
      return {
        error: "Method not allowed",
        message:
          "This server operates in stateless mode. Use POST for MCP requests.",
      };
    })

    // ── MCP Endpoint: DELETE /mcp (not supported in stateless mode) ──
    .delete("/mcp", ({ set }) => {
      set.status = 405;
      set.headers["allow"] = "POST";
      return {
        error: "Method not allowed",
        message:
          "This server operates in stateless mode. Sessions are not used.",
      };
    });

  return app;
}

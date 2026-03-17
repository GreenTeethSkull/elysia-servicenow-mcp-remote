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
import { log } from "./services/logger";

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
  console.error(
    `Testing connection to ServiceNow instance: ${env.instanceUrl}...`,
  );
  const connectionTest = await snClient.testConnection();
  if (!connectionTest.success) {
    console.error(
      `Failed to connect to ServiceNow: ${connectionTest.error}`,
    );
    process.exit(2);
  }
  console.error(
    `Successfully connected to ServiceNow at ${env.instanceUrl}.`,
  );

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

    // ── Request logging ──
    .onRequest(({ request }) => {
      log("debug", "incoming request", {
        method: request.method,
        url: request.url,
      });
    })

    // ── Health check ──
    .get("/health", () => ({
      status: "healthy",
      service: SERVER_NAME,
      version: SERVER_VERSION,
      timestamp: new Date().toISOString(),
    }))

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
      // Read the raw body
      const rawBody = await request.text();

      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        set.status = 400;
        return {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error: Invalid JSON" },
        };
      }

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

            set.status = statusCode;
            for (const [k, v] of Object.entries(responseHeaders)) {
              set.headers[k] = v;
            }

            // Try to parse as JSON, otherwise return as text
            try {
              resolve(JSON.parse(responseBody));
            } catch {
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
          console.error("MCP transport error:", error);
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

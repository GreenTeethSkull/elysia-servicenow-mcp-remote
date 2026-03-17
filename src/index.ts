/**
 * Entry point for the Elysia ServiceNow MCP Remote Server.
 *
 * This server runs as a remote MCP server via Streamable HTTP transport,
 * designed for containerized deployment.
 */

import { createApp } from "./server";
import { SERVER_NAME, SERVER_VERSION } from "./constants";

async function main() {
  console.error(`Initializing ${SERVER_NAME} v${SERVER_VERSION}...`);

  const app = await createApp();

  const port = parseInt(process.env.PORT || "3000");
  const host = process.env.HOST || "0.0.0.0";

  app.listen({ port, hostname: host });

  console.error(`${SERVER_NAME} v${SERVER_VERSION} is running!`);
  console.error(`  MCP endpoint: http://${host}:${port}/mcp`);
  console.error(`  Health check: http://${host}:${port}/health`);
  console.error(`  Server info:  http://${host}:${port}/`);

  // Graceful shutdown
  const shutdown = () => {
    console.error("Shutting down MCP server...");
    app.stop();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

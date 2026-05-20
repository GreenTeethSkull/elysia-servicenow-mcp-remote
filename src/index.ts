/**
 * Entry point for the Elysia ServiceNow MCP Remote Server.
 *
 * This server runs as a remote MCP server via Streamable HTTP transport,
 * designed for containerized deployment.
 */

import { createApp } from "./server";
import { SERVER_NAME, SERVER_VERSION } from "./constants";
import { logger } from "./services/logger";

async function main() {
  logger.info("Server initializing", {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
  });

  const app = await createApp();

  const port = parseInt(process.env.PORT || "3000");
  const host = process.env.HOST || "0.0.0.0";

  app.listen({ port, hostname: host });

  logger.info("Server started", {
    host,
    port,
    mcpEndpoint: `http://${host}:${port}/mcp`,
    healthCheck: `http://${host}:${port}/health`,
    serverInfo: `http://${host}:${port}/`,
    logLevel: process.env.LOG_LEVEL || "info",
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info("Server shutting down");
    app.stop();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => {
  logger.error("Fatal error during startup", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});

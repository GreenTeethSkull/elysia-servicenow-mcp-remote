/**
 * Structured logger for Azure App Service + Log Analytics integration.
 *
 * Log output goes to stdout (info/warn) and stderr (error) so Azure App Service
 * correctly maps levels: stdout -> Informational, stderr -> Error.
 * MCP protocol constraint (no stdout) does NOT apply here since this server
 * uses Streamable HTTP transport, not stdio.
 *
 * All entries are JSON for Log Analytics ingestion with custom fields.
 */

import { SERVER_NAME, SERVER_VERSION } from "../constants";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = (process.env.LOG_LEVEL || "info") as LogLevel;

export interface LogContext {
  correlationId?: string;
  toolName?: string;
  table?: string;
  method?: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, context?: LogContext): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return;

  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    service: SERVER_NAME,
    version: SERVER_VERSION,
    message,
    ...context,
  };

  const serialized = JSON.stringify(entry);

  // Azure App Service maps:
  //   console.log  -> Level: Informational (stdout)
  //   console.warn -> Level: Warning       (stdout)
  //   console.error -> Level: Error         (stderr)
  switch (level) {
    case "error":
      console.error(serialized);
      break;
    case "warn":
      console.warn(serialized);
      break;
    default:
      console.log(serialized);
  }
}

export const logger = {
  debug(message: string, context?: LogContext) {
    emit("debug", message, context);
  },

  info(message: string, context?: LogContext) {
    emit("info", message, context);
  },

  warn(message: string, context?: LogContext) {
    emit("warn", message, context);
  },

  error(message: string, context?: LogContext) {
    emit("error", message, context);
  },

  /**
   * Create a child logger with pre-set context (correlationId, toolName, etc.)
   * that is automatically merged into every log call.
   */
  child(defaultContext: LogContext) {
    return {
      debug(message: string, extra?: LogContext) {
        emit("debug", message, { ...defaultContext, ...extra });
      },
      info(message: string, extra?: LogContext) {
        emit("info", message, { ...defaultContext, ...extra });
      },
      warn(message: string, extra?: LogContext) {
        emit("warn", message, { ...defaultContext, ...extra });
      },
      error(message: string, extra?: LogContext) {
        emit("error", message, { ...defaultContext, ...extra });
      },
    };
  },

  /**
   * Measure execution time of an async operation and log it.
   */
  async timed<T>(
    level: LogLevel,
    message: string,
    context: LogContext | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      const durationMs = Math.round(performance.now() - start);
      emit(level, message, { ...context, durationMs });
      return result;
    } catch (error) {
      const durationMs = Math.round(performance.now() - start);
      emit("error", `${message} failed`, {
        ...context,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
};

/**
 * Generate a short correlation ID for request tracing.
 * Format: 8 hex chars (enough for uniqueness within a single server instance).
 */
export function generateCorrelationId(): string {
  return Math.random().toString(16).slice(2, 10);
}

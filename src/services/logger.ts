type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = (process.env.LOG_LEVEL || "info") as LogLevel;

export function log(
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>,
): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
  };

  // MCP servers MUST NOT write to stdout (reserved for protocol messages)
  // All logging goes to stderr
  console.error(JSON.stringify(entry));
}

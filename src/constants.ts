export const SERVER_NAME = "elysia-servicenow-mcp-remote";
export const SERVER_VERSION = "1.0.0";
export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const CHARACTER_LIMIT = 25_000;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const REQUEST_TIMEOUT_MS = 30_000;
export const SESSION_TTL_MINUTES = 30;

// Rate limiting
export const RATE_LIMIT_MAX_CALLS = 5;
export const RATE_LIMIT_WINDOW_MS = 60_000; // 60 seconds

// ServiceNow query constraints
export const MIN_QUERY_LENGTH = 3;
export const MAX_QUERY_LENGTH = 500;
export const MIN_LIMIT = 1;
export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 20;

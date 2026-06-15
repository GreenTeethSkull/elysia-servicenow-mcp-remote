export const SERVER_NAME = "elysia-servicenow-mcp-remote";
export const SERVER_VERSION = "2.0.0";
export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const CHARACTER_LIMIT = 25_000;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const REQUEST_TIMEOUT_MS = 30_000;
export const SESSION_TTL_MINUTES = 30;

// Rate limiting
export const RATE_LIMIT_MAX_CALLS = 60;
export const RATE_LIMIT_WINDOW_MS = 60_000;

// Retry configuration
export const MAX_RETRIES = 3;
export const RETRY_BASE_DELAY_MS = 1_000;

// OAuth token refresh buffer (refresh 60s before expiry)
export const TOKEN_REFRESH_BUFFER_MS = 60_000;

// ServiceNow API endpoint paths (easy to swap for prod)
export const API_BASE_PATH = "/api/pase/lucy_ai_pacifico";
export const ENDPOINTS = {
  incidents: `${API_BASE_PATH}/getinc`,
  changes: `${API_BASE_PATH}/getchg`,
  requirements: `${API_BASE_PATH}/getritm`,
  problems: `${API_BASE_PATH}/getprb`,
} as const;

// OAuth token endpoint
export const OAUTH_TOKEN_PATH = "/oauth_token.do";

// ServiceNow query constraints
export const MIN_QUERY_LENGTH = 3;
export const MAX_QUERY_LENGTH = 500;
export const MIN_LIMIT = 1;
export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 20;

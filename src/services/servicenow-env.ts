/**
 * ServiceNow environment variable reader and validator.
 *
 * Reads required and optional environment variables for connecting
 * to a ServiceNow instance, validates them, and returns a typed config.
 */

export interface ServiceNowEnv {
  /** ServiceNow instance URL (e.g., https://dev12345.service-now.com) */
  instanceUrl: string;
  /** ServiceNow username for Basic Auth */
  username: string;
  /** ServiceNow password for Basic Auth */
  password: string;
  /** API timeout in milliseconds */
  timeout: number;
}

/**
 * Read and validate ServiceNow environment variables.
 * Throws descriptive errors if required variables are missing.
 */
export function getServiceNowEnv(): ServiceNowEnv {
  const instanceUrl = process.env.SERVICENOW_INSTANCE_URL;
  const username = process.env.SERVICENOW_USERNAME;
  const password = process.env.SERVICENOW_PASSWORD;
  const timeoutStr = process.env.SERVICENOW_TIMEOUT;

  const missing: string[] = [];
  if (!instanceUrl) missing.push("SERVICENOW_INSTANCE_URL");
  if (!username) missing.push("SERVICENOW_USERNAME");
  if (!password) missing.push("SERVICENOW_PASSWORD");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "Please set them in your .env file or environment.",
    );
  }

  // Validate instance URL format
  const normalizedUrl = instanceUrl!.replace(/\/+$/, "");
  try {
    new URL(normalizedUrl);
  } catch {
    throw new Error(
      `Invalid SERVICENOW_INSTANCE_URL: "${instanceUrl}". ` +
        "Must be a valid URL (e.g., https://dev12345.service-now.com).",
    );
  }

  // Parse and validate timeout
  let timeout = 30_000;
  if (timeoutStr) {
    const parsed = parseInt(timeoutStr, 10);
    if (isNaN(parsed) || parsed < 1000 || parsed > 120_000) {
      console.error(
        `Invalid SERVICENOW_TIMEOUT "${timeoutStr}". Using default 30000ms.`,
      );
    } else {
      timeout = parsed;
    }
  }

  return {
    instanceUrl: normalizedUrl,
    username: username!,
    password: password!,
    timeout,
  };
}

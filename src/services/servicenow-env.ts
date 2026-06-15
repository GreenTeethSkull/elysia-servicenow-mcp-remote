import { logger } from "./logger";

export interface ServiceNowEnv {
  instanceUrl: string;
  oauthUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  timeout: number;
}

export function getServiceNowEnv(): ServiceNowEnv {
  const instanceUrl = process.env.SERVICENOW_INSTANCE_URL;
  const clientId = process.env.SERVICENOW_CLIENT_ID;
  const clientSecret = process.env.SERVICENOW_CLIENT_SECRET;
  const username = process.env.SERVICENOW_USERNAME;
  const password = process.env.SERVICENOW_PASSWORD;
  const timeoutStr = process.env.SERVICENOW_TIMEOUT;

  const missing: string[] = [];
  if (!instanceUrl) missing.push("SERVICENOW_INSTANCE_URL");
  if (!clientId) missing.push("SERVICENOW_CLIENT_ID");
  if (!clientSecret) missing.push("SERVICENOW_CLIENT_SECRET");
  if (!username) missing.push("SERVICENOW_USERNAME");
  if (!password) missing.push("SERVICENOW_PASSWORD");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "Please set them in your .env file or environment.",
    );
  }

  const normalizedUrl = instanceUrl!.replace(/\/+$/, "");
  try {
    new URL(normalizedUrl);
  } catch {
    throw new Error(
      `Invalid SERVICENOW_INSTANCE_URL: "${instanceUrl}". ` +
        "Must be a valid URL (e.g., https://giotst.service-now.com).",
    );
  }

  const oauthUrl = `${normalizedUrl}/oauth_token.do`;

  let timeout = 30_000;
  if (timeoutStr) {
    const parsed = parseInt(timeoutStr, 10);
    if (isNaN(parsed) || parsed < 1000 || parsed > 120_000) {
      logger.warn("Invalid SERVICENOW_TIMEOUT, using default", {
        providedValue: timeoutStr,
        defaultValue: 30000,
      });
    } else {
      timeout = parsed;
    }
  }

  return {
    instanceUrl: normalizedUrl,
    oauthUrl,
    clientId: clientId!,
    clientSecret: clientSecret!,
    username: username!,
    password: password!,
    timeout,
  };
}

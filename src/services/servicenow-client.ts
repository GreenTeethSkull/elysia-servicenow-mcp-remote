/**
 * ServiceNow HTTP Client for making authenticated API calls.
 * Uses Basic Authentication (username:password).
 *
 * This is a lightweight client that works with Bun's native fetch
 * without any Node.js-specific HTTP dependencies.
 *
 * Includes structured logging for all API calls (table, duration, status).
 */

import { SERVER_NAME, SERVER_VERSION, REQUEST_TIMEOUT_MS, MAX_RETRIES, RETRY_BASE_DELAY_MS } from "../constants";
import { logger } from "./logger";

export interface ServiceNowClientConfig {
  instanceUrl: string;
  username: string;
  password: string;
  timeout?: number;
}

export interface ServiceNowApiResponse<T = unknown> {
  result: T;
  total?: number;
}

export class ServiceNowClient {
  private readonly baseUrl: string;
  private readonly basicAuth: string;
  private readonly timeout: number;
  private readonly userAgent: string;

  constructor(config: ServiceNowClientConfig) {
    this.baseUrl = config.instanceUrl.replace(/\/+$/, "");
    this.basicAuth = btoa(`${config.username}:${config.password}`);
    this.timeout = config.timeout ?? REQUEST_TIMEOUT_MS;
    this.userAgent = `${SERVER_NAME}/v${SERVER_VERSION} (${process.platform}-${process.arch})`;
  }

  /**
   * Make an authenticated request to the ServiceNow Table API.
   */
  async tableRequest<T = unknown>(
    table: string,
    queryParams: URLSearchParams,
  ): Promise<ServiceNowApiResponse<T>> {
    const url = `${this.baseUrl}/api/now/table/${table}?${queryParams.toString()}`;
    return this.request<ServiceNowApiResponse<T>>(url, table);
  }

  /**
   * Make a raw authenticated GET request to any ServiceNow URL.
   * Logs table name, duration, status code, and record count.
   * Includes automatic retry with exponential backoff for rate limits (HTTP 429).
   */
  private async request<T>(url: string, table?: string, retries: number = MAX_RETRIES): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    const startTime = performance.now();

    // Extract just the path portion for logging (hide query params with credentials)
    const urlObj = new URL(url);
    const logPath = urlObj.pathname;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Basic ${this.basicAuth}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": this.userAgent,
        },
        signal: controller.signal,
      });

      const durationMs = Math.round(performance.now() - startTime);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");

        if (response.status === 429 && retries > 0) {
          const attempt = MAX_RETRIES - retries + 1;
          const delay = Math.pow(2, attempt - 1) * RETRY_BASE_DELAY_MS;

          logger.warn("ServiceNow API rate limited, retrying with backoff", {
            table: table || "unknown",
            path: logPath,
            httpStatus: response.status,
            attempt,
            maxRetries: MAX_RETRIES,
            delayMs: delay,
          });

          clearTimeout(timeoutId);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.request<T>(url, table, retries - 1);
        }

        logger.error("ServiceNow API request failed", {
          table: table || "unknown",
          httpMethod: "GET",
          path: logPath,
          httpStatus: response.status,
          httpStatusText: response.statusText,
          durationMs,
          errorBodyLength: errorBody.length,
        });

        throw new ServiceNowApiError(
          `ServiceNow API error: ${response.status} ${response.statusText}`,
          response.status,
          errorBody,
        );
      }

      const data = (await response.json()) as T;

      // Log successful API call
      const apiResponse = data as ServiceNowApiResponse;
      const recordCount = Array.isArray(apiResponse.result)
        ? apiResponse.result.length
        : apiResponse.result
          ? 1
          : 0;

      logger.debug("ServiceNow API request completed", {
        table: table || "unknown",
        httpMethod: "GET",
        path: logPath,
        httpStatus: response.status,
        durationMs,
        recordCount,
        totalRecords: apiResponse.total,
      });

      return data;
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);

      if (error instanceof ServiceNowApiError) throw error;

      if ((error as Error).name === "AbortError") {
        logger.error("ServiceNow API request timed out", {
          table: table || "unknown",
          path: logPath,
          timeoutMs: this.timeout,
          durationMs,
        });

        throw new ServiceNowApiError(
          `ServiceNow API request timed out after ${this.timeout}ms`,
          408,
          "",
        );
      }

      logger.error("ServiceNow API connection failed", {
        table: table || "unknown",
        path: logPath,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new ServiceNowApiError(
        `ServiceNow connection failed: ${error instanceof Error ? error.message : String(error)}`,
        0,
        "",
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Test the connection by fetching a single incident record.
   */
  async testConnection(): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const params = new URLSearchParams();
      params.set("sysparm_limit", "1");
      params.set("sysparm_fields", "sys_id");
      await this.tableRequest("incident", params);
      return { success: true };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  get instanceUrl(): string {
    return this.baseUrl;
  }
}

export class ServiceNowApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "ServiceNowApiError";
  }
}

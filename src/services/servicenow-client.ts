/**
 * ServiceNow HTTP Client for making authenticated API calls.
 * Uses Basic Authentication (username:password).
 *
 * This is a lightweight client that works with Bun's native fetch
 * without any Node.js-specific HTTP dependencies.
 */

import { SERVER_NAME, SERVER_VERSION, REQUEST_TIMEOUT_MS } from "../constants";

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
    return this.request<ServiceNowApiResponse<T>>(url);
  }

  /**
   * Make a raw authenticated GET request to any ServiceNow URL.
   */
  private async request<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

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

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new ServiceNowApiError(
          `ServiceNow API error: ${response.status} ${response.statusText}`,
          response.status,
          errorBody,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ServiceNowApiError) throw error;

      if ((error as Error).name === "AbortError") {
        throw new ServiceNowApiError(
          `ServiceNow API request timed out after ${this.timeout}ms`,
          408,
          "",
        );
      }

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

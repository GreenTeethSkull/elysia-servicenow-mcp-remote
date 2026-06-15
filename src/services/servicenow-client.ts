import {
  SERVER_NAME,
  SERVER_VERSION,
  REQUEST_TIMEOUT_MS,
  MAX_RETRIES,
  RETRY_BASE_DELAY_MS,
  TOKEN_REFRESH_BUFFER_MS,
  OAUTH_TOKEN_PATH,
} from "../constants";
import { logger } from "./logger";

export interface ServiceNowClientConfig {
  instanceUrl: string;
  oauthUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  timeout?: number;
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface ServiceNowApiResponse<T = unknown> {
  result: {
    result: T[];
    meta: {
      total: number;
      limit: number;
      offset: number;
      returned: number;
      query_used: string;
    };
  };
}

export class ServiceNowClient {
  private readonly baseUrl: string;
  private readonly oauthUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly username: string;
  private readonly password: string;
  private readonly timeout: number;
  private readonly userAgent: string;

  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(config: ServiceNowClientConfig) {
    this.baseUrl = config.instanceUrl.replace(/\/+$/, "");
    this.oauthUrl = config.oauthUrl;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.username = config.username;
    this.password = config.password;
    this.timeout = config.timeout ?? REQUEST_TIMEOUT_MS;
    this.userAgent = `${SERVER_NAME}/v${SERVER_VERSION} (${process.platform}-${process.arch})`;
  }

  private async fetchOAuthToken(): Promise<void> {
    const startTime = performance.now();

    const body = new URLSearchParams();
    body.set("grant_type", "password");
    body.set("client_id", this.clientId);
    body.set("client_secret", this.clientSecret);
    body.set("username", this.username);
    body.set("password", this.password);

    try {
      const response = await fetch(this.oauthUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": this.userAgent,
        },
        body: body.toString(),
      });

      const durationMs = Math.round(performance.now() - startTime);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        logger.error("OAuth token request failed", {
          httpStatus: response.status,
          durationMs,
          errorBody: errorBody.slice(0, 500),
        });
        throw new ServiceNowApiError(
          `OAuth token request failed: ${response.status} ${response.statusText}`,
          response.status,
          errorBody,
        );
      }

      const data = (await response.json()) as OAuthTokenResponse;

      this.accessToken = data.access_token;
      this.refreshToken = data.refresh_token || null;
      this.tokenExpiresAt = Date.now() + data.expires_in * 1000;

      logger.info("OAuth token acquired", {
        durationMs,
        expiresIn: data.expires_in,
        tokenType: data.token_type,
      });
    } catch (error) {
      if (error instanceof ServiceNowApiError) throw error;

      const durationMs = Math.round(performance.now() - startTime);
      logger.error("OAuth token connection failed", {
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ServiceNowApiError(
        `OAuth connection failed: ${error instanceof Error ? error.message : String(error)}`,
        0,
        "",
      );
    }
  }

  private async getValidToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return this.accessToken;
    }

    logger.debug("OAuth token expired or expiring soon, refreshing");
    await this.fetchOAuthToken();
    return this.accessToken!;
  }

  async apiRequest<T = unknown>(
    endpointPath: string,
    queryParams: URLSearchParams,
  ): Promise<ServiceNowApiResponse<T>> {
    const url = `${this.baseUrl}${endpointPath}?${queryParams.toString()}`;
    return this.request<ServiceNowApiResponse<T>>(url, endpointPath);
  }

  private async request<T>(
    url: string,
    endpoint: string,
    retries: number = MAX_RETRIES,
    isRetryAfterAuth: boolean = false,
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    const startTime = performance.now();

    const urlObj = new URL(url);
    const logPath = urlObj.pathname;

    try {
      const token = await this.getValidToken();

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": this.userAgent,
        },
        signal: controller.signal,
      });

      const durationMs = Math.round(performance.now() - startTime);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");

        if (response.status === 401 && !isRetryAfterAuth) {
          logger.warn("OAuth token rejected, re-authenticating", {
            endpoint,
            path: logPath,
            httpStatus: response.status,
          });
          this.accessToken = null;
          this.tokenExpiresAt = 0;
          clearTimeout(timeoutId);
          return this.request<T>(url, endpoint, retries, true);
        }

        if (response.status === 429 && retries > 0) {
          const attempt = MAX_RETRIES - retries + 1;
          const delay = Math.pow(2, attempt - 1) * RETRY_BASE_DELAY_MS;

          logger.warn("ServiceNow API rate limited, retrying with backoff", {
            endpoint,
            path: logPath,
            httpStatus: response.status,
            attempt,
            maxRetries: MAX_RETRIES,
            delayMs: delay,
          });

          clearTimeout(timeoutId);
          await new Promise((resolve) => setTimeout(resolve, delay));
          return this.request<T>(url, endpoint, retries - 1, isRetryAfterAuth);
        }

        logger.error("ServiceNow API request failed", {
          endpoint,
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

      const apiResponse = data as ServiceNowApiResponse;
      const recordCount = apiResponse.result?.result?.length ?? 0;
      const totalRecords = apiResponse.result?.meta?.total;

      logger.debug("ServiceNow API request completed", {
        endpoint,
        httpMethod: "GET",
        path: logPath,
        httpStatus: response.status,
        durationMs,
        recordCount,
        totalRecords,
      });

      return data;
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);

      if (error instanceof ServiceNowApiError) throw error;

      if ((error as Error).name === "AbortError") {
        logger.error("ServiceNow API request timed out", {
          endpoint,
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
        endpoint,
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

  async testConnection(): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      await this.fetchOAuthToken();
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
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

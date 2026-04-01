import axios, { AxiosInstance, AxiosResponse } from "axios";
import { ConnectorError } from "../../errors";
import { ZendeskConfig } from "./zendesk.connector";

const DEFAULT_PAGE_SIZE = 100;
const MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;

export class ZendeskClient {
  private readonly http: AxiosInstance;

  constructor(config: ZendeskConfig) {
    const token = Buffer.from(
      `${config.email}/token:${config.apiToken}`,
    ).toString("base64");

    this.http = axios.create({
      baseURL: `https://${config.subdomain}.zendesk.com/api/v2`,
      headers: {
        Authorization: `Basic ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 30_000,
    });
  }

  async get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response: AxiosResponse<T> = await this.http.get(path, { params });
        return response.data;
      } catch (err) {
        lastError = err;

        if (!axios.isAxiosError(err)) throw this.wrapError("Unexpected error", err);

        const status = err.response?.status;

        if (status === 429) {
          const retryAfter = this.parseRetryAfter(err.response?.headers);
          if (attempt < MAX_RETRIES) {
            await this.sleep(retryAfter);
            continue;
          }
        }

        if (status && status >= 500 && attempt < MAX_RETRIES) {
          await this.sleep(DEFAULT_RETRY_DELAY_MS * Math.pow(2, attempt));
          continue;
        }

        throw this.wrapError(
          `Zendesk API error: ${status} ${err.response?.statusText ?? ""}`.trim(),
          err,
          status,
        );
      }
    }

    throw this.wrapError("Max retries exceeded", lastError);
  }

  async getBuffer(url: string): Promise<Buffer> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.http.get(url, { responseType: "arraybuffer" });
        return Buffer.from(response.data);
      } catch (err) {
        if (!axios.isAxiosError(err)) throw this.wrapError("Unexpected error", err);

        const status = err.response?.status;

        if (status === 429 && attempt < MAX_RETRIES) {
          await this.sleep(this.parseRetryAfter(err.response?.headers));
          continue;
        }

        if (status && status >= 500 && attempt < MAX_RETRIES) {
          await this.sleep(DEFAULT_RETRY_DELAY_MS * Math.pow(2, attempt));
          continue;
        }

        throw this.wrapError(`Attachment download failed: ${status}`, err, status);
      }
    }

    throw this.wrapError("Max retries exceeded for attachment download", undefined);
  }

  buildCBPParams(
    cursor?: string,
    pageSize: number = DEFAULT_PAGE_SIZE,
  ): Record<string, string | number> {
    const params: Record<string, string | number> = { "page[size]": pageSize };
    if (cursor) {
      params["page[after]"] = cursor;
    }
    return params;
  }

  private parseRetryAfter(headers?: Record<string, string>): number {
    const value = headers?.["retry-after"];
    if (value) {
      const seconds = parseInt(value, 10);
      if (!isNaN(seconds)) return seconds * 1000;
    }
    return DEFAULT_RETRY_DELAY_MS;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private wrapError(message: string, cause: unknown, statusCode?: number): ConnectorError {
    return new ConnectorError(message, "zendesk", statusCode, cause);
  }
}

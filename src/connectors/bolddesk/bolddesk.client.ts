import axios, { AxiosInstance, AxiosResponse } from "axios";
import FormData from "form-data";
import { ConnectorError } from "../../errors";
import { BoldDeskConfig } from "./bolddesk.connector";

const MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;

export class BoldDeskClient {
  private readonly http: AxiosInstance;

  constructor(config: BoldDeskConfig) {
    this.http = axios.create({
      baseURL: config.baseUrl.replace(/\/+$/, ""),
      headers: {
        "x-api-key": config.apiKey,
        "Content-Type": "application/json",
      },
      timeout: 60_000,
    });
  }

  async get<T>(
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<T> {
    return this.requestWithRetry<T>(async () => {
      const res: AxiosResponse<T> = await this.http.get(path, { params });
      return res.data;
    });
  }

  async post<T>(
    path: string,
    body: unknown,
    params?: Record<string, string | number | boolean>,
  ): Promise<T> {
    return this.requestWithRetry<T>(async () => {
      const res: AxiosResponse<T> = await this.http.post(path, body, params ? { params } : undefined);
      return res.data;
    });
  }

  async postMultipart<T>(
    path: string,
    fileName: string,
    fileBuffer: Buffer,
    contentType: string,
  ): Promise<T> {
    return this.requestWithRetry<T>(async () => {
      const form = new FormData();
      form.append("uploadFiles", fileBuffer, {
        filename: fileName,
        contentType,
      });

      const res: AxiosResponse<T> = await this.http.post(path, form, {
        headers: form.getHeaders(),
      });
      return res.data;
    });
  }

  private async requestWithRetry<T>(
    fn: () => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;

        if (!axios.isAxiosError(err)) throw this.wrapError("Unexpected error", err);

        const status = err.response?.status;

        if (status === 429 && attempt < MAX_RETRIES) {
          const retryAfter = this.parseRetryAfter(err.response?.headers);
          await this.sleep(retryAfter);
          continue;
        }

        if (status && status >= 500 && attempt < MAX_RETRIES) {
          await this.sleep(DEFAULT_RETRY_DELAY_MS * Math.pow(2, attempt));
          continue;
        }

        const responseBody = err.response?.data;
        const detail = responseBody
          ? typeof responseBody === "string"
            ? responseBody
            : JSON.stringify(responseBody, null, 2)
          : "";

        throw this.wrapError(
          `BoldDesk API error: ${status} ${err.response?.statusText ?? ""}${detail ? `\n${detail}` : ""}`,
          err,
          status,
        );
      }
    }

    throw this.wrapError("Max retries exceeded", lastError);
  }

  private parseRetryAfter(headers?: Record<string, unknown>): number {
    const value = headers?.["retry-after"];
    if (typeof value === "string" || typeof value === "number") {
      const seconds = parseInt(String(value), 10);
      if (!isNaN(seconds)) return seconds * 1000;
    }
    return DEFAULT_RETRY_DELAY_MS;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private wrapError(
    message: string,
    cause: unknown,
    statusCode?: number,
  ): ConnectorError {
    return new ConnectorError(message, "bolddesk", statusCode, cause);
  }
}

import dotenv from "dotenv";

dotenv.config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export function loadConfig() {
  return {
    zendesk: {
      subdomain: required("ZENDESK_SUBDOMAIN"),
      email: required("ZENDESK_EMAIL"),
      apiToken: required("ZENDESK_API_TOKEN"),
    },
    bolddesk: {
      baseUrl: required("BOLDDESK_BASE_URL"),
      apiKey: required("BOLDDESK_API_KEY"),
    },
    database: {
      url: required("DATABASE_URL"),
    },
    migration: {
      batchSize: parseInt(optional("MIGRATION_BATCH_SIZE", "50"), 10),
    },
    logLevel: optional("LOG_LEVEL", "info"),
  };
}

export type AppConfig = ReturnType<typeof loadConfig>;

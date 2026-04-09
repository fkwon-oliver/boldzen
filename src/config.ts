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
      defaultBrandId: parseInt(optional("BOLDDESK_BRAND_ID", "1"), 10),
    },
    database: {
      url: required("DATABASE_URL"),
    },
    migration: {
      batchSize: parseInt(optional("MIGRATION_BATCH_SIZE", "50"), 10),
    },
    retry: {
      maxRetries: parseInt(optional("RETRY_MAX_ATTEMPTS", "3"), 10),
      backoffBaseMs: parseInt(optional("RETRY_BACKOFF_BASE_MS", "2000"), 10),
    },
    pilot: {
      ownerSystemFieldId: parseInt(optional("ZD_FIELD_OWNER_SYSTEM", "0"), 10),
      syncStateFieldId: parseInt(optional("ZD_FIELD_SYNC_STATE", "0"), 10),
      bolddeskTicketIdFieldId: parseInt(optional("ZD_FIELD_BOLDDESK_TICKET_ID", "0"), 10),
      handoffTag: optional("PILOT_HANDOFF_TAG", "handled_in_bolddesk"),
      pendingSyncTag: optional("PILOT_PENDING_SYNC_TAG", "pending_bolddesk_sync"),
    },
    logLevel: optional("LOG_LEVEL", "info"),
  };
}

export type AppConfig = ReturnType<typeof loadConfig>;

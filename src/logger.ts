import pino from "pino";

export type Logger = pino.Logger;

export function createLogger(level: string = "info"): Logger {
  return pino({
    level,
    transport: {
      target: "pino/file",
      options: { destination: 1 }, // stdout
    },
  });
}

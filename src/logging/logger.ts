import * as winston from "winston";

const isProduction = process.env.NODE_ENV === "production";

type LogInfo = winston.Logform.TransformableInfo & {
  component?: string;
};

const baseFormat = isProduction
  ? winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    )
  : winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp(),
      winston.format.printf((info: LogInfo) => {
        const { timestamp, level, message, component, ...meta } = info;
        const prefix = component ? `[${component}] ` : "";
        const metaKeys = Object.keys(meta).filter((key) => key !== "component");

        if (metaKeys.length === 0) {
          return `${timestamp} ${level}: ${prefix}${message}`;
        }

        const metaPayload: Record<string, unknown> = {};
        metaKeys.forEach((key) => {
          metaPayload[key] = meta[key];
        });

        return `${timestamp} ${level}: ${prefix}${message} ${JSON.stringify(metaPayload)}`;
      })
    );

/**
 * Shared Winston logger. All levels write to stderr so stdout stays clean
 * for MCP stdio and Cursor hook JSON responses.
 */
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
  format: baseFormat,
  transports: [
    new winston.transports.Console({
      stderrLevels: ["error", "warn", "info", "http", "verbose", "debug", "silly"],
    }),
  ],
});

export const createLogger = (component: string): winston.Logger => {
  return logger.child({ component });
};

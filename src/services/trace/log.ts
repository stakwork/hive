/**
 * The one logging surface for highlight-to-trace — every line opens with
 * `[trace]` so the whole feature's logs are one `grep`.
 */

import { logger } from "@/lib/logger";

const CONTEXT = "TRACE";

export const traceLog = {
  info: (message: string, metadata?: Record<string, unknown>) => logger.info(`[trace] ${message}`, CONTEXT, metadata),
  warn: (message: string, metadata?: Record<string, unknown>) => logger.warn(`[trace] ${message}`, CONTEXT, metadata),
};

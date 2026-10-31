/**
 * A linked tribe's batch of messages, as a strut run (`POST /api/tribes/log`).
 * Strut owns the messages; there is nothing for hive to deliver, so settling
 * only logs.
 */

import { logger } from "@/lib/logger";
import { STRUT_RUN_LOG_TAG, type StrutRunHandler } from "@/services/strut-runs";

export const handleTribeMessagesSettled: StrutRunHandler = async (row) => {
  logger.info("Tribe messages run settled", STRUT_RUN_LOG_TAG, {
    id: row.id,
    kind: row.kind,
    workspaceId: row.workspaceId,
    status: row.status,
  });
};

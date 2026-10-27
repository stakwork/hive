/**
 * A call transcript's strut run (`POST /api/calls/transcript`). Strut owns
 * the transcript; there is nothing for hive to deliver, so settling only logs.
 */

import { logger } from "@/lib/logger";
import { STRUT_RUN_LOG_TAG, type StrutRunHandler } from "@/services/strut-runs";

export const handleCallTranscriptSettled: StrutRunHandler = async (row) => {
  logger.info("Call transcript run settled", STRUT_RUN_LOG_TAG, {
    id: row.id,
    kind: row.kind,
    workspaceId: row.workspaceId,
    status: row.status,
  });
};

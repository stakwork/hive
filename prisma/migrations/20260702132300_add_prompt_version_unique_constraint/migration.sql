-- AddUniqueConstraint: prevent duplicate version numbers for the same prompt
-- Required to ensure concurrent saves cannot produce corrupted versionNumber sequences.
CREATE UNIQUE INDEX "prompt_versions_prompt_id_version_number_key" ON "prompt_versions"("prompt_id", "version_number");

-- Sites a strut job may ask a person to solve a captcha on (admin-edited, per workspace).
ALTER TABLE "workspaces" ADD COLUMN "captcha_allowed_sites" TEXT[] DEFAULT ARRAY[]::TEXT[];

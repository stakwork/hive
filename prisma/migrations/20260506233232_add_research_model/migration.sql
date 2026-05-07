-- CreateTable
CREATE TABLE "researches" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "content" TEXT,
    "org_id" TEXT NOT NULL,
    "initiative_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "researches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "researches_org_id_idx" ON "researches"("org_id");

-- CreateIndex
CREATE INDEX "researches_initiative_id_idx" ON "researches"("initiative_id");

-- CreateIndex
CREATE UNIQUE INDEX "researches_org_id_slug_key" ON "researches"("org_id", "slug");

-- AddForeignKey
ALTER TABLE "researches" ADD CONSTRAINT "researches_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "source_control_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "researches" ADD CONSTRAINT "researches_initiative_id_fkey" FOREIGN KEY ("initiative_id") REFERENCES "initiatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

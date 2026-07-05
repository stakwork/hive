-- CreateTable
CREATE TABLE "LegalBenchmarkRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskSlug" TEXT NOT NULL,
    "taskTitle" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "runnerProjectId" INTEGER,
    "scorerProjectId" INTEGER,
    "runnerOutputUrl" TEXT,
    "runnerOutputText" TEXT,
    "scoreJson" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalBenchmarkRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LegalBenchmarkRun_workspaceId_idx" ON "LegalBenchmarkRun"("workspaceId");

-- CreateIndex
CREATE INDEX "LegalBenchmarkRun_taskSlug_idx" ON "LegalBenchmarkRun"("taskSlug");

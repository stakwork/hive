-- CreateTable
CREATE TABLE "strut_devices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credential_prefix" TEXT NOT NULL,
    "credential_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "strut_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strut_device_pairings" (
    "id" TEXT NOT NULL,
    "device_code_hash" TEXT NOT NULL,
    "user_code" TEXT NOT NULL,
    "device_name" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "denied_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strut_device_pairings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "strut_devices_credential_hash_key" ON "strut_devices"("credential_hash");

-- CreateIndex
CREATE INDEX "strut_devices_user_id_idx" ON "strut_devices"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "strut_device_pairings_device_code_hash_key" ON "strut_device_pairings"("device_code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "strut_device_pairings_user_code_key" ON "strut_device_pairings"("user_code");

-- CreateIndex
CREATE INDEX "strut_device_pairings_expires_at_idx" ON "strut_device_pairings"("expires_at");

-- AddForeignKey
ALTER TABLE "strut_devices" ADD CONSTRAINT "strut_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strut_device_pairings" ADD CONSTRAINT "strut_device_pairings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


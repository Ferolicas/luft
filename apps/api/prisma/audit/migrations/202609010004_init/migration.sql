-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "audit";

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CONFIGURATION_REQUIRED');

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "actorRole" VARCHAR(40),
    "action" VARCHAR(120) NOT NULL,
    "resource" VARCHAR(100) NOT NULL,
    "resourceId" VARCHAR(160),
    "ipHash" CHAR(64),
    "userAgent" VARCHAR(500),
    "payload" JSONB,
    "previousHash" CHAR(64),
    "eventHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationEvent" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(60) NOT NULL,
    "operation" VARCHAR(120) NOT NULL,
    "direction" VARCHAR(16) NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "payloadHash" CHAR(64),
    "httpStatus" INTEGER,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "externalReference" VARCHAR(160),
    "errorCode" VARCHAR(100),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL,
    "topic" VARCHAR(120) NOT NULL,
    "aggregateId" VARCHAR(160) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_eventHash_key" ON "AuditEvent"("eventHash");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_createdAt_idx" ON "AuditEvent"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_resource_resourceId_createdAt_idx" ON "AuditEvent"("resource", "resourceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationEvent_idempotencyKey_key" ON "IntegrationEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "IntegrationEvent_provider_status_createdAt_idx" ON "IntegrationEvent"("provider", "status", "createdAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_availableAt_idx" ON "OutboxEvent"("status", "availableAt");

-- La bitácora es append-only incluso si una cuenta de aplicación obtiene permisos por error.
CREATE OR REPLACE FUNCTION prevent_audit_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent is append-only';
END;
$$;

CREATE TRIGGER "AuditEvent_append_only"
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();

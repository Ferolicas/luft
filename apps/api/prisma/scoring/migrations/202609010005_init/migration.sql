-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "scoring";

-- CreateTable
CREATE TABLE "DecisionVersion" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreResult" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "decisionVersion" VARCHAR(100) NOT NULL,
    "score" INTEGER NOT NULL,
    "archetype" VARCHAR(40) NOT NULL,
    "factors" JSONB NOT NULL,
    "modelUsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelArtifact" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "version" VARCHAR(40) NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "storagePath" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "approvedBy" UUID,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DecisionVersion_name_key" ON "DecisionVersion"("name");

-- CreateIndex
CREATE INDEX "ScoreResult_userId_createdAt_idx" ON "ScoreResult"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModelArtifact_name_version_key" ON "ModelArtifact"("name", "version");

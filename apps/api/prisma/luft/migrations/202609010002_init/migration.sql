-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "luft";

-- CreateEnum
CREATE TYPE "ConsentKind" AS ENUM ('DATA_PROCESSING', 'BUREAU_QUERY', 'SCORE_SHARE_WITH_STARTIF', 'COMMUNICATIONS');

-- CreateEnum
CREATE TYPE "InquiryType" AS ENUM ('INITIAL', 'FINAL');

-- CreateEnum
CREATE TYPE "InquiryProvider" AS ENUM ('DATACREDITO', 'TRANSUNION');

-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CONFIGURATION_REQUIRED');

-- CreateTable
CREATE TABLE "Consent" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "ConsentKind" NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "textSnapshot" TEXT NOT NULL,
    "textHash" CHAR(64) NOT NULL,
    "ipHash" CHAR(64),
    "userAgent" VARCHAR(500),
    "deviceMeta" JSONB,
    "acceptedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "currentScore" INTEGER,
    "archetype" VARCHAR(40),
    "primaryGoal" VARCHAR(80),
    "demographicAnswers" JSONB,
    "completionPercent" INTEGER NOT NULL DEFAULT 0,
    "existingHistory" BOOLEAN,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FinancialProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionnaireResponse" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "answers" JSONB NOT NULL,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionnaireResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchetypeResult" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "archetype" VARCHAR(40) NOT NULL,
    "score" INTEGER NOT NULL,
    "traits" JSONB NOT NULL,
    "ruleVersion" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchetypeResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" VARCHAR(80) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "targetCOP" BIGINT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "targetDate" DATE,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EducationModule" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "lessons" JSONB NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EducationModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonProgress" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "moduleId" UUID NOT NULL,
    "lessonKey" VARCHAR(80) NOT NULL,
    "score" INTEGER,
    "completedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LessonProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Streak" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "currentDays" INTEGER NOT NULL DEFAULT 0,
    "longestDays" INTEGER NOT NULL DEFAULT 0,
    "lastActivity" DATE,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Streak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreInquiry" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "InquiryType" NOT NULL,
    "provider" "InquiryProvider" NOT NULL,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'PENDING',
    "score" INTEGER,
    "existingHistory" BOOLEAN,
    "resultCiphertext" TEXT,
    "externalReference" VARCHAR(160),
    "errorCode" VARCHAR(80),
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ScoreInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" VARCHAR(80) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" TEXT NOT NULL,
    "matchScore" INTEGER NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Consent_userId_kind_acceptedAt_idx" ON "Consent"("userId", "kind", "acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialProfile_userId_key" ON "FinancialProfile"("userId");

-- CreateIndex
CREATE INDEX "QuestionnaireResponse_userId_submittedAt_idx" ON "QuestionnaireResponse"("userId", "submittedAt");

-- CreateIndex
CREATE INDEX "ArchetypeResult_userId_createdAt_idx" ON "ArchetypeResult"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Goal_userId_createdAt_idx" ON "Goal"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EducationModule_slug_key" ON "EducationModule"("slug");

-- CreateIndex
CREATE INDEX "LessonProgress_userId_updatedAt_idx" ON "LessonProgress"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LessonProgress_userId_moduleId_lessonKey_key" ON "LessonProgress"("userId", "moduleId", "lessonKey");

-- CreateIndex
CREATE UNIQUE INDEX "Streak_userId_key" ON "Streak"("userId");

-- CreateIndex
CREATE INDEX "ScoreInquiry_userId_type_requestedAt_idx" ON "ScoreInquiry"("userId", "type", "requestedAt");

-- CreateIndex
CREATE INDEX "Opportunity_userId_matchScore_idx" ON "Opportunity"("userId", "matchScore");

-- AddForeignKey
ALTER TABLE "LessonProgress" ADD CONSTRAINT "LessonProgress_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "EducationModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ruta educativa inicial aprobada para el lanzamiento.
INSERT INTO "EducationModule" ("id", "slug", "title", "description", "position", "durationMin", "lessons", "published", "createdAt", "updatedAt") VALUES
('10000000-0000-4000-8000-000000000001', 'conoce-tu-historial', 'Conoce tu historial', 'Entiende qué registra un operador de información y cómo se forma tu puntaje.', 1, 12, '[{"key":"score","title":"Tu puntaje no te define"},{"key":"report","title":"Lee tu reporte"},{"key":"rights","title":"Conoce tus derechos"}]'::jsonb, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000002', 'habitos-que-suman', 'Hábitos que suman', 'Construye constancia con decisiones pequeñas, medibles y sostenibles.', 2, 15, '[{"key":"budget","title":"Presupuesto sin enredos"},{"key":"dates","title":"Fechas que importan"},{"key":"capacity","title":"Tu capacidad de pago"}]'::jsonb, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000003', 'tu-primer-credito', 'Tu primer crédito', 'Aprende a comparar costos, firmar con criterio y pagar a tiempo.', 3, 18, '[{"key":"rates","title":"Tasas y costo total"},{"key":"contract","title":"Antes de firmar"},{"key":"payment","title":"Un plan que sí cumples"}]'::jsonb, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

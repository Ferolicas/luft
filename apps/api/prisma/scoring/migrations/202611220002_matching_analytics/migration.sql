-- CreateEnum
CREATE TYPE "InstitutionKind" AS ENUM ('BANCO', 'COMPANIA_FINANCIAMIENTO', 'COOPERATIVA', 'FINTECH', 'MICROFINANCIERA', 'FONDO_EMPLEADOS', 'CAJA_COMPENSACION', 'OTRA');

-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('LIBRE_INVERSION', 'TARJETA_CREDITO', 'VIVIENDA', 'VEHICULO', 'EDUCATIVO', 'MICROCREDITO', 'LIBRANZA', 'OTRO');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('BORRADOR', 'REVISION', 'APROBADA', 'VIGENTE', 'SUSTITUIDA', 'SUSPENDIDA');

-- CreateEnum
CREATE TYPE "RuleKind" AS ENUM ('REQUISITO', 'EXCLUSION', 'PREFERENCIA');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('ELEGIBLE', 'CON_BRECHAS', 'EXCLUIDO');

-- CreateEnum
CREATE TYPE "PresentationStatus" AS ENUM ('AUTORIZADA', 'REVOCADA', 'PRESENTADA', 'APROBADA', 'RECHAZADA', 'DESISTIDA');

-- CreateEnum
CREATE TYPE "OutcomeSubject" AS ENUM ('LOAN', 'PRESENTATION');

-- CreateEnum
CREATE TYPE "BacktestKind" AS ENUM ('POLICY_VERSION', 'RULE_SET');

-- CreateTable
CREATE TABLE "Institution" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "kind" "InstitutionKind" NOT NULL,
    "taxId" VARCHAR(20),
    "contactName" VARCHAR(160),
    "contactEmail" VARCHAR(254),
    "contactPhone" VARCHAR(20),
    "website" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialProduct" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "kind" "ProductKind" NOT NULL,
    "description" TEXT,
    "minAmountCOP" BIGINT,
    "maxAmountCOP" BIGINT,
    "minTermMonths" INTEGER,
    "maxTermMonths" INTEGER,
    "referenceRateEA" DECIMAL(8,5),
    "guarantees" JSONB NOT NULL DEFAULT '[]',
    "requiredDocuments" JSONB NOT NULL DEFAULT '[]',
    "channel" VARCHAR(80),
    "commissionPercent" DECIMAL(7,5),
    "commissionNotes" TEXT,
    "agreementReference" VARCHAR(160),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FinancialProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyVersion" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "PolicyStatus" NOT NULL DEFAULT 'BORRADOR',
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "sourceDocument" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "notes" TEXT,
    "responsibleUserId" UUID NOT NULL,
    "createdBy" UUID NOT NULL,
    "updatedBy" UUID NOT NULL,
    "submittedBy" UUID,
    "submittedAt" TIMESTAMPTZ(3),
    "approvedBy" UUID,
    "approvedByRole" VARCHAR(20),
    "approvedAt" TIMESTAMPTZ(3),
    "approvalIndependence" VARCHAR(20),
    "activatedBy" UUID,
    "activatedAt" TIMESTAMPTZ(3),
    "supersededById" UUID,
    "supersededAt" TIMESTAMPTZ(3),
    "suspendedBy" UUID,
    "suspendedAt" TIMESTAMPTZ(3),
    "suspensionReason" TEXT,
    "clonedFromId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyRule" (
    "id" UUID NOT NULL,
    "policyVersionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "field" VARCHAR(60) NOT NULL,
    "operator" VARCHAR(20) NOT NULL,
    "value" JSONB NOT NULL,
    "kind" "RuleKind" NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "label" VARCHAR(200) NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "exceptionAllowed" BOOLEAN NOT NULL DEFAULT false,
    "exceptionApprovalLevel" VARCHAR(20),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PolicyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyVersionEvent" (
    "id" UUID NOT NULL,
    "policyVersionId" UUID NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "fromStatus" "PolicyStatus",
    "toStatus" "PolicyStatus" NOT NULL,
    "actorUserId" UUID NOT NULL,
    "actorRole" VARCHAR(20) NOT NULL,
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyVersionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchingSupplement" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "dataCiphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MatchingSupplement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchRun" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "engineVersion" VARCHAR(40) NOT NULL,
    "trigger" VARCHAR(20) NOT NULL DEFAULT 'USER',
    "factsCiphertext" TEXT NOT NULL,
    "factsHash" CHAR(64) NOT NULL,
    "requestedAmountCOP" BIGINT,
    "requestedTermMonths" INTEGER,
    "productsEvaluated" INTEGER NOT NULL DEFAULT 0,
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchResult" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "policyVersionId" UUID NOT NULL,
    "policyVersionNumber" INTEGER NOT NULL,
    "policyEffectiveFrom" DATE,
    "productSnapshot" JSONB NOT NULL,
    "rulesSnapshot" JSONB NOT NULL,
    "fitPercent" INTEGER NOT NULL,
    "status" "MatchStatus" NOT NULL,
    "presentable" BOOLEAN NOT NULL DEFAULT false,
    "explanation" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchPresentation" (
    "id" UUID NOT NULL,
    "resultId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "policyVersionId" UUID NOT NULL,
    "status" "PresentationStatus" NOT NULL DEFAULT 'AUTORIZADA',
    "authorizationVersion" VARCHAR(32) NOT NULL,
    "authorizationText" TEXT NOT NULL,
    "authorizationHash" CHAR(64) NOT NULL,
    "authorizedScope" JSONB NOT NULL,
    "ipHash" CHAR(64),
    "userAgent" VARCHAR(500),
    "authorizedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sharedDataCiphertext" TEXT,
    "requiresException" BOOLEAN NOT NULL DEFAULT false,
    "exceptionApprovedBy" UUID,
    "exceptionApprovedRole" VARCHAR(20),
    "exceptionNote" TEXT,
    "revokedAt" TIMESTAMPTZ(3),
    "presentedAt" TIMESTAMPTZ(3),
    "presentedBy" UUID,
    "presentationChannel" VARCHAR(80),
    "presentationNote" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "decidedBy" UUID,
    "decidedByRole" VARCHAR(20),
    "approvedAmountCOP" BIGINT,
    "approvedRateEA" DECIMAL(8,5),
    "approvedTermMonths" INTEGER,
    "finalProductName" VARCHAR(160),
    "decisionReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MatchPresentation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ally" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "taxId" VARCHAR(20),
    "contactName" VARCHAR(160),
    "contactEmail" VARCHAR(254),
    "contactPhone" VARCHAR(20),
    "referralCode" VARCHAR(32) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Ally_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstitutionUser" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstitutionUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllyUser" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "allyId" UUID NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllyUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllyReferral" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "referredByAllyId" UUID NOT NULL,
    "source" VARCHAR(40) NOT NULL DEFAULT 'STAFF',
    "capturedBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllyReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cohort" (
    "id" UUID NOT NULL,
    "asOf" DATE NOT NULL,
    "groupBy" VARCHAR(20) NOT NULL,
    "originationMonth" CHAR(7) NOT NULL,
    "dimensionValue" VARCHAR(80) NOT NULL,
    "metrics" JSONB NOT NULL,
    "engineVersion" VARCHAR(40) NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cohort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outcome" (
    "id" UUID NOT NULL,
    "subjectType" "OutcomeSubject" NOT NULL,
    "subjectId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "originationMonth" CHAR(7),
    "productCode" VARCHAR(80),
    "approved" BOOLEAN,
    "amountCOP" BIGINT,
    "maxDaysPastDue" INTEGER NOT NULL DEFAULT 0,
    "everDpd30" BOOLEAN NOT NULL DEFAULT false,
    "everDpd60" BOOLEAN NOT NULL DEFAULT false,
    "everDpd90" BOOLEAN NOT NULL DEFAULT false,
    "installmentsDue" INTEGER NOT NULL DEFAULT 0,
    "installmentsOnTime" INTEGER NOT NULL DEFAULT 0,
    "installmentsLate" INTEGER NOT NULL DEFAULT 0,
    "installmentsPrepaid" INTEGER NOT NULL DEFAULT 0,
    "writtenOff" BOOLEAN NOT NULL DEFAULT false,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Outcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacktestRun" (
    "id" UUID NOT NULL,
    "kind" "BacktestKind" NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "policyVersionId" UUID,
    "params" JSONB NOT NULL,
    "paramsHash" CHAR(64) NOT NULL,
    "rulesSnapshot" JSONB NOT NULL,
    "engineVersion" VARCHAR(40) NOT NULL,
    "snapshotsEvaluated" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacktestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Institution_name_key" ON "Institution"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Institution_taxId_key" ON "Institution"("taxId");

-- CreateIndex
CREATE INDEX "Institution_active_name_idx" ON "Institution"("active", "name");

-- CreateIndex
CREATE INDEX "FinancialProduct_active_kind_idx" ON "FinancialProduct"("active", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialProduct_institutionId_name_key" ON "FinancialProduct"("institutionId", "name");

-- CreateIndex
CREATE INDEX "PolicyVersion_status_effectiveFrom_idx" ON "PolicyVersion"("status", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyVersion_productId_version_key" ON "PolicyVersion"("productId", "version");

-- CreateIndex
CREATE INDEX "PolicyRule_policyVersionId_position_idx" ON "PolicyRule"("policyVersionId", "position");

-- CreateIndex
CREATE INDEX "PolicyVersionEvent_policyVersionId_createdAt_idx" ON "PolicyVersionEvent"("policyVersionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MatchingSupplement_userId_key" ON "MatchingSupplement"("userId");

-- CreateIndex
CREATE INDEX "MatchRun_userId_createdAt_idx" ON "MatchRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MatchRun_createdAt_idx" ON "MatchRun"("createdAt");

-- CreateIndex
CREATE INDEX "MatchResult_userId_createdAt_idx" ON "MatchResult"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MatchResult_policyVersionId_status_idx" ON "MatchResult"("policyVersionId", "status");

-- CreateIndex
CREATE INDEX "MatchResult_productId_createdAt_idx" ON "MatchResult"("productId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MatchResult_runId_productId_key" ON "MatchResult"("runId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchPresentation_resultId_key" ON "MatchPresentation"("resultId");

-- CreateIndex
CREATE INDEX "MatchPresentation_userId_createdAt_idx" ON "MatchPresentation"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MatchPresentation_institutionId_status_presentedAt_idx" ON "MatchPresentation"("institutionId", "status", "presentedAt");

-- CreateIndex
CREATE INDEX "MatchPresentation_status_createdAt_idx" ON "MatchPresentation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MatchPresentation_productId_status_idx" ON "MatchPresentation"("productId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Ally_name_key" ON "Ally"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Ally_taxId_key" ON "Ally"("taxId");

-- CreateIndex
CREATE UNIQUE INDEX "Ally_referralCode_key" ON "Ally"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "InstitutionUser_userId_key" ON "InstitutionUser"("userId");

-- CreateIndex
CREATE INDEX "InstitutionUser_institutionId_idx" ON "InstitutionUser"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "AllyUser_userId_key" ON "AllyUser"("userId");

-- CreateIndex
CREATE INDEX "AllyUser_allyId_idx" ON "AllyUser"("allyId");

-- CreateIndex
CREATE UNIQUE INDEX "AllyReferral_userId_key" ON "AllyReferral"("userId");

-- CreateIndex
CREATE INDEX "AllyReferral_referredByAllyId_createdAt_idx" ON "AllyReferral"("referredByAllyId", "createdAt");

-- CreateIndex
CREATE INDEX "Cohort_originationMonth_groupBy_idx" ON "Cohort"("originationMonth", "groupBy");

-- CreateIndex
CREATE UNIQUE INDEX "Cohort_asOf_groupBy_originationMonth_dimensionValue_key" ON "Cohort"("asOf", "groupBy", "originationMonth", "dimensionValue");

-- CreateIndex
CREATE INDEX "Outcome_userId_subjectType_idx" ON "Outcome"("userId", "subjectType");

-- CreateIndex
CREATE INDEX "Outcome_originationMonth_idx" ON "Outcome"("originationMonth");

-- CreateIndex
CREATE UNIQUE INDEX "Outcome_subjectType_subjectId_key" ON "Outcome"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "BacktestRun_createdAt_idx" ON "BacktestRun"("createdAt");

-- CreateIndex
CREATE INDEX "BacktestRun_policyVersionId_idx" ON "BacktestRun"("policyVersionId");

-- AddForeignKey
ALTER TABLE "FinancialProduct" ADD CONSTRAINT "FinancialProduct_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "FinancialProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyRule" ADD CONSTRAINT "PolicyRule_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PolicyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyVersionEvent" ADD CONSTRAINT "PolicyVersionEvent_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PolicyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchResult" ADD CONSTRAINT "MatchResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MatchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchResult" ADD CONSTRAINT "MatchResult_productId_fkey" FOREIGN KEY ("productId") REFERENCES "FinancialProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchResult" ADD CONSTRAINT "MatchResult_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPresentation" ADD CONSTRAINT "MatchPresentation_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "MatchResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPresentation" ADD CONSTRAINT "MatchPresentation_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstitutionUser" ADD CONSTRAINT "InstitutionUser_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllyUser" ADD CONSTRAINT "AllyUser_allyId_fkey" FOREIGN KEY ("allyId") REFERENCES "Ally"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllyReferral" ADD CONSTRAINT "AllyReferral_referredByAllyId_fkey" FOREIGN KEY ("referredByAllyId") REFERENCES "Ally"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Una sola versión VIGENTE por producto: la base rechaza dos políticas en
-- vigor aunque dos analistas activen versiones al mismo tiempo.
CREATE UNIQUE INDEX "PolicyVersion_productId_vigente_key" ON "PolicyVersion"("productId") WHERE "status" = 'VIGENTE';

-- Una sola presentación abierta por persona y producto.
CREATE UNIQUE INDEX "MatchPresentation_userId_productId_open_key" ON "MatchPresentation"("userId", "productId") WHERE "status" IN ('AUTORIZADA', 'PRESENTADA');

-- Invariantes de dominio que no dependen de la aplicación.
ALTER TABLE "FinancialProduct" ADD CONSTRAINT "FinancialProduct_amount_range_check" CHECK ("minAmountCOP" IS NULL OR "maxAmountCOP" IS NULL OR "minAmountCOP" <= "maxAmountCOP");
ALTER TABLE "FinancialProduct" ADD CONSTRAINT "FinancialProduct_amount_positive_check" CHECK (("minAmountCOP" IS NULL OR "minAmountCOP" >= 0) AND ("maxAmountCOP" IS NULL OR "maxAmountCOP" >= 0));
ALTER TABLE "FinancialProduct" ADD CONSTRAINT "FinancialProduct_term_range_check" CHECK (("minTermMonths" IS NULL OR "minTermMonths" >= 1) AND ("maxTermMonths" IS NULL OR "maxTermMonths" >= 1) AND ("minTermMonths" IS NULL OR "maxTermMonths" IS NULL OR "minTermMonths" <= "maxTermMonths"));
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_version_check" CHECK ("version" >= 1);
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_effective_range_check" CHECK ("effectiveFrom" IS NULL OR "effectiveTo" IS NULL OR "effectiveFrom" <= "effectiveTo");
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_vigente_requires_approval_check" CHECK ("status" <> 'VIGENTE' OR ("approvedBy" IS NOT NULL AND "effectiveFrom" IS NOT NULL));
ALTER TABLE "PolicyRule" ADD CONSTRAINT "PolicyRule_weight_check" CHECK ("weight" BETWEEN 1 AND 100);
ALTER TABLE "MatchResult" ADD CONSTRAINT "MatchResult_fitPercent_check" CHECK ("fitPercent" BETWEEN 0 AND 100);
ALTER TABLE "MatchPresentation" ADD CONSTRAINT "MatchPresentation_approved_terms_check" CHECK ("status" <> 'APROBADA' OR ("approvedAmountCOP" IS NOT NULL AND "approvedAmountCOP" > 0 AND "approvedRateEA" IS NOT NULL AND "approvedTermMonths" IS NOT NULL AND "approvedTermMonths" >= 1));

-- Sin GRANT: el rol dueño del esquema tiene ALTER DEFAULT PRIVILEGES que da
-- acceso automático a luft_scoring sobre las tablas nuevas.

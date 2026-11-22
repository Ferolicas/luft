-- LUFT + STARTIF V2 · dominio LUFT.
-- Categorías, arquetipos versionados, ruta, planes y hogar, evidencias y
-- fotografías del perfil, formalización tributaria, tarjetas, proyectos de
-- vida, Open Finance, consentimientos y notificaciones.
--
-- Solo agrega: no modifica ni borra datos existentes. Prisma la ejecuta como
-- una sola transacción; los catálogos se siembran con ON CONFLICT DO NOTHING.
-- Los códigos de arquetipo anteriores (INICIADOR, CONSTRUCTOR, EXPLORADOR,
-- ESTRATEGA) siguen siendo válidos en "FinancialProfile"."archetype": la API
-- los reemplaza por el arquetipo versionado de la categoría la próxima vez
-- que sincroniza la ruta de cada persona y conserva el código anterior en
-- "ArchetypeAssignment"."legacyCode" (equivalencia documentada en
-- apps/api/src/catalog/archetype-engine.ts).

-- AlterEnum (PostgreSQL 12+: los valores nuevos no se usan en esta migración)
ALTER TYPE "ConsentKind" ADD VALUE IF NOT EXISTS 'HOUSEHOLD_SHARING';
ALTER TYPE "ConsentKind" ADD VALUE IF NOT EXISTS 'OPEN_FINANCE';
ALTER TYPE "ConsentKind" ADD VALUE IF NOT EXISTS 'TAX_ASSISTANCE';

-- AlterTable
ALTER TABLE "Consent" ADD COLUMN     "expiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "revokedReason" VARCHAR(200),
ADD COLUMN     "scope" JSONB;

-- CreateTable
CREATE TABLE "ServiceCategory" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "brand" VARCHAR(80) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "description" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "updatedBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ServiceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Archetype" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Archetype_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRoute" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "stage" VARCHAR(32) NOT NULL DEFAULT 'REGISTRADO',
    "origin" VARCHAR(20) NOT NULL DEFAULT 'INITIAL',
    "title" VARCHAR(160),
    "suggestedCategoryCode" VARCHAR(40),
    "categoryChosenByUser" BOOLEAN NOT NULL DEFAULT false,
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "lifeProjectId" UUID,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stageChangedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),
    "closedReason" VARCHAR(80),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteTransition" (
    "id" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "fromStage" VARCHAR(32) NOT NULL,
    "toStage" VARCHAR(32) NOT NULL,
    "reason" VARCHAR(80) NOT NULL,
    "facts" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouteTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchetypeAssignment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "routeId" UUID,
    "categoryCode" VARCHAR(40) NOT NULL,
    "archetypeId" UUID NOT NULL,
    "archetypeCode" VARCHAR(40) NOT NULL,
    "archetypeName" VARCHAR(120) NOT NULL,
    "archetypeVersion" INTEGER NOT NULL,
    "reason" VARCHAR(80) NOT NULL,
    "explanation" JSONB NOT NULL,
    "factsCiphertext" TEXT NOT NULL,
    "signature" CHAR(64) NOT NULL,
    "legacyCode" VARCHAR(40),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMPTZ(3),

    CONSTRAINT "ArchetypeAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" TEXT NOT NULL,
    "minSeats" INTEGER NOT NULL,
    "maxSeats" INTEGER NOT NULL,
    "basePriceCOP" BIGINT NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "updatedBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "planCode" VARCHAR(20) NOT NULL,
    "seats" INTEGER NOT NULL,
    "basePriceCOP" BIGINT NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL,
    "pricePerSeatCOP" BIGINT NOT NULL,
    "totalCOP" BIGINT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'SELECTED',
    "activatedAt" TIMESTAMPTZ(3),
    "endedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Household" (
    "id" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseholdMember" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "seatAssigned" BOOLEAN NOT NULL DEFAULT false,
    "permissions" JSONB NOT NULL,
    "consentId" UUID,
    "invitationId" UUID,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "HouseholdMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseholdInvitation" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "invitedBy" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "seatAssigned" BOOLEAN NOT NULL DEFAULT false,
    "tokenHash" CHAR(64) NOT NULL,
    "inviteeName" VARCHAR(80),
    "channel" VARCHAR(20),
    "contactCiphertext" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedBy" UUID,
    "acceptedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseholdInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedGoal" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "kind" VARCHAR(40),
    "targetCOP" BIGINT NOT NULL,
    "targetDate" DATE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SharedGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contribution" (
    "id" UUID NOT NULL,
    "goalId" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "contributorUserId" UUID NOT NULL,
    "amountCOP" BIGINT NOT NULL,
    "note" VARCHAR(280),
    "documentId" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DECLARED',
    "declaredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedBy" UUID,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Contribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "sourceKind" VARCHAR(40) NOT NULL,
    "sourceRef" VARCHAR(200) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "value" JSONB,
    "valueCiphertext" TEXT,
    "status" VARCHAR(20) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "validUntil" TIMESTAMPTZ(3),
    "validatedBy" VARCHAR(60),
    "validatedAt" TIMESTAMPTZ(3),
    "consentId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialProfileSnapshot" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "reason" VARCHAR(80) NOT NULL,
    "summary" JSONB NOT NULL,
    "payloadCiphertext" TEXT NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialProfileSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRuleVersion" (
    "id" UUID NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "uvtCOP" INTEGER NOT NULL,
    "wealthUvt" INTEGER NOT NULL,
    "incomeUvt" INTEGER NOT NULL,
    "cardSpendUvt" INTEGER NOT NULL,
    "purchasesUvt" INTEGER NOT NULL,
    "depositsUvt" INTEGER NOT NULL,
    "sourceDocument" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdBy" UUID,
    "approvedBy" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "activatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TaxRuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormalizationCase" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'SIN_EVALUAR',
    "ruleVersionId" UUID,
    "mayHaveToFile" BOOLEAN,
    "diagnosisCiphertext" TEXT,
    "diagnosedAt" TIMESTAMPTZ(3),
    "alreadyFiled" BOOLEAN,
    "path" VARCHAR(20),
    "preparation" JSONB,
    "consentId" UUID,
    "submittedAt" TIMESTAMPTZ(3),
    "reviewerId" UUID,
    "reviewApprovedBy" UUID,
    "reviewApprovedAt" TIMESTAMPTZ(3),
    "formNumberCiphertext" TEXT,
    "filedAt" DATE,
    "verifiedBy" UUID,
    "verifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FormalizationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormalizationEvent" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "fromStatus" VARCHAR(32),
    "toStatus" VARCHAR(32) NOT NULL,
    "actorUserId" UUID,
    "actorRole" VARCHAR(40),
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormalizationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDocument" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" VARCHAR(40) NOT NULL,
    "refId" UUID,
    "fileName" VARCHAR(160) NOT NULL,
    "mimeType" VARCHAR(80) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "UserDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardAccount" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'SELF_DECLARED',
    "issuer" VARCHAR(80) NOT NULL,
    "alias" VARCHAR(60),
    "last4" CHAR(4),
    "creditLimitCOP" BIGINT NOT NULL,
    "usedBalanceCOP" BIGINT NOT NULL,
    "statementDay" INTEGER NOT NULL,
    "paymentDay" INTEGER NOT NULL,
    "minimumPaymentCOP" BIGINT,
    "annualEffectiveRate" DECIMAL(8,6),
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CardAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardPurchase" (
    "id" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "amountCOP" BIGINT NOT NULL,
    "installments" INTEGER NOT NULL,
    "purchasedAt" DATE NOT NULL,
    "description" VARCHAR(160) NOT NULL,
    "isCashAdvance" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardGuidance" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "cardId" UUID,
    "code" VARCHAR(60) NOT NULL,
    "severity" VARCHAR(20) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'SHOWN',
    "baselineUtilization" DECIMAL(6,2),
    "measuredUtilization" DECIMAL(6,2),
    "effectiveness" VARCHAR(20),
    "shownAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMPTZ(3),
    "measuredAt" TIMESTAMPTZ(3),

    CONSTRAINT "CardGuidance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LifeProject" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "targetCOP" BIGINT NOT NULL,
    "savedCOP" BIGINT NOT NULL DEFAULT 0,
    "monthlyCapacityCOP" BIGINT,
    "targetDate" DATE NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "routeId" UUID,
    "goalId" UUID,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LifeProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenFinanceConnection" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" VARCHAR(60),
    "institution" VARCHAR(120),
    "status" VARCHAR(32) NOT NULL,
    "scopes" JSONB NOT NULL,
    "consentId" UUID NOT NULL,
    "externalId" VARCHAR(160),
    "errorCode" VARCHAR(80),
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "activatedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "lastSyncAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OpenFinanceConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" TEXT NOT NULL,
    "href" VARCHAR(200),
    "dedupeKey" VARCHAR(200),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMPTZ(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCategory_code_key" ON "ServiceCategory"("code");

-- CreateIndex
CREATE INDEX "Archetype_categoryId_active_priority_idx" ON "Archetype"("categoryId", "active", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "Archetype_categoryId_code_version_key" ON "Archetype"("categoryId", "code", "version");

-- CreateIndex
CREATE INDEX "UserRoute_userId_status_idx" ON "UserRoute"("userId", "status");

-- CreateIndex
CREATE INDEX "RouteTransition_routeId_createdAt_idx" ON "RouteTransition"("routeId", "createdAt");

-- CreateIndex
CREATE INDEX "RouteTransition_userId_createdAt_idx" ON "RouteTransition"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ArchetypeAssignment_userId_createdAt_idx" ON "ArchetypeAssignment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ArchetypeAssignment_userId_supersededAt_idx" ON "ArchetypeAssignment"("userId", "supersededAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_code_key" ON "SubscriptionPlan"("code");

-- CreateIndex
CREATE INDEX "Subscription_userId_status_idx" ON "Subscription"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Household_ownerUserId_key" ON "Household"("ownerUserId");

-- CreateIndex
CREATE INDEX "HouseholdMember_householdId_status_idx" ON "HouseholdMember"("householdId", "status");

-- CreateIndex
CREATE INDEX "HouseholdMember_userId_status_idx" ON "HouseholdMember"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "HouseholdInvitation_tokenHash_key" ON "HouseholdInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "HouseholdInvitation_householdId_status_idx" ON "HouseholdInvitation"("householdId", "status");

-- CreateIndex
CREATE INDEX "SharedGoal_householdId_status_idx" ON "SharedGoal"("householdId", "status");

-- CreateIndex
CREATE INDEX "Contribution_goalId_status_idx" ON "Contribution"("goalId", "status");

-- CreateIndex
CREATE INDEX "Contribution_contributorUserId_declaredAt_idx" ON "Contribution"("contributorUserId", "declaredAt");

-- CreateIndex
CREATE INDEX "Evidence_userId_status_idx" ON "Evidence"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_userId_type_sourceRef_key" ON "Evidence"("userId", "type", "sourceRef");

-- CreateIndex
CREATE INDEX "FinancialProfileSnapshot_userId_createdAt_idx" ON "FinancialProfileSnapshot"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialProfileSnapshot_userId_version_key" ON "FinancialProfileSnapshot"("userId", "version");

-- CreateIndex
CREATE INDEX "TaxRuleVersion_taxYear_status_idx" ON "TaxRuleVersion"("taxYear", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TaxRuleVersion_taxYear_version_key" ON "TaxRuleVersion"("taxYear", "version");

-- CreateIndex
CREATE INDEX "FormalizationCase_status_updatedAt_idx" ON "FormalizationCase"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FormalizationCase_userId_taxYear_key" ON "FormalizationCase"("userId", "taxYear");

-- CreateIndex
CREATE INDEX "FormalizationEvent_caseId_createdAt_idx" ON "FormalizationEvent"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "FormalizationEvent_userId_createdAt_idx" ON "FormalizationEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserDocument_userId_purpose_idx" ON "UserDocument"("userId", "purpose");

-- CreateIndex
CREATE INDEX "UserDocument_refId_idx" ON "UserDocument"("refId");

-- CreateIndex
CREATE INDEX "CardAccount_userId_archivedAt_idx" ON "CardAccount"("userId", "archivedAt");

-- CreateIndex
CREATE INDEX "CardPurchase_cardId_purchasedAt_idx" ON "CardPurchase"("cardId", "purchasedAt");

-- CreateIndex
CREATE INDEX "CardPurchase_userId_createdAt_idx" ON "CardPurchase"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CardGuidance_userId_status_idx" ON "CardGuidance"("userId", "status");

-- CreateIndex
CREATE INDEX "CardGuidance_userId_cardId_code_idx" ON "CardGuidance"("userId", "cardId", "code");

-- CreateIndex
CREATE INDEX "LifeProject_userId_status_idx" ON "LifeProject"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OpenFinanceConnection_externalId_key" ON "OpenFinanceConnection"("externalId");

-- CreateIndex
CREATE INDEX "OpenFinanceConnection_userId_status_idx" ON "OpenFinanceConnection"("userId", "status");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "Archetype" ADD CONSTRAINT "Archetype_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoute" ADD CONSTRAINT "UserRoute_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteTransition" ADD CONSTRAINT "RouteTransition_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "UserRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchetypeAssignment" ADD CONSTRAINT "ArchetypeAssignment_archetypeId_fkey" FOREIGN KEY ("archetypeId") REFERENCES "Archetype"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchetypeAssignment" ADD CONSTRAINT "ArchetypeAssignment_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "UserRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdMember" ADD CONSTRAINT "HouseholdMember_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdInvitation" ADD CONSTRAINT "HouseholdInvitation_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedGoal" ADD CONSTRAINT "SharedGoal_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "SharedGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormalizationCase" ADD CONSTRAINT "FormalizationCase_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "TaxRuleVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormalizationEvent" ADD CONSTRAINT "FormalizationEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "FormalizationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardPurchase" ADD CONSTRAINT "CardPurchase_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CardAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Reglas que Prisma no modela: estados válidos (CHECK) e índices únicos
-- parciales. Los estados se guardan como texto para poder ampliarlos con una
-- migración simple; estos CHECK impiden valores fuera de la máquina de estados.
-- ---------------------------------------------------------------------------

ALTER TABLE "UserRoute"
  ADD CONSTRAINT "UserRoute_status_check" CHECK ("status" IN ('ACTIVE', 'CLOSED')),
  ADD CONSTRAINT "UserRoute_stage_check" CHECK ("stage" IN ('REGISTRADO', 'DIAGNOSTICADO', 'FORMALIZACION', 'FORMACION', 'CREDITO_1', 'SEGUIMIENTO', 'CREDITO_2_OPCIONAL', 'PERFIL_FINAL', 'MATCHING', 'RELACION_CONTINUA')),
  ADD CONSTRAINT "UserRoute_origin_check" CHECK ("origin" IN ('INITIAL', 'LIFE_STAGE', 'PROJECT')),
  ADD CONSTRAINT "UserRoute_progress_check" CHECK ("progressPercent" BETWEEN 0 AND 100);

ALTER TABLE "SubscriptionPlan"
  ADD CONSTRAINT "SubscriptionPlan_seats_check" CHECK ("minSeats" >= 1 AND "maxSeats" >= "minSeats"),
  ADD CONSTRAINT "SubscriptionPlan_price_check" CHECK ("basePriceCOP" >= 0),
  ADD CONSTRAINT "SubscriptionPlan_discount_check" CHECK ("discountPercent" BETWEEN 0 AND 100);

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_status_check" CHECK ("status" IN ('SELECTED', 'ACTIVE', 'REPLACED', 'CANCELLED')),
  ADD CONSTRAINT "Subscription_seats_check" CHECK ("seats" >= 1);

ALTER TABLE "HouseholdMember"
  ADD CONSTRAINT "HouseholdMember_role_check" CHECK ("role" IN ('OWNER', 'BENEFICIARY', 'SUPPORT')),
  ADD CONSTRAINT "HouseholdMember_status_check" CHECK ("status" IN ('ACTIVE', 'LEFT', 'REMOVED'));

ALTER TABLE "HouseholdInvitation"
  ADD CONSTRAINT "HouseholdInvitation_role_check" CHECK ("role" IN ('BENEFICIARY', 'SUPPORT')),
  ADD CONSTRAINT "HouseholdInvitation_status_check" CHECK ("status" IN ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'));

ALTER TABLE "SharedGoal"
  ADD CONSTRAINT "SharedGoal_status_check" CHECK ("status" IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
  ADD CONSTRAINT "SharedGoal_target_check" CHECK ("targetCOP" > 0);

ALTER TABLE "Contribution"
  ADD CONSTRAINT "Contribution_status_check" CHECK ("status" IN ('DECLARED', 'CONFIRMED', 'REJECTED')),
  ADD CONSTRAINT "Contribution_amount_check" CHECK ("amountCOP" > 0);

ALTER TABLE "Evidence"
  ADD CONSTRAINT "Evidence_status_check" CHECK ("status" IN ('VERIFIED', 'DECLARED', 'PENDING', 'WITHDRAWN'));

ALTER TABLE "TaxRuleVersion"
  ADD CONSTRAINT "TaxRuleVersion_status_check" CHECK ("status" IN ('DRAFT', 'APPROVED', 'ACTIVE', 'SUPERSEDED')),
  ADD CONSTRAINT "TaxRuleVersion_values_check" CHECK ("uvtCOP" > 0 AND "wealthUvt" > 0 AND "incomeUvt" > 0 AND "cardSpendUvt" > 0 AND "purchasesUvt" > 0 AND "depositsUvt" > 0);

ALTER TABLE "FormalizationCase"
  ADD CONSTRAINT "FormalizationCase_status_check" CHECK ("status" IN ('SIN_EVALUAR', 'NO_REQUIERE', 'POSIBLE_OBLIGACION', 'DOCUMENTO_CARGADO', 'PREPARACION_GUIADA', 'REVISION', 'PRESENTADO', 'VERIFICADO')),
  ADD CONSTRAINT "FormalizationCase_path_check" CHECK ("path" IS NULL OR "path" IN ('UPLOAD', 'GUIDED'));

ALTER TABLE "CardAccount"
  ADD CONSTRAINT "CardAccount_source_check" CHECK ("source" IN ('SELF_DECLARED', 'OPEN_FINANCE')),
  ADD CONSTRAINT "CardAccount_days_check" CHECK ("statementDay" BETWEEN 1 AND 31 AND "paymentDay" BETWEEN 1 AND 31),
  ADD CONSTRAINT "CardAccount_amounts_check" CHECK ("creditLimitCOP" > 0 AND "usedBalanceCOP" >= 0 AND ("minimumPaymentCOP" IS NULL OR "minimumPaymentCOP" >= 0)),
  ADD CONSTRAINT "CardAccount_rate_check" CHECK ("annualEffectiveRate" IS NULL OR "annualEffectiveRate" BETWEEN 0 AND 1);

ALTER TABLE "CardPurchase"
  ADD CONSTRAINT "CardPurchase_amount_check" CHECK ("amountCOP" > 0),
  ADD CONSTRAINT "CardPurchase_installments_check" CHECK ("installments" BETWEEN 1 AND 60);

ALTER TABLE "CardGuidance"
  ADD CONSTRAINT "CardGuidance_status_check" CHECK ("status" IN ('SHOWN', 'ACCEPTED', 'DISMISSED', 'RESOLVED')),
  ADD CONSTRAINT "CardGuidance_effectiveness_check" CHECK ("effectiveness" IS NULL OR "effectiveness" IN ('IMPROVED', 'UNCHANGED', 'WORSENED'));

ALTER TABLE "LifeProject"
  ADD CONSTRAINT "LifeProject_kind_check" CHECK ("kind" IN ('EDUCACION', 'MOVILIDAD', 'VIVIENDA', 'EMPRENDIMIENTO', 'OTRO')),
  ADD CONSTRAINT "LifeProject_status_check" CHECK ("status" IN ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED')),
  ADD CONSTRAINT "LifeProject_amounts_check" CHECK ("targetCOP" > 0 AND "savedCOP" >= 0);

ALTER TABLE "OpenFinanceConnection"
  ADD CONSTRAINT "OpenFinanceConnection_status_check" CHECK ("status" IN ('PENDING', 'CONFIGURATION_REQUIRED', 'AUTHORIZATION_PENDING', 'ACTIVE', 'REVOKED', 'EXPIRED', 'FAILED'));

-- Una ruta activa por persona; las anteriores quedan como historia.
CREATE UNIQUE INDEX "UserRoute_one_active_per_user" ON "UserRoute"("userId") WHERE "status" = 'ACTIVE';

-- Un arquetipo vigente por persona; los anteriores conservan fecha de reemplazo.
CREATE UNIQUE INDEX "ArchetypeAssignment_one_current_per_user" ON "ArchetypeAssignment"("userId") WHERE "supersededAt" IS NULL;

-- Un arquetipo por defecto activo por categoría.
CREATE UNIQUE INDEX "Archetype_one_default_per_category" ON "Archetype"("categoryId") WHERE "isDefault" AND "active";

-- Un plan vigente por comprador; los cambios quedan como historial.
CREATE UNIQUE INDEX "Subscription_one_live_per_user" ON "Subscription"("userId") WHERE "status" IN ('SELECTED', 'ACTIVE');

-- Una persona participa activamente en un solo hogar.
CREATE UNIQUE INDEX "HouseholdMember_one_active_per_user" ON "HouseholdMember"("userId") WHERE "status" = 'ACTIVE';

-- Una sola versión de reglas tributarias vigente por año gravable.
CREATE UNIQUE INDEX "TaxRuleVersion_one_active_per_year" ON "TaxRuleVersion"("taxYear") WHERE "status" = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- Catálogos iniciales. Todo es administrable después desde /api/admin.
-- ---------------------------------------------------------------------------

-- Categorías de servicio: Joven = LUFT Impulso, Adulto = LUFT Avanza, Familia = LUFT Juntos.
INSERT INTO "ServiceCategory" ("id", "code", "brand", "label", "description", "position", "active", "updatedAt", "config") VALUES
('20000000-0000-4000-8000-000000000001', 'JOVEN', 'LUFT Impulso', 'Joven', 'Construye tu primera identidad financiera y prepárate para tus primeras grandes decisiones.', 1, true, CURRENT_TIMESTAMP, '{"onboarding":{"headline":"Tu primera identidad financiera","steps":["Conoce tu punto de partida en las centrales de riesgo","Aprende con lecciones cortas pensadas para tu momento","Demuestra tu comportamiento con tu crédito constructor"]},"modules":["conoce-tu-historial","habitos-que-suman","tu-primer-credito"],"requiredDocuments":["BANK_STATEMENTS"],"messages":{"welcome":"Construye tu primera identidad financiera y prepárate para tus primeras grandes decisiones.","nextStep":"Cada paso deja una evidencia real en tu perfil.","matching":"Cuando termines tu ruta te mostraremos productos que encajan con tu perfil."},"projectKinds":["EDUCACION","MOVILIDAD","EMPRENDIMIENTO","OTRO"]}'::jsonb),
('20000000-0000-4000-8000-000000000002', 'ADULTO', 'LUFT Avanza', 'Adulto', 'Formaliza tu realidad económica y convierte tu experiencia de vida en evidencia financiera.', 2, true, CURRENT_TIMESTAMP, '{"onboarding":{"headline":"Tu experiencia también cuenta","steps":["Revisa cómo te ven hoy las centrales de riesgo","Formaliza tus ingresos y tus soportes","Demuestra constancia con tu crédito constructor"]},"modules":["conoce-tu-historial","habitos-que-suman","tu-primer-credito"],"requiredDocuments":["BANK_STATEMENTS","SOCIAL_SECURITY","EMPLOYMENT_CERTIFICATE"],"messages":{"welcome":"Formaliza tu realidad económica y convierte tu experiencia de vida en evidencia financiera.","nextStep":"Tus ingresos y soportes son la base de tu perfil.","matching":"Con tu perfil final buscaremos los productos que mejor encajan contigo."},"projectKinds":["VIVIENDA","MOVILIDAD","EMPRENDIMIENTO","EDUCACION","OTRO"]}'::jsonb),
('20000000-0000-4000-8000-000000000003', 'FAMILIA', 'LUFT Juntos', 'Familia', 'Contrata varias rutas independientes y coordina el apoyo familiar sin mezclar identidades.', 3, true, CURRENT_TIMESTAMP, '{"onboarding":{"headline":"Un paquete, identidades independientes","steps":["Elige cuántas rutas necesita tu hogar","Invita a cada integrante a activar su propia cuenta","Compartan metas y aportes, no perfiles"]},"modules":["conoce-tu-historial","habitos-que-suman","tu-primer-credito"],"requiredDocuments":["BANK_STATEMENTS","SOCIAL_SECURITY"],"messages":{"welcome":"Contrata varias rutas independientes y coordina el apoyo familiar sin mezclar identidades.","nextStep":"Cada integrante avanza en su propia ruta y decide qué comparte.","matching":"Cada integrante recibe su propio matching y sus propios productos."},"projectKinds":["VIVIENDA","EDUCACION","EMPRENDIMIENTO","MOVILIDAD","OTRO"]}'::jsonb)
ON CONFLICT ("code") DO NOTHING;

-- Arquetipos iniciales (versión 1). Las reglas usan solo hechos que la app recoge:
-- clasificación, situación laboral, tipo de contrato, fuentes de ingreso,
-- patrimonio, seguridad social, hogar y proyectos de vida.
INSERT INTO "Archetype" ("id", "categoryId", "code", "name", "description", "priority", "version", "isDefault", "active", "rules") VALUES
('21000000-0000-4000-8000-000000000001', (SELECT "id" FROM "ServiceCategory" WHERE "code" = 'JOVEN'), 'EXPLORADOR_CONSCIENTE', 'Explorador consciente', 'Estás empezando a conocer el sistema financiero y quieres hacerlo con criterio, paso a paso y con información.', 10, 1, true, true, '{"any":[{"fact":"creditExperience","op":"eq","value":"NONE","label":"Aún no has tenido productos de crédito"}]}'::jsonb),
('21000000-0000-4000-8000-000000000002', (SELECT "id" FROM "ServiceCategory" WHERE "code" = 'JOVEN'), 'UNIVERSITARIO_INDEPENDIENTE', 'Universitario independiente', 'Estudias y ya generas ingresos propios: necesitas ordenar tu plata y dejar evidencia de tu constancia.', 30, 1, false, true, '{"all":[{"fact":"employmentSituation","op":"eq","value":"ESTUDIANTE","label":"Eres estudiante"},{"fact":"monthlyIncomeCOP","op":"gt","value":0,"label":"Generas ingresos propios mientras estudias"}]}'::jsonb),
('21000000-0000-4000-8000-000000000003', (SELECT "id" FROM "ServiceCategory" WHERE "code" = 'JOVEN'), 'EMPRENDEDOR_EMERGENTE', 'Emprendedor emergente', 'Tienes un negocio o trabajas por tu cuenta y quieres que tus ventas e ingresos cuenten como historia financiera.', 40, 1, false, true, '{"any":[{"fact":"incomeKinds","op":"includes","value":"VENTAS","label":"Tienes ingresos por ventas de un negocio propio"},{"fact":"employmentSituation","op":"eq","value":"INDEPENDIENTE","label":"Trabajas por tu cuenta"},{"fact":"lifeProjectKinds","op":"includes","value":"EMPRENDIMIENTO","label":"Tienes un proyecto de emprendimiento en marcha"}]}'::jsonb),
('21000000-0000-4000-8000-000000000004', (SELECT "id" FROM "ServiceCategory" WHERE "code" = 'JOVEN'), 'PROXIMO_AL_EGRESO', 'Próximo al egreso', 'Estás terminando tu formación y entrando al mundo laboral: es el momento de preparar tus primeras decisiones grandes.', 50, 1, false, true, '{"any":[{"fact":"contractType","op":"eq","value":"APRENDIZAJE","label":"Tienes contrato de aprendizaje o práctica"},{"all":[{"fact":"employmentSituation","op":"eq","value":"ESTUDIANTE","label":"Eres estudiante"},{"fact":"contractType","op":"in","value":["LABORAL","OBRA_LABOR","PRESTACION_SERVICIOS"],"label":"Ya tienes un contrato de trabajo mientras terminas tus estudios"}]}]}'::jsonb),
('21000000-0000-4000-8000-000000000005', (SELECT "id" FROM "ServiceCategory" WHERE "code" = 'ADULTO'), 'PROFESIONAL_SIN_HISTORIAL', 'Profesional sin historial', 'Tienes ingresos estables pero el sistema financiero aún no te conoce: vas a convertir tu estabilidad en evidencia.', 10, 1, true, true, '{"all":[{"fact":"creditExperience","op":"eq","value":"NONE","label":"No has tenido productos de crédito"},{"fact":"employmentSituation","op":"in","value":["EMPLEADO","PENSIONADO"],"label":"Tienes un ingreso estable como empleado o pensionado"}]}'::jsonb),
('21000000-0000-4000-8000-000000000006', (SELECT "id" FROM "ServiceCategory" WHERE "code" = 'ADULTO'), 'INDEPENDIENTE_EN_CONSOLIDACION', 'Independiente en consolidación', 'Trabajas por tu cuenta y tus ingresos varían: formalizarlos y documentarlos es tu mejor carta de presentación.', 30, 1, false, true, '{"any":[{"fact":"employmentSituation","op":"eq","value":"INDEPENDIENTE","label":"Trabajas por tu cuenta"},{"fact":"contractType","op":"eq","value":"PRESTACION_SERVICIOS","label":"Trabajas por prestación de servicios"},{"fact":"incomeKinds","op":"includes","value":"HONORARIOS","label":"Recibes honorarios"}]}'::jsonb),
('21000000-0000-4000-8000-000000000007', (SELECT "id" FROM "ServiceCategory" WHERE "code" = 'ADULTO'), 'EMPRENDEDOR_ESTABLECIDO', 'Emprendedor establecido', 'Tu negocio ya genera ventas y tiene respaldo: el reto es que esa trayectoria quede documentada y sea verificable.', 40, 1, false, true, '{"all":[{"fact":"incomeKinds","op":"includes","value":"VENTAS","label":"Tienes ingresos por ventas de tu negocio"},{"any":[{"fact":"socialSecurity","op":"eq","value":"INDEPENDIENTE","label":"Cotizas seguridad social como independiente"},{"fact":"creditExperience","op":"eq","value":"UP_TO_DATE","label":"Has manejado créditos al día"},{"fact":"assetKinds","op":"includesAny","value":["VIVIENDA","VEHICULOS","INVERSIONES"],"label":"Tienes patrimonio que respalda tu actividad"}]}]}'::jsonb),
('21000000-0000-4000-8000-000000000008', (SELECT "id" FROM "ServiceCategory" WHERE "code" = 'ADULTO'), 'REINICIO_FINANCIERO', 'Reinicio financiero', 'Has tenido atrasos y quieres retomar el control: vas a reconstruir tu comportamiento con pasos pequeños y verificables.', 50, 1, false, true, '{"all":[{"fact":"creditExperience","op":"eq","value":"LATE","label":"Has tenido atrasos en tus créditos y quieres retomar el control"}]}'::jsonb),
('21000000-0000-4000-8000-000000000009', (SELECT "id" FROM "ServiceCategory" WHERE "code" = 'FAMILIA'), 'FAMILIA_IMPULSORA', 'Familia impulsora', 'Acompañas a alguien de tu familia en su primera ruta financiera, sin reemplazar sus decisiones.', 10, 1, true, true, '{"any":[{"fact":"goal","op":"eq","value":"GUIDE_YOUTH","label":"Quieres acompañar a un joven en su ruta financiera"}]}'::jsonb),
('21000000-0000-4000-8000-000000000010', (SELECT "id" FROM "ServiceCategory" WHERE "code" = 'FAMILIA'), 'HOGAR_PLANIFICADOR', 'Hogar planificador', 'Tu hogar se organiza alrededor de metas concretas y aportes acordados.', 30, 1, false, true, '{"any":[{"fact":"sharedGoals","op":"gte","value":1,"label":"Tu hogar tiene metas compartidas"},{"fact":"lifeProjects","op":"gte","value":1,"label":"Tienes proyectos de vida en marcha"}]}'::jsonb),
('21000000-0000-4000-8000-000000000011', (SELECT "id" FROM "ServiceCategory" WHERE "code" = 'FAMILIA'), 'RED_INTERGENERACIONAL', 'Red intergeneracional', 'Varias generaciones se apoyan: unos construyen su historia y otros acompañan como red de apoyo.', 40, 1, false, true, '{"any":[{"fact":"householdSupportMembers","op":"gte","value":1,"label":"Tu hogar tiene integrantes que participan como red de apoyo"},{"fact":"employmentSituation","op":"eq","value":"PENSIONADO","label":"Eres pensionado"},{"fact":"incomeKinds","op":"includes","value":"PENSION","label":"Recibes ingresos por pensión"}]}'::jsonb),
('21000000-0000-4000-8000-000000000012', (SELECT "id" FROM "ServiceCategory" WHERE "code" = 'FAMILIA'), 'FAMILIA_EMPRENDEDORA', 'Familia emprendedora', 'El hogar vive de un negocio propio o está creando uno, y necesita separar y documentar esos ingresos.', 50, 1, false, true, '{"any":[{"fact":"incomeKinds","op":"includes","value":"VENTAS","label":"El hogar tiene ingresos por ventas de un negocio"},{"fact":"lifeProjectKinds","op":"includes","value":"EMPRENDIMIENTO","label":"Tienes un proyecto de emprendimiento"}]}'::jsonb)
ON CONFLICT ("categoryId", "code", "version") DO NOTHING;

-- Planes. Precio base por identidad $600.000; el descuento queda en 0 hasta
-- que el propietario defina el beneficio comercial de Dúo y Familia.
INSERT INTO "SubscriptionPlan" ("id", "code", "name", "description", "minSeats", "maxSeats", "basePriceCOP", "discountPercent", "position", "active", "updatedAt") VALUES
('22000000-0000-4000-8000-000000000001', 'INDIVIDUAL', 'Individual', 'Una identidad financiera con su ruta completa.', 1, 1, 600000, 0, 1, true, CURRENT_TIMESTAMP),
('22000000-0000-4000-8000-000000000002', 'DUO', 'Dúo', 'Dos identidades independientes dentro del mismo paquete.', 2, 2, 600000, 0, 2, true, CURRENT_TIMESTAMP),
('22000000-0000-4000-8000-000000000003', 'FAMILIA', 'Familia', 'Hasta cinco identidades independientes que comparten metas y apoyos autorizados.', 3, 5, 600000, 0, 3, true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Reglas tributarias del año gravable 2025: los mismos valores que la app ya
-- usaba como referencia (UVT $49.799; patrimonio 4.500 UVT; demás criterios
-- 1.400 UVT). Otros años los crea y aprueba el equipo desde administración.
INSERT INTO "TaxRuleVersion" ("id", "taxYear", "version", "uvtCOP", "wealthUvt", "incomeUvt", "cardSpendUvt", "purchasesUvt", "depositsUvt", "sourceDocument", "effectiveFrom", "status", "notes", "activatedAt", "updatedAt") VALUES
('23000000-0000-4000-8000-000000000001', 2025, 1, 49799, 4500, 1400, 1400, 1400, 1400, 'Valores de referencia que la plataforma ya aplicaba para personas naturales, año gravable 2025 (UVT $49.799; patrimonio bruto 4.500 UVT; ingresos, consumos con tarjeta, compras y consignaciones 1.400 UVT). Topes para declarar renta del Estatuto Tributario y UVT fijada por la DIAN para 2025.', DATE '2025-01-01', 'ACTIVE', 'Versión inicial migrada de la referencia fija del código. Debe ser ratificada por el área legal o financiera, que puede publicar una nueva versión.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("taxYear", "version") DO NOTHING;

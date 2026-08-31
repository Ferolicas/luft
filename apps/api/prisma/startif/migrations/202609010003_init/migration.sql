-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "startif";

-- CreateEnum
CREATE TYPE "CreditStatus" AS ENUM ('DRAFT', 'PENDING_KYC', 'PENDING_CONSENT', 'PENDING_SIGNATURE', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'ACTIVE', 'COMPLETED', 'DEFAULTED', 'CONFIGURATION_REQUIRED');

-- CreateEnum
CREATE TYPE "ProcessStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CONFIGURATION_REQUIRED');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'DUE', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'WAIVED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'ACTION_REQUIRED', 'PROCESSING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PqrStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'WAITING_USER', 'RESOLVED', 'CLOSED');

-- CreateTable
CREATE TABLE "StartifConsent" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" VARCHAR(80) NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "textSnapshot" TEXT NOT NULL,
    "textHash" CHAR(64) NOT NULL,
    "ipHash" CHAR(64),
    "userAgent" VARCHAR(500),
    "deviceMeta" JSONB,
    "acceptedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "StartifConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditApplication" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "amountCOP" BIGINT NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "requestedRateMonthly" DECIMAL(8,6),
    "approvedRateMonthly" DECIMAL(8,6),
    "usuryRateId" UUID,
    "purpose" VARCHAR(80) NOT NULL DEFAULT 'SERVICIO_LUFT',
    "status" "CreditStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMPTZ(3),
    "decidedAt" TIMESTAMPTZ(3),
    "decisionReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CreditApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycProcess" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL DEFAULT 'TRUORA',
    "externalId" VARCHAR(160),
    "status" "ProcessStatus" NOT NULL DEFAULT 'PENDING',
    "verificationUrl" TEXT,
    "resultCiphertext" TEXT,
    "failureReason" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "KycProcess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureEnvelope" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "ProcessStatus" NOT NULL DEFAULT 'PENDING',
    "documentVersion" VARCHAR(32) NOT NULL,
    "documentSnapshot" TEXT NOT NULL,
    "documentHash" CHAR(64) NOT NULL,
    "signatureCiphertext" TEXT,
    "otpChallengeId" UUID,
    "ipHash" CHAR(64),
    "userAgent" VARCHAR(500),
    "deviceMeta" JSONB,
    "signedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignatureEnvelope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsuryRate" (
    "id" UUID NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "annualEffectiveRate" DECIMAL(8,5) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceDocumentHash" CHAR(64),
    "verifiedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsuryRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "principalCOP" BIGINT NOT NULL,
    "monthlyRate" DECIMAL(8,6) NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "geometricDecrease" DECIMAL(8,6) NOT NULL DEFAULT 0.150000,
    "status" "CreditStatus" NOT NULL DEFAULT 'ACTIVE',
    "outstandingBalanceCOP" BIGINT NOT NULL,
    "disbursedAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installment" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "openingBalanceCOP" BIGINT NOT NULL,
    "amountCOP" BIGINT NOT NULL,
    "principalCOP" BIGINT NOT NULL,
    "interestCOP" BIGINT NOT NULL,
    "closingBalanceCOP" BIGINT NOT NULL,
    "paidCOP" BIGINT NOT NULL DEFAULT 0,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMPTZ(3),

    CONSTRAINT "Installment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "installmentId" UUID,
    "provider" VARCHAR(40) NOT NULL DEFAULT 'MERCADOPAGO',
    "externalId" VARCHAR(160),
    "idempotencyKey" UUID NOT NULL,
    "amountCOP" BIGINT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "redirectUrl" TEXT,
    "statusDetail" VARCHAR(160),
    "providerPayloadHash" CHAR(64),
    "approvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VirtualCard" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "last4" CHAR(4) NOT NULL,
    "fixedLimitCOP" BIGINT NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VirtualCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradelineReport" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "period" CHAR(7) NOT NULL,
    "status" "ProcessStatus" NOT NULL DEFAULT 'PENDING',
    "payloadHash" CHAR(64),
    "externalReference" VARCHAR(160),
    "failureReason" TEXT,
    "submittedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradelineReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pqr" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" VARCHAR(80) NOT NULL,
    "subject" VARCHAR(180) NOT NULL,
    "messageCiphertext" TEXT NOT NULL,
    "status" "PqrStatus" NOT NULL DEFAULT 'OPEN',
    "assignedRole" VARCHAR(40),
    "resolutionCiphertext" TEXT,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Pqr_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StartifConsent_userId_kind_acceptedAt_idx" ON "StartifConsent"("userId", "kind", "acceptedAt");

-- CreateIndex
CREATE INDEX "CreditApplication_userId_createdAt_idx" ON "CreditApplication"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditApplication_status_submittedAt_idx" ON "CreditApplication"("status", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "KycProcess_externalId_key" ON "KycProcess"("externalId");

-- CreateIndex
CREATE INDEX "KycProcess_userId_startedAt_idx" ON "KycProcess"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "SignatureEnvelope_userId_createdAt_idx" ON "SignatureEnvelope"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsuryRate_category_effectiveFrom_key" ON "UsuryRate"("category", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_applicationId_key" ON "Loan"("applicationId");

-- CreateIndex
CREATE INDEX "Loan_userId_status_idx" ON "Loan"("userId", "status");

-- CreateIndex
CREATE INDEX "Installment_dueDate_status_idx" ON "Installment"("dueDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Installment_loanId_sequence_key" ON "Installment"("loanId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_externalId_key" ON "Payment"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_status_updatedAt_idx" ON "Payment"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VirtualCard_loanId_key" ON "VirtualCard"("loanId");

-- CreateIndex
CREATE INDEX "VirtualCard_userId_idx" ON "VirtualCard"("userId");

-- CreateIndex
CREATE INDEX "TradelineReport_status_createdAt_idx" ON "TradelineReport"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradelineReport_loanId_provider_period_key" ON "TradelineReport"("loanId", "provider", "period");

-- CreateIndex
CREATE INDEX "Pqr_status_dueAt_idx" ON "Pqr"("status", "dueAt");

-- CreateIndex
CREATE INDEX "Pqr_userId_createdAt_idx" ON "Pqr"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "CreditApplication" ADD CONSTRAINT "CreditApplication_usuryRateId_fkey" FOREIGN KEY ("usuryRateId") REFERENCES "UsuryRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycProcess" ADD CONSTRAINT "KycProcess_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "CreditApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureEnvelope" ADD CONSTRAINT "SignatureEnvelope_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "CreditApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "CreditApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "Installment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualCard" ADD CONSTRAINT "VirtualCard_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

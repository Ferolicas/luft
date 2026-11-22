-- LUFT + STARTIF V2: producto de crédito versionado, estrategia de dos créditos,
-- desembolsos, abonos anticipados y castigo de cartera.
-- Prisma envía la migración como un único lote, así que corre en una sola
-- transacción. Es idempotente respecto a los datos existentes: los catálogos
-- usan INSERT ... ON CONFLICT DO NOTHING y los rellenos solo tocan filas sin valor.
-- CreateEnum
CREATE TYPE "CreditProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('INSTALLMENT', 'PREPAYMENT');

-- CreateEnum
CREATE TYPE "DisbursementStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "CreditStatus" ADD VALUE 'WRITTEN_OFF';

-- AlterTable
ALTER TABLE "CreditApplication" ADD COLUMN     "geometricDecrease" DECIMAL(8,6),
ADD COLUMN     "productCode" VARCHAR(40) NOT NULL DEFAULT 'BUILDER_1',
ADD COLUMN     "productId" UUID,
ADD COLUMN     "productVersion" INTEGER,
ADD COLUMN     "purposeDescription" TEXT;

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "defaultAfterDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "defaultedAt" TIMESTAMPTZ(3),
ADD COLUMN     "productCode" VARCHAR(40) NOT NULL DEFAULT 'BUILDER_1',
ADD COLUMN     "productId" UUID,
ADD COLUMN     "productVersion" INTEGER,
ADD COLUMN     "purpose" VARCHAR(80) NOT NULL DEFAULT 'SERVICIO_LUFT',
ADD COLUMN     "writtenOffAt" TIMESTAMPTZ(3),
ADD COLUMN     "writtenOffBy" UUID,
ADD COLUMN     "writtenOffReason" TEXT,
ALTER COLUMN "geometricDecrease" SET DEFAULT 0.200000;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "creditedCOP" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "kind" "PaymentKind" NOT NULL DEFAULT 'INSTALLMENT',
ADD COLUMN     "loanId" UUID;

-- CreateTable
CREATE TABLE "CreditProduct" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "version" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "purpose" VARCHAR(80) NOT NULL,
    "description" TEXT,
    "sequence" INTEGER NOT NULL,
    "principalCOP" BIGINT,
    "minPrincipalCOP" BIGINT,
    "maxPrincipalCOP" BIGINT,
    "termMonths" INTEGER,
    "monthlyRate" DECIMAL(8,6),
    "geometricDecrease" DECIMAL(8,6),
    "disbursementMode" VARCHAR(40) NOT NULL,
    "requirements" JSONB,
    "defaultAfterDays" INTEGER NOT NULL DEFAULT 30,
    "status" "CreditProductStatus" NOT NULL DEFAULT 'DRAFT',
    "statusReason" TEXT,
    "effectiveFrom" TIMESTAMPTZ(3),
    "effectiveTo" TIMESTAMPTZ(3),
    "createdBy" UUID,
    "activatedBy" UUID,
    "suspendedBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CreditProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Disbursement" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "loanId" UUID,
    "userId" UUID NOT NULL,
    "productCode" VARCHAR(40) NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "purpose" VARCHAR(80) NOT NULL,
    "amountCOP" BIGINT NOT NULL,
    "status" "DisbursementStatus" NOT NULL DEFAULT 'PENDING',
    "reference" VARCHAR(160),
    "channel" VARCHAR(80),
    "note" TEXT,
    "disbursedAt" TIMESTAMPTZ(3),
    "createdBy" UUID,
    "registeredBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Disbursement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanPrepayment" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "amountCOP" BIGINT NOT NULL,
    "appliedCOP" BIGINT NOT NULL,
    "balanceBeforeCOP" BIGINT NOT NULL,
    "balanceAfterCOP" BIGINT NOT NULL,
    "loanStatusBefore" "CreditStatus" NOT NULL,
    "closedLoan" BOOLEAN NOT NULL DEFAULT false,
    "previousPlan" JSONB NOT NULL,
    "newPlan" JSONB NOT NULL,
    "appliedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMPTZ(3),
    "reversalMode" VARCHAR(40),

    CONSTRAINT "LoanPrepayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreditProduct_code_status_idx" ON "CreditProduct"("code", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CreditProduct_code_version_key" ON "CreditProduct"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Disbursement_applicationId_key" ON "Disbursement"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "Disbursement_loanId_key" ON "Disbursement"("loanId");

-- CreateIndex
CREATE UNIQUE INDEX "Disbursement_reference_key" ON "Disbursement"("reference");

-- CreateIndex
CREATE INDEX "Disbursement_status_createdAt_idx" ON "Disbursement"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Disbursement_userId_createdAt_idx" ON "Disbursement"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LoanPrepayment_paymentId_key" ON "LoanPrepayment"("paymentId");

-- CreateIndex
CREATE INDEX "LoanPrepayment_loanId_appliedAt_idx" ON "LoanPrepayment"("loanId", "appliedAt");

-- CreateIndex
CREATE INDEX "CreditApplication_productId_idx" ON "CreditApplication"("productId");

-- CreateIndex
CREATE INDEX "Loan_productId_idx" ON "Loan"("productId");

-- CreateIndex
CREATE INDEX "Payment_loanId_kind_idx" ON "Payment"("loanId", "kind");

-- AddForeignKey
ALTER TABLE "CreditApplication" ADD CONSTRAINT "CreditApplication_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CreditProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CreditProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Disbursement" ADD CONSTRAINT "Disbursement_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "CreditApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Disbursement" ADD CONSTRAINT "Disbursement_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPrepayment" ADD CONSTRAINT "LoanPrepayment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPrepayment" ADD CONSTRAINT "LoanPrepayment_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Reglas de integridad que el esquema de Prisma no puede expresar.
-- Solo una versión vigente por código de producto.
CREATE UNIQUE INDEX "CreditProduct_one_active_per_code" ON "CreditProduct"("code") WHERE "status" = 'ACTIVE';

ALTER TABLE "CreditProduct"
  ADD CONSTRAINT "CreditProduct_sequence_check" CHECK ("sequence" IN (1, 2)),
  ADD CONSTRAINT "CreditProduct_version_check" CHECK ("version" >= 1),
  ADD CONSTRAINT "CreditProduct_amounts_check" CHECK (
    ("principalCOP" IS NULL OR "principalCOP" > 0)
    AND ("minPrincipalCOP" IS NULL OR "minPrincipalCOP" > 0)
    AND ("maxPrincipalCOP" IS NULL OR "maxPrincipalCOP" >= COALESCE("minPrincipalCOP", 1))
    AND ("principalCOP" IS NULL OR ("minPrincipalCOP" IS NULL AND "maxPrincipalCOP" IS NULL))
    AND (("minPrincipalCOP" IS NULL) = ("maxPrincipalCOP" IS NULL))
  ),
  ADD CONSTRAINT "CreditProduct_terms_check" CHECK (
    ("termMonths" IS NULL OR "termMonths" BETWEEN 1 AND 120)
    AND ("monthlyRate" IS NULL OR ("monthlyRate" >= 0 AND "monthlyRate" <= 1))
    AND ("geometricDecrease" IS NULL OR ("geometricDecrease" >= 0 AND "geometricDecrease" < 1))
    AND "defaultAfterDays" BETWEEN 1 AND 360
  ),
  -- Un producto vigente siempre tiene monto (fijo o rango), plazo, tasa y gradiente.
  ADD CONSTRAINT "CreditProduct_active_complete_check" CHECK (
    "status" <> 'ACTIVE'
    OR (
      "termMonths" IS NOT NULL
      AND "monthlyRate" IS NOT NULL
      AND "geometricDecrease" IS NOT NULL
      AND ("principalCOP" IS NOT NULL OR ("minPrincipalCOP" IS NOT NULL AND "maxPrincipalCOP" IS NOT NULL))
    )
  );

ALTER TABLE "Disbursement"
  ADD CONSTRAINT "Disbursement_amount_check" CHECK ("amountCOP" > 0),
  -- Un giro solo queda COMPLETED con referencia y fecha reales.
  ADD CONSTRAINT "Disbursement_transfer_evidence_check" CHECK (
    "status" <> 'COMPLETED'
    OR "kind" <> 'TRANSFER'
    OR ("reference" IS NOT NULL AND "disbursedAt" IS NOT NULL)
  );

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_credited_check" CHECK ("creditedCOP" >= 0 AND "creditedCOP" <= "amountCOP"),
  -- Un abono anticipado siempre pertenece a un préstamo.
  ADD CONSTRAINT "Payment_prepayment_loan_check" CHECK ("kind" <> 'PREPAYMENT' OR "loanId" IS NOT NULL);

ALTER TABLE "LoanPrepayment"
  ADD CONSTRAINT "LoanPrepayment_amounts_check" CHECK (
    "amountCOP" > 0
    AND "appliedCOP" > 0
    AND "appliedCOP" <= "amountCOP"
    AND "balanceAfterCOP" = "balanceBeforeCOP" - "appliedCOP"
    AND "balanceAfterCOP" >= 0
  );

-- Catálogo inicial de productos.
-- BUILDER_1 "Servicio LUFT": condiciones definidas por el dueño del producto.
INSERT INTO "CreditProduct" (
  "id", "code", "version", "name", "purpose", "description", "sequence",
  "principalCOP", "termMonths", "monthlyRate", "geometricDecrease",
  "disbursementMode", "requirements", "defaultAfterDays", "status",
  "effectiveFrom", "updatedAt"
) VALUES (
  gen_random_uuid(), 'BUILDER_1', 1, 'Servicio LUFT', 'SERVICIO_LUFT',
  'Crédito constructor 1: financia el servicio LUFT y permite observar el primer comportamiento de pago.',
  1, 600000, 6, 0.010000, 0.200000,
  'SERVICE_FINANCING', NULL, 30, 'ACTIVE',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
) ON CONFLICT ("code", "version") DO NOTHING;

-- BUILDER_2 "Consolidación": queda en borrador y sin condiciones económicas.
-- Riesgo o finanzas fija monto o rango, plazo, tasa, gradiente y tope de
-- endeudamiento desde administración antes de activarlo.
INSERT INTO "CreditProduct" (
  "id", "code", "version", "name", "purpose", "description", "sequence",
  "disbursementMode", "requirements", "defaultAfterDays", "status", "updatedAt"
) VALUES (
  gen_random_uuid(), 'BUILDER_2', 1, 'Consolidación', 'PROPOSITO_DEFINIDO',
  'Crédito constructor 2: consolidación de deudas o propósito definido. Solo después de verificar el comportamiento del crédito 1, la finalidad, la capacidad disponible y la ausencia de sobreendeudamiento.',
  2, 'TRANSFER',
  '{"firstCreditMustBePaid": true, "maxLatePayments": 1, "capacityCoverage": 1, "maxDebtToMonthlyIncome": null}'::jsonb,
  30, 'DRAFT', CURRENT_TIMESTAMP
) ON CONFLICT ("code", "version") DO NOTHING;

-- Datos existentes (anteriores al catálogo): conservan sus condiciones.
-- Las solicitudes heredan el gradiente de su préstamo; las que aún no tienen
-- préstamo se cotizaron con el gradiente anterior (15 %).
UPDATE "CreditApplication" AS a
SET "geometricDecrease" = l."geometricDecrease"
FROM "Loan" AS l
WHERE l."applicationId" = a."id" AND a."geometricDecrease" IS NULL;

UPDATE "CreditApplication"
SET "geometricDecrease" = 0.150000
WHERE "geometricDecrease" IS NULL;

UPDATE "Loan" AS l
SET "purpose" = a."purpose"
FROM "CreditApplication" AS a
WHERE a."id" = l."applicationId" AND l."purpose" <> a."purpose";

UPDATE "Payment" AS p
SET "loanId" = i."loanId"
FROM "Installment" AS i
WHERE p."installmentId" = i."id" AND p."loanId" IS NULL;

-- Lo ya aplicado por pagos aprobados (un duplicado enviado a conciliación no
-- se aplicó a ninguna cuota).
UPDATE "Payment" AS p
SET "creditedCOP" = LEAST(p."amountCOP", i."amountCOP")
FROM "Installment" AS i
WHERE p."installmentId" = i."id"
  AND p."status" = 'APPROVED'
  AND p."creditedCOP" = 0
  AND p."statusDetail" IS DISTINCT FROM 'DUPLICATE_PAYMENT_REQUIRES_RECONCILIATION';

-- Los préstamos existentes financiaron el servicio LUFT: no hubo giro de dinero.
INSERT INTO "Disbursement" (
  "id", "applicationId", "loanId", "userId", "productCode", "kind", "purpose",
  "amountCOP", "status", "note", "disbursedAt", "updatedAt"
)
SELECT
  gen_random_uuid(), l."applicationId", l."id", l."userId", l."productCode",
  'SERVICE_FINANCING', l."purpose", l."principalCOP", 'COMPLETED',
  'Financiación del servicio LUFT. No hubo giro de dinero.',
  COALESCE(l."disbursedAt", l."createdAt"), CURRENT_TIMESTAMP
FROM "Loan" AS l
ON CONFLICT ("applicationId") DO NOTHING;

-- Permisos: las tablas nuevas reciben exactamente los privilegios que cada rol
-- de aplicación ya tiene sobre "Loan" (el usuario del dominio startif), sin
-- depender del nombre del rol ni de privilegios por defecto.
DO $$
DECLARE
  target_schema text := current_schema();
  item record;
BEGIN
  FOR item IN
    SELECT DISTINCT grantee, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = target_schema
      AND table_name = 'Loan'
      AND grantee NOT IN ('PUBLIC', current_user)
      AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  LOOP
    EXECUTE format(
      'GRANT %s ON TABLE %I."CreditProduct", %I."Disbursement", %I."LoanPrepayment" TO %I',
      item.privilege_type, target_schema, target_schema, target_schema, item.grantee
    );
  END LOOP;
END $$;

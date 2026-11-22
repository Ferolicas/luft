-- El crédito constructor 1 pasó a ser un producto fijo ($600.000, 6 cuotas,
-- 1 % mensual vencido, gradiente geométrico decreciente del 20 %). Las
-- solicitudes anteriores que nunca llegaron a firmar pagaré solo tenían una
-- cotización no vinculante con el monto, plazo y tasa del flujo antiguo; si
-- conservaran esas condiciones, la persona vería el plan vigente en pantalla y
-- firmaría un pagaré distinto. Se llevan a las condiciones del producto
-- vigente y se guarda lo cotizado antes en "previousTerms".
-- Las solicitudes con pagaré firmado, en estudio, decididas o con préstamo no
-- se tocan.
ALTER TABLE "CreditApplication" ADD COLUMN IF NOT EXISTS "previousTerms" JSONB;

UPDATE "CreditApplication" AS a
SET "previousTerms" = jsonb_build_object(
      'amountCOP', a."amountCOP"::text,
      'termMonths', a."termMonths",
      'requestedRateMonthly', a."requestedRateMonthly"::text,
      'geometricDecrease', a."geometricDecrease"::text,
      'repricedAt', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'reason', 'PRODUCTO_VERSIONADO_BUILDER_1'
    ),
    "amountCOP" = p."principalCOP",
    "termMonths" = p."termMonths",
    "requestedRateMonthly" = p."monthlyRate",
    "geometricDecrease" = p."geometricDecrease",
    "productId" = p."id",
    "productCode" = p."code",
    "productVersion" = p."version",
    "updatedAt" = CURRENT_TIMESTAMP
FROM "CreditProduct" AS p
WHERE p."code" = 'BUILDER_1'
  AND p."status" = 'ACTIVE'
  AND p."principalCOP" IS NOT NULL
  AND a."productCode" = 'BUILDER_1'
  AND a."previousTerms" IS NULL
  AND a."status" IN ('DRAFT', 'PENDING_KYC', 'PENDING_CONSENT', 'PENDING_SIGNATURE', 'CONFIGURATION_REQUIRED')
  AND NOT EXISTS (SELECT 1 FROM "Loan" AS l WHERE l."applicationId" = a."id")
  AND NOT EXISTS (
    SELECT 1 FROM "SignatureEnvelope" AS s
    WHERE s."applicationId" = a."id" AND s."status" = 'COMPLETED'
  )
  AND (
    a."amountCOP" <> p."principalCOP"
    OR a."termMonths" <> p."termMonths"
    OR a."requestedRateMonthly" IS DISTINCT FROM p."monthlyRate"
    OR a."geometricDecrease" IS DISTINCT FROM p."geometricDecrease"
    OR a."productId" IS NULL
  );

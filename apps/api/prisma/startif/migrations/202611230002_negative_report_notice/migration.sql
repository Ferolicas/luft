-- Aviso previo al reporte negativo ante las centrales de riesgo (Ley 1266 de
-- 2008, art. 12, y Ley 2157 de 2021). Guarda el texto enviado, el destino
-- cifrado y la fecha: sin dos avisos y veinte días calendario desde el último,
-- el reporte negativo no sale.
CREATE TABLE "NegativeReportNotice" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "channel" VARCHAR(20) NOT NULL DEFAULT 'EMAIL',
    "destinationCiphertext" TEXT NOT NULL,
    "overdueCOP" BIGINT NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "textSnapshot" TEXT NOT NULL,
    "textHash" CHAR(64) NOT NULL,
    "providerMessageId" VARCHAR(160),
    "sentAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NegativeReportNotice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NegativeReportNotice_loanId_sentAt_idx" ON "NegativeReportNotice"("loanId", "sentAt");
CREATE INDEX "NegativeReportNotice_userId_sentAt_idx" ON "NegativeReportNotice"("userId", "sentAt");

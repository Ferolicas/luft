-- Verificación en dos pasos por correo y códigos por correo para firma y
-- recuperación de contraseña. El SMS queda solo para validar el celular en el
-- registro.
--
-- ADD VALUE IF NOT EXISTS es idempotente y el valor nuevo no se usa dentro de
-- esta misma migración. La columna nace en false: ninguna cuenta existente
-- cambia su forma de entrar.
ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'EMAIL_VERIFICATION';
ALTER TABLE "User" ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;
-- Para contar cuántos códigos pidió una cuenta sin recorrer toda la tabla.
CREATE INDEX "OtpChallenge_userId_createdAt_idx" ON "OtpChallenge" ("userId", "createdAt");

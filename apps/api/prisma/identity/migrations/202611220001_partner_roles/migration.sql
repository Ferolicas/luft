-- Roles externos: aliado comercial (ALLY) y entidad financiera (INSTITUTION).
-- No son personal interno: ninguna ruta de staff los admite y su alcance se
-- limita a los portales /api/ally y /api/institution.
--
-- ADD VALUE IF NOT EXISTS es idempotente y solo agrega al final del enum: no
-- reescribe la tabla "User" ni cambia el rol de ninguna cuenta existente.
-- Los valores nuevos no se usan dentro de esta misma migración (PostgreSQL no
-- permite usar un valor de enum en la transacción que lo crea).
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ALLY';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'INSTITUTION';

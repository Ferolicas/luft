import { defineConfig } from "prisma/config";

const base = process.env.DATABASE_ADMIN_URL ?? "postgresql://placeholder:placeholder@localhost:5432/luft_db";

export default defineConfig({
  schema: "schema.prisma",
  migrations: { path: "migrations" },
  datasource: { url: `${base}?schema=scoring` },
});


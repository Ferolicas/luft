/**
 * Mapa de navegación de las consolas. Los roles de cada entrada son los mismos
 * que exige la API en sus controladores: la interfaz solo oculta lo que la API
 * de todos modos rechazaría.
 */

export type StaffRole = "COMMERCIAL" | "LEGAL" | "SUPPORT" | "COLLECTIONS" | "RISK" | "FINANCE" | "SUPERADMIN";
export type Role = StaffRole | "USER" | "ALLY" | "INSTITUTION";

export const STAFF_ROLES: StaffRole[] = ["COMMERCIAL", "LEGAL", "SUPPORT", "COLLECTIONS", "RISK", "FINANCE", "SUPERADMIN"];

export const ROLE_LABEL: Record<string, string> = {
  USER: "Persona usuaria",
  COMMERCIAL: "Asesoría comercial",
  LEGAL: "Legal",
  SUPPORT: "Soporte",
  COLLECTIONS: "Cartera y cobranza",
  RISK: "Analista de riesgo",
  FINANCE: "Finanzas",
  SUPERADMIN: "Superadministración",
  ALLY: "Aliado",
  INSTITUTION: "Entidad financiera",
};

export const isStaff = (role: string): role is StaffRole => (STAFF_ROLES as string[]).includes(role);

/** A dónde pertenece una sesión según su rol. */
export function homeFor(role: string) {
  if (isStaff(role)) return "/admin";
  if (role === "INSTITUTION") return "/entidad";
  if (role === "ALLY") return "/aliado";
  return "/app";
}

export type NavIcon =
  | "overview" | "people" | "pqr" | "audit" | "applications" | "products" | "disbursements" | "portfolio" | "legalRate"
  | "categories" | "archetypes" | "plans" | "cases" | "taxRules" | "institutions" | "policies" | "presentations" | "runs"
  | "allies" | "cohorts" | "effectiveness" | "backtests";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  roles: StaffRole[];
  /** Descripción corta para el resumen y los accesos directos. */
  hint: string;
}
export interface NavArea {
  key: string;
  label: string;
  items: NavItem[];
}

const ALL = STAFF_ROLES;

export const ADMIN_NAV: NavArea[] = [
  {
    key: "operacion",
    label: "Operación",
    items: [
      { href: "/admin", label: "Resumen", icon: "overview", roles: ALL, hint: "Indicadores e integraciones" },
      { href: "/admin/personas", label: "Personas y roles", icon: "people", roles: ["SUPPORT", "RISK", "SUPERADMIN"], hint: "Cuentas, estados y roles internos" },
      { href: "/admin/pqr", label: "PQR", icon: "pqr", roles: ["SUPPORT", "LEGAL", "COLLECTIONS", "SUPERADMIN"], hint: "Peticiones, quejas y reclamos" },
      { href: "/admin/auditoria", label: "Auditoría", icon: "audit", roles: ["LEGAL", "RISK", "SUPERADMIN"], hint: "Bitácora inmutable de eventos" },
    ],
  },
  {
    key: "credito",
    label: "Crédito STARTIF",
    items: [
      { href: "/admin/credito/solicitudes", label: "Solicitudes", icon: "applications", roles: ["COMMERCIAL", "RISK", "FINANCE", "LEGAL", "SUPERADMIN"], hint: "Estudio y decisión" },
      { href: "/admin/credito/productos", label: "Productos de crédito", icon: "products", roles: ["RISK", "FINANCE", "SUPERADMIN"], hint: "Versiones y condiciones" },
      { href: "/admin/credito/desembolsos", label: "Desembolsos", icon: "disbursements", roles: ["RISK", "FINANCE", "SUPERADMIN"], hint: "Cola de giros y registro" },
      { href: "/admin/credito/cartera", label: "Cartera", icon: "portfolio", roles: ["RISK", "FINANCE", "COLLECTIONS", "SUPERADMIN"], hint: "Préstamos, mora y castigo" },
      { href: "/admin/credito/tasa-legal", label: "Tasa legal", icon: "legalRate", roles: ["LEGAL", "RISK", "SUPERADMIN"], hint: "Tasa máxima de usura vigente" },
    ],
  },
  {
    key: "catalogo",
    label: "Catálogo LUFT",
    items: [
      { href: "/admin/catalogo/categorias", label: "Categorías", icon: "categories", roles: ALL, hint: "Segmentos y su configuración" },
      { href: "/admin/catalogo/arquetipos", label: "Arquetipos", icon: "archetypes", roles: ALL, hint: "Perfiles y reglas versionadas" },
      { href: "/admin/catalogo/planes", label: "Planes", icon: "plans", roles: ALL, hint: "Precio, cupos y descuento" },
    ],
  },
  {
    key: "formalizacion",
    label: "Formalización tributaria",
    items: [
      { href: "/admin/formalizacion/casos", label: "Casos", icon: "cases", roles: ["LEGAL", "FINANCE", "SUPERADMIN"], hint: "Cola de revisión profesional" },
      { href: "/admin/formalizacion/reglas", label: "Reglas tributarias", icon: "taxRules", roles: ["LEGAL", "FINANCE", "SUPERADMIN"], hint: "Topes por año gravable" },
    ],
  },
  {
    key: "matching",
    label: "Políticas y matching",
    items: [
      { href: "/admin/matching/entidades", label: "Entidades", icon: "institutions", roles: ["RISK", "COMMERCIAL", "SUPERADMIN"], hint: "Entidades financieras y usuarios" },
      { href: "/admin/matching/productos", label: "Productos y políticas", icon: "policies", roles: ["RISK", "COMMERCIAL", "SUPERADMIN"], hint: "Versiones, reglas y simulador" },
      { href: "/admin/matching/presentaciones", label: "Presentaciones", icon: "presentations", roles: ["COMMERCIAL", "RISK", "SUPERADMIN"], hint: "Cola, envío y decisión" },
      { href: "/admin/matching/ejecuciones", label: "Ejecuciones", icon: "runs", roles: ["RISK", "SUPERADMIN"], hint: "Resultados y reproducibilidad" },
      { href: "/admin/matching/aliados", label: "Aliados", icon: "allies", roles: ["SUPERADMIN"], hint: "Aliados, vínculos y referidos" },
    ],
  },
  {
    key: "analitica",
    label: "Analítica",
    items: [
      { href: "/admin/analitica/cosechas", label: "Cosechas", icon: "cohorts", roles: ["RISK", "FINANCE", "SUPERADMIN"], hint: "Cohortes y mora 30/60/90" },
      { href: "/admin/analitica/efectividad", label: "Efectividad", icon: "effectiveness", roles: ["RISK", "FINANCE", "SUPERADMIN"], hint: "Puntaje, lecciones y arquetipos" },
      { href: "/admin/analitica/backtesting", label: "Backtesting", icon: "backtests", roles: ["RISK", "FINANCE", "SUPERADMIN"], hint: "Políticas contra resultados reales" },
    ],
  },
];

const ITEMS = ADMIN_NAV.flatMap((area) => area.items.map((item) => ({ ...item, area: area.label })));

/** Entrada de navegación a la que pertenece una ruta (la de prefijo más largo). */
export function navItemFor(pathname: string) {
  return ITEMS.filter((item) => (item.href === "/admin" ? pathname === "/admin" : pathname === item.href || pathname.startsWith(`${item.href}/`))).sort((a, b) => b.href.length - a.href.length)[0] ?? null;
}

export function navFor(role: string): NavArea[] {
  return ADMIN_NAV.map((area) => ({ ...area, items: area.items.filter((item) => (item.roles as string[]).includes(role)) })).filter((area) => area.items.length > 0);
}

/** `true` si el rol puede abrir la ruta de administración. Las rutas desconocidas se niegan. */
export function canOpen(pathname: string, role: string) {
  const item = navItemFor(pathname);
  return Boolean(item && (item.roles as string[]).includes(role));
}

/** Permisos de escritura que la API exige por acción (para ocultar botones que fallarían). */
export const CAN = {
  decideApplication: ["RISK", "SUPERADMIN"],
  manageCreditProducts: ["RISK", "FINANCE", "SUPERADMIN"],
  registerDisbursement: ["FINANCE", "SUPERADMIN"],
  writeOff: ["FINANCE", "SUPERADMIN"],
  setRoles: ["SUPERADMIN"],
  editCatalog: ["COMMERCIAL", "RISK", "SUPERADMIN"],
  deleteCategory: ["SUPERADMIN"],
  editPlans: ["COMMERCIAL", "FINANCE", "SUPERADMIN"],
  readPolicies: ["RISK", "COMMERCIAL", "SUPERADMIN"],
  writePolicies: ["RISK", "SUPERADMIN"],
  managePartners: ["SUPERADMIN"],
  reviewRuns: ["RISK", "SUPERADMIN"],
} as const satisfies Record<string, StaffRole[]>;

export const can = (action: keyof typeof CAN, role: string) => (CAN[action] as readonly string[]).includes(role);

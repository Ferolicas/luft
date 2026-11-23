import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";

/** Debe coincidir con `TERMS_VERSION` de la API: queda en la bitácora de cada registro. */
const VERSION = "2026-11-23-2";
const PRIVACY = "https://restaurar.co/privacy";

export const metadata: Metadata = {
  title: "Términos y Condiciones",
  description: "Condiciones de uso de LUFT, marca de Tureporte S.A.S.: cuenta, planes, crédito StartIF, retracto, datos personales y reclamaciones.",
  alternates: { canonical: "/legal/terminos" },
};

const SECTIONS: Array<{ id: string; title: string; body: React.ReactNode }> = [
  {
    id: "quienes-somos",
    title: "1. Quiénes somos",
    body: (
      <>
        <p>LUFT es una marca de <strong>Tureporte S.A.S.</strong>, sociedad colombiana identificada con NIT 900.896.499-0, que también es propietaria de la marca RESTAURAR. Cuando estos términos dicen «LUFT», «nosotros» o «la plataforma» se refieren a Tureporte S.A.S.</p>
        <ul>
          <li>Razón social: Tureporte S.A.S.</li>
          <li>NIT: 900.896.499-0</li>
          <li>Domicilio: Colombia</li>
          <li>Correo: <a href="mailto:soporte@luft.com.co">soporte@luft.com.co</a> y <a href="mailto:contacto@restaurar.co">contacto@restaurar.co</a></li>
          <li>Sitio: <a href="https://luft.com.co">https://luft.com.co</a></li>
        </ul>
        <p>Al crear tu cuenta aceptas estos términos. Si no estás de acuerdo, no uses la plataforma.</p>
      </>
    ),
  },
  {
    id: "que-es",
    title: "2. Qué es LUFT",
    body: (
      <>
        <p>LUFT es una plataforma de educación financiera y construcción de historial crediticio para personas en Colombia. Incluye tu diagnóstico, una ruta personalizada, cursos, metas y proyectos, un espacio para tu hogar, orientación para formalizarte ante la DIAN y oportunidades con entidades aliadas. Dentro de LUFT también puedes solicitar crédito de <strong>StartIF</strong>.</p>
        <p>LUFT no recibe depósitos ni administra tu dinero.</p>
      </>
    ),
  },
  {
    id: "quien-puede",
    title: "3. Quién puede usar LUFT",
    body: (
      <ul>
        <li>Debes ser mayor de edad, tener cédula de ciudadanía colombiana y un celular colombiano a tu nombre o bajo tu control.</li>
        <li>La cuenta es personal: una por persona y no se comparte ni se cede.</li>
        <li>Los datos que registras deben ser tuyos, verdaderos y estar al día. Si cambian, actualízalos o pídenos corregirlos por Ayuda y PQR.</li>
      </ul>
    ),
  },
  {
    id: "cuenta",
    title: "4. Tu cuenta y su seguridad",
    body: (
      <ul>
        <li>Al registrarte validamos tu celular con un código que enviamos por SMS.</li>
        <li>Entras con tu usuario o correo y tu contraseña, o con una llave de acceso (huella, rostro o PIN de tu dispositivo).</li>
        <li>Puedes activar la verificación en dos pasos: al iniciar sesión te pedimos además un código que enviamos a tu correo.</li>
        <li>Los códigos para recuperar tu contraseña y para firmar documentos llegan al correo de tu cuenta, vencen en 10 minutos y sirven una sola vez.</li>
        <li>Cuida tu contraseña y tus códigos: nadie de LUFT te los va a pedir. Lo que se haga con tus credenciales se entiende hecho por ti, salvo que nos avises de un uso no autorizado.</li>
        <li>Si crees que alguien más entró a tu cuenta, cambia tu contraseña y escríbenos de inmediato.</li>
      </ul>
    ),
  },
  {
    id: "alcance",
    title: "5. Lo que LUFT no promete",
    body: (
      <ul>
        <li>LUFT no garantiza que te aprueben un crédito ni que tu puntaje suba. Tu historial depende de tu comportamiento de pago y de las reglas de cada central de riesgo y de cada entidad.</li>
        <li>Los cursos, el diagnóstico y las recomendaciones son educación financiera general. No son asesoría financiera, tributaria ni jurídica personalizada.</li>
        <li>La formalización tributaria es una orientación con reglas por año y revisión profesional. La declaración ante la DIAN la presentas tú; LUFT solo registra que la hiciste.</li>
      </ul>
    ),
  },
  {
    id: "centrales",
    title: "6. Consulta y reporte en centrales de riesgo",
    body: (
      <>
        <p>Para conocer tu punto de partida y medir tu avance, LUFT puede consultar tu información en operadores como DataCrédito Experian y TransUnion (CIFIN). Solo lo hacemos con tu <strong>autorización previa, expresa y separada</strong>, que puedes retirar en Perfil → Privacidad.</p>
        <p>Si tomas un crédito, tu comportamiento de pago, positivo o negativo, se reporta a esos operadores en los términos que autorices al solicitarlo. Las consultas y los reportes se hacen conforme a la Ley 1266 de 2008 y la Ley 2157 de 2021, incluida la comunicación previa que la ley exige antes de un reporte negativo.</p>
      </>
    ),
  },
  {
    id: "planes",
    title: "7. Planes y precios",
    body: (
      <ul>
        <li>Crear tu cuenta no tiene costo.</li>
        <li>El servicio LUFT se contrata por planes: Individual, Dúo y Familia. El precio vigente por persona se muestra en pesos colombianos antes de que aceptes.</li>
        <li>El plan puede pagarse a cuotas con el crédito «Servicio LUFT» de StartIF. Antes de firmar ves el valor de cada cuota, el total de intereses y el total a pagar.</li>
        <li>Si cambiamos un precio, el cambio no afecta lo que ya contrataste.</li>
      </ul>
    ),
  },
  {
    id: "credito",
    title: "8. Crédito StartIF",
    body: (
      <ul>
        <li>Solicitar un crédito no obliga a aprobarlo. Cada solicitud pasa por validación de identidad, firma del pagaré y estudio.</li>
        <li>Las condiciones de tu crédito (capital, plazo, tasa, plan de cuotas y total a pagar) son las que ves en la cotización y quedan en el pagaré que firmas. Esas condiciones prevalecen sobre cualquier texto general.</li>
        <li>La tasa nunca supera la tasa máxima legal certificada por la Superintendencia Financiera de Colombia vigente al momento de aprobar.</li>
        <li>Firmas el pagaré de forma electrónica, con tu firma y un código enviado a tu correo. Guardamos el documento íntegro y la evidencia de la firma, con la validez que la Ley 527 de 1999 reconoce a los mensajes de datos.</li>
        <li>Pagas tus cuotas desde la app por PSE. Puedes abonar a capital o pagar por anticipado sin cobros adicionales.</li>
        <li>Si te atrasas, el pagaré indica las consecuencias de la mora, entre ellas el reporte a las centrales de riesgo.</li>
      </ul>
    ),
  },
  {
    id: "retracto",
    title: "9. Derecho de retracto",
    body: (
      <>
        <p>Como contratas a distancia y con financiación, tienes el derecho de retracto del artículo 47 de la Ley 1480 de 2011: puedes deshacer la contratación de tu plan o de tu crédito dentro de los <strong>cinco (5) días hábiles</strong> siguientes a haberlo aceptado.</p>
        <p>Para ejercerlo, escríbenos por Ayuda y PQR dentro de la app o a <a href="mailto:soporte@luft.com.co">soporte@luft.com.co</a> indicando que te retractas. Te devolvemos lo que hayas pagado, sin descuentos, en un máximo de treinta (30) días calendario.</p>
      </>
    ),
  },
  {
    id: "pagos",
    title: "10. Pagos y reversión",
    body: (
      <>
        <p>Los pagos se hacen por PSE a través de Mercado Pago. LUFT no guarda las claves de tu banco. Un pago queda aplicado cuando el procesador lo confirma.</p>
        <p>Si un pago fue fraudulento o no lo solicitaste, puedes pedir su reversión: preséntanos la queja dentro de los cinco (5) días hábiles siguientes a enterarte y avisa a tu banco, como lo prevén el artículo 51 de la Ley 1480 de 2011 y el Decreto 587 de 2016.</p>
      </>
    ),
  },
  {
    id: "hogar",
    title: "11. Hogar LUFT",
    body: (
      <ul>
        <li>En los planes Dúo y Familia cada integrante tiene su propia cuenta, su propio expediente y acepta sus propios términos.</li>
        <li>Tú decides qué ve tu hogar de ti, dato por dato, y puedes cambiarlo o salir del hogar cuando quieras.</li>
        <li>Pertenecer a un hogar no te hace responsable de las deudas de otro integrante.</li>
      </ul>
    ),
  },
  {
    id: "oportunidades",
    title: "12. Oportunidades con entidades y aliados",
    body: (
      <ul>
        <li>LUFT puede mostrarte productos de entidades financieras y aliados que encajan con tu perfil, y explicarte por qué.</li>
        <li>Tu información solo se presenta a una entidad si lo autorizas expresamente, una presentación a la vez.</li>
        <li>La decisión es de la entidad. LUFT no aprueba ni niega esos productos.</li>
      </ul>
    ),
  },
  {
    id: "uso",
    title: "13. Uso permitido",
    body: (
      <>
        <p>No está permitido:</p>
        <ul>
          <li>Registrarte con datos de otra persona o con documentos falsos o alterados.</li>
          <li>Intentar entrar a cuentas ajenas, saltarte los controles de seguridad o extraer datos de forma automatizada.</li>
          <li>Usar la plataforma para fraude, lavado de activos o cualquier actividad ilegal.</li>
          <li>Interferir con el funcionamiento del servicio o de quienes lo usan.</li>
        </ul>
        <p>Si detectamos alguna de estas conductas podemos suspender o cerrar la cuenta y avisar a las autoridades.</p>
      </>
    ),
  },
  {
    id: "propiedad",
    title: "14. Propiedad intelectual",
    body: <p>La marca LUFT, el personaje Lufty, los cursos, los textos, el diseño y el software son de Tureporte S.A.S. o de sus licenciantes. Puedes usarlos dentro de la plataforma para tu uso personal; no puedes copiarlos, venderlos ni publicarlos sin permiso escrito.</p>,
  },
  {
    id: "datos",
    title: "15. Tus datos personales",
    body: (
      <>
        <p>Tureporte S.A.S. es responsable del tratamiento de tus datos conforme a la Ley 1581 de 2012. La política completa está en <a href={PRIVACY} target="_blank" rel="noreferrer">restaurar.co/privacy</a>.</p>
        <ul>
          <li>Cada finalidad sensible tiene su propia autorización: consulta en centrales de riesgo, compartir tu diagnóstico con StartIF, comunicaciones, compartir con tu hogar, conexión de cuentas y asistencia tributaria.</li>
          <li>En Perfil → Privacidad ves lo que autorizaste y puedes retirarlo. Algunas autorizaciones son necesarias para un servicio: al retirarlas ese servicio deja de estar disponible.</li>
          <li>Puedes conocer, actualizar, rectificar y pedir la supresión de tus datos por Ayuda y PQR o por correo, y acudir a la Superintendencia de Industria y Comercio.</li>
        </ul>
      </>
    ),
  },
  {
    id: "biometricos",
    title: "16. Datos biométricos",
    body: (
      <>
        <p>Para estudiar un crédito validamos tu identidad comparando la imagen de tu rostro con tu documento. Esos son <strong>datos sensibles</strong>: no estás obligado a autorizarlos y solo los tratamos con tu autorización expresa, que damos por separado al solicitar el crédito.</p>
        <ul>
          <li>Los usamos únicamente para confirmar que eres tú y prevenir la suplantación.</li>
          <li>La validación la hace un proveedor especializado que actúa por encargo de Tureporte S.A.S. y no puede usar tus datos para nada más.</li>
          <li>Sin esa validación no es posible estudiar un crédito, pero puedes seguir usando el resto de LUFT.</li>
        </ul>
      </>
    ),
  },
  {
    id: "medicion",
    title: "17. Medición de visitas",
    body: (
      <>
        <p>En las páginas públicas (inicio, registro y páginas legales) usamos una herramienta propia para saber cuántas visitas recibimos y por dónde llegan. No usa cookies, no muestra publicidad, no comparte datos con terceros y no guarda tu dirección IP; solo deja un identificador anónimo en tu navegador.</p>
        <p>No medimos nada dentro de tu cuenta. Si prefieres que tampoco se cuenten tus visitas, abre cualquier página pública agregando <code>?notrack=1</code> al final de la dirección; con <code>?notrack=0</code> lo vuelves a activar.</p>
      </>
    ),
  },
  {
    id: "comunicaciones",
    title: "18. Comunicaciones",
    body: <p>Te escribimos por correo, SMS, notificaciones de la app y WhatsApp. Los avisos de tu cuenta y de tus obligaciones son indispensables y no se pueden desactivar; los mensajes educativos y promocionales solo los recibes si los autorizas y puedes dejar de recibirlos cuando quieras.</p>,
  },
  {
    id: "cierre",
    title: "19. Cierre de la cuenta",
    body: (
      <ul>
        <li>Puedes cerrar tu cuenta en Perfil → Mi cuenta, con tu contraseña.</li>
        <li>Si no tienes registros financieros, borramos tu información de la operación.</li>
        <li>Si tienes créditos, pagos o documentos firmados, la ley nos obliga a conservarlos: la cuenta queda cerrada y sin acceso, y esos registros se guardan durante el tiempo de retención legal.</li>
        <li>Cerrar la cuenta no extingue las obligaciones que tengas pendientes.</li>
      </ul>
    ),
  },
  {
    id: "disponibilidad",
    title: "20. Disponibilidad y responsabilidad",
    body: (
      <>
        <p>Trabajamos para que LUFT esté disponible y sea seguro, pero puede haber interrupciones por mantenimiento, fallas técnicas o de terceros como bancos, operadores y centrales de riesgo. Cuando un proveedor externo no responde, la plataforma lo informa y no simula un resultado.</p>
        <p>Nada de lo anterior limita los derechos que la ley te reconoce como consumidor, incluida la garantía del servicio.</p>
      </>
    ),
  },
  {
    id: "pqr",
    title: "21. Peticiones, quejas y reclamos",
    body: (
      <>
        <p>Escríbenos por Ayuda y PQR dentro de la app o a <a href="mailto:soporte@luft.com.co">soporte@luft.com.co</a>. Respondemos las consultas en un máximo de 10 días y las peticiones, quejas y reclamos en un máximo de 15 días; en la app ves el estado de cada caso.</p>
        <p>Si no quedas conforme puedes acudir a la Superintendencia de Industria y Comercio, autoridad de protección al consumidor y de datos personales: <a href="https://www.sic.gov.co" target="_blank" rel="noreferrer">www.sic.gov.co</a>.</p>
      </>
    ),
  },
  {
    id: "cambios",
    title: "22. Cambios a estos términos",
    body: <p>Podemos actualizar estos términos. La versión vigente es siempre la publicada en esta página, con su fecha. Si un cambio afecta tus derechos u obligaciones te avisamos en la app o por correo antes de que empiece a regir; si no lo aceptas puedes cerrar tu cuenta.</p>,
  },
  {
    id: "ley",
    title: "23. Ley aplicable",
    body: <p>Estos términos se rigen por las leyes de la República de Colombia, en especial el Estatuto del Consumidor (Ley 1480 de 2011), la Ley 527 de 1999, la Ley 1581 de 2012 y la Ley 1266 de 2008. Cualquier diferencia se resuelve ante las autoridades y los jueces colombianos.</p>,
  },
];

export default function TermsPage() {
  return (
    <main className="legal-doc">
      <header><Brand /><Link href="/registro" className="legal-doc-back">Crear mi cuenta</Link></header>
      <article>
        <span className="eyebrow">LUFT · Tureporte S.A.S.</span>
        <h1>Términos y Condiciones</h1>
        <p className="legal-doc-meta">Versión {VERSION} · Vigentes desde el 23 de noviembre de 2026</p>
        <nav aria-label="Contenido">
          <ol>{SECTIONS.map((section) => <li key={section.id}><a href={`#${section.id}`}>{section.title.replace(/^\d+\.\s/, "")}</a></li>)}</ol>
        </nav>
        {SECTIONS.map((section) => (
          <section key={section.id} id={section.id}>
            <h2>{section.title}</h2>
            {section.body}
          </section>
        ))}
        <footer>
          <p>Tureporte S.A.S. · NIT 900.896.499-0 · Colombia</p>
          <p><a href={PRIVACY} target="_blank" rel="noreferrer">Política de tratamiento de datos</a> · <a href="mailto:soporte@luft.com.co">soporte@luft.com.co</a> · <a href="https://www.sic.gov.co" target="_blank" rel="noreferrer">Superintendencia de Industria y Comercio</a></p>
        </footer>
      </article>
    </main>
  );
}

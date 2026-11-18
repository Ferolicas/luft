"use client";

import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { useLuft } from "@/components/luft/shell";
import { Alert, Bar, Button, Card, Chip, Header, Icon, Lufty, Screen, Tip } from "@/components/luft/ui";
import { api, errorMessage } from "@/lib/api";
import { DOCUMENTS, fileSize } from "@/lib/profile";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = ["application/pdf", "image/jpeg", "image/png"];

function upload(kind: string, file: File, onProgress: (percent: number) => void, register: (abort: () => void) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/luft/documents/${kind}`);
    request.withCredentials = true;
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    request.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) return resolve();
      let message = "No pudimos cargar el archivo.";
      try { const body = JSON.parse(request.responseText) as { message?: string | string[] }; if (body.message) message = Array.isArray(body.message) ? body.message.join(" · ") : body.message; } catch { /* respuesta sin detalle */ }
      reject(new Error(message));
    };
    request.onerror = () => reject(new Error("Se interrumpió la conexión. Intenta de nuevo."));
    request.onabort = () => reject(new Error("Carga cancelada."));
    register(() => request.abort());
    request.send(file);
  });
}

export default function DocumentPage() {
  const { kind: slug } = useParams<{ kind: string }>();
  const { data, reload } = useLuft();
  const spec = DOCUMENTS.find((item) => item.slug === slug);
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const abort = useRef<() => void>(() => undefined);
  const [current, setCurrent] = useState<{ name: string; size: number; percent: number } | null>(null);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  if (!spec) return <Screen><Header back="/app/perfil/financiero/documentos" title="Documento no encontrado" /><div className="l-body"><Tip lufty>No reconocemos este documento.</Tip></div></Screen>;
  const files = data.journey.documents.filter((item) => item.kind === spec.kind);
  const list = "/app/perfil/financiero/documentos";

  async function choose(selection: FileList | null) {
    const file = selection?.[0]; if (!file) return;
    setFailure("");
    if (!ACCEPT.includes(file.type)) return setFailure("Solo aceptamos archivos PDF, JPG o PNG.");
    if (file.size > MAX_BYTES) return setFailure("El archivo supera los 10 MB.");
    setCurrent({ name: file.name, size: file.size, percent: 0 });
    try { await upload(spec!.kind, file, (percent) => setCurrent({ name: file.name, size: file.size, percent }), (cancel) => { abort.current = cancel; }); await reload(); }
    catch (cause) { setFailure(errorMessage(cause)); }
    finally { setCurrent(null); if (input.current) input.current.value = ""; if (camera.current) camera.current.value = ""; }
  }
  async function remove(id: string) { setBusy(true); setFailure(""); try { await api(`/luft/documents/${id}`, { method: "DELETE" }); await reload(); } catch (cause) { setFailure(errorMessage(cause)); } finally { setBusy(false); } }
  const pickers = <>
    <input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" hidden onChange={(event) => choose(event.target.files)} />
    <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(event) => choose(event.target.files)} />
  </>;

  if (current) return (
    <Screen blue>
      <div className="l-celebrate" style={{ paddingTop: 72 }}>
        <div className="l-halo on-blue"><Lufty mood="wink" tone="white" width={200} /></div>
        <h1 style={{ fontSize: 24 }}>{spec.uploading}</h1>
        <p>Espera a que tu documento se suba a nuestros sistemas. ¡No tardará mucho!</p>
        <div className="l-upload">
          <div className="l-row"><span className="l-icon-box white"><Icon name="description" /></span><span className="l-grow"><strong style={{ display: "block", fontWeight: 500, overflowWrap: "anywhere" }}>{current.name}</strong><span style={{ fontSize: 12, opacity: .8 }}>{fileSize(current.size)}</span></span><button className="l-round" onClick={() => abort.current()} aria-label="Cancelar carga"><Icon name="close" /></button></div>
          <Bar value={current.percent} tone="on-blue" label="Carga del archivo" />
          <div className="l-row between" style={{ fontSize: 12 }}><span>Subiendo… {fileSize((current.size * current.percent) / 100)} de {fileSize(current.size)}</span><strong>{current.percent}%</strong></div>
          <ul className="l-checks" style={{ color: "#fff" }}><li><Icon name="check_circle" className="" />Archivo seleccionado</li><li><Icon name="schedule" className="" />Subiendo a nuestros sistemas…</li></ul>
        </div>
      </div>
    </Screen>
  );

  return (
    <Screen>
      <Header back={list} title={spec.title} subtitle={files.length ? `${spec.note} · ${files.length} archivo${files.length === 1 ? "" : "s"}` : spec.note} />
      <div className="l-body">
        {pickers}
        {files.length === 0 ? <>
          <Card>
            <div className="l-row"><span className="l-icon-box"><Icon name="description" /></span><span><strong style={{ fontWeight: 500 }}>{spec.title}</strong><span className="l-small" style={{ display: "block" }}>PDF, JPG o PNG · máx. 10 MB</span></span></div>
            <button type="button" className="l-drop" onClick={() => input.current?.click()}><span><Icon name="upload" /></span>Toca para elegir un archivo</button>
          </Card>
          <Card className="tight" as="div"><strong style={{ fontSize: 14, fontWeight: 500 }}>Antes de subir tu archivo</strong><ul className="l-checks"><li><Icon name="check_circle" />Incluye todas las páginas</li><li><Icon name="check_circle" />Se lee completo y sin tachones</li><li><Icon name="check_circle" />Sin recortes, sombras ni reflejos</li></ul></Card>
        </> : <>
          {files.map((file) => (
            <Card key={file.id}>
              <div className="l-tip green" style={{ alignItems: "center" }}><Icon name="check_circle" /><strong style={{ fontSize: 14 }}>Documento cargado</strong></div>
              <div className="l-row"><span className="l-icon-box"><Icon name="description" /></span><span className="l-grow"><strong style={{ display: "block", fontWeight: 500, overflowWrap: "anywhere" }}>{file.fileName}</strong><span className="l-small">{fileSize(file.sizeBytes)} · {new Date(file.uploadedAt).toLocaleDateString("es-CO", { dateStyle: "medium" })}</span></span><Chip tone="green" dot>Guardado</Chip></div>
              <div className="l-doc-actions" style={{ gridTemplateColumns: "1fr 1fr" }}><a href={`/api/luft/documents/${file.id}/file`} target="_blank" rel="noreferrer"><Icon name="visibility" size={16} />Ver</a><button className="danger" onClick={() => remove(file.id)} disabled={busy}><Icon name="delete" size={16} />Eliminar</button></div>
            </Card>
          ))}
          <Tip icon="lock" title="Guardado y cifrado">Tu archivo se almacena cifrado. Un documento cargado no implica validación ni aprobación.</Tip>
        </>}
        {failure && <Alert>{failure}</Alert>}
      </div>
      <div className="l-footer">
        {files.length === 0 ? <><Button onClick={() => input.current?.click()}>Elegir archivo</Button><Button variant="secondary" onClick={() => camera.current?.click()}>Tomar foto</Button></>
          : <><Button href={list}>Volver a documentos</Button>{files.length < 3 && <Button variant="secondary" icon="add" onClick={() => input.current?.click()}>Agregar otro archivo</Button>}</>}
      </div>
    </Screen>
  );
}

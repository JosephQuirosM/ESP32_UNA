import { useEffect, useState } from "react";
import { ArrowLeft, FileText, FolderOpen, Plus, X } from "lucide-react";

type Raiz = { id: string; ruta: string; nombre: string };
export type ElementoAutorizado = { nombre: string; ruta: string; relativa: string; tipo: "carpeta" | "archivo"; tamano: number | null };
type Carpeta = { raiz: Raiz; carpeta: string; actual: string; elementos: ElementoAutorizado[] };
export type TipoSeleccion = "carpeta" | "csv" | "joblib" | "todos";

export default function ExploradorAutorizado({ tipo, onElegir, onElegirVarios, onCerrar }: {
  tipo: TipoSeleccion; onElegir: (ruta: string) => void; onElegirVarios?: (archivos: ElementoAutorizado[]) => void; onCerrar: () => void;
}) {
  const [raices, setRaices] = useState<Raiz[]>([]);
  const [raizId, setRaizId] = useState("");
  const [relativa, setRelativa] = useState("");
  const [carpeta, setCarpeta] = useState<Carpeta | null>(null);
  const [error, setError] = useState("");
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [creando, setCreando] = useState(false);
  const [seleccionados, setSeleccionados] = useState<ElementoAutorizado[]>([]);
  const [recarga, setRecarga] = useState(0);
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    let vigente = true;
    void fetch("/api/archivos/raices").then(async r => {
      if (!r.ok) throw new Error("No se pudieron leer las carpetas autorizadas.");
      const datos = await r.json() as Raiz[];
      if (vigente) { setRaices(datos); setRaizId(datos[0]?.id ?? ""); }
    }).catch(e => { if (vigente) setError(String(e)); });
    return () => { vigente = false; };
  }, []);
  useEffect(() => {
    if (!raizId) return;
    let vigente = true;
    setCarpeta(null);
    void fetch(`/api/archivos?raiz=${encodeURIComponent(raizId)}&ruta=${encodeURIComponent(relativa)}`)
      .then(async r => { const datos = await r.json(); if (!r.ok) throw new Error(datos.error); if (vigente) { setCarpeta(datos as Carpeta); setError(""); } })
      .catch(e => { if (vigente) setError(e instanceof Error ? e.message : "No se pudo abrir la carpeta."); });
    return () => { vigente = false; };
  }, [raizId, relativa, recarga]);
  const archivos = carpeta?.elementos.filter(e => e.tipo === "carpeta" || tipo === "todos" || (tipo !== "carpeta" && e.nombre.toLowerCase().endsWith(`.${tipo}`))) ?? [];
  function navegar(ruta: string) {
    setAviso(""); setError(""); setCarpeta(null); setRelativa(ruta);
    if (!onElegirVarios) setSeleccionados([]);
  }
  const anterior = () => navegar(relativa.split(/[\\/]/).slice(0, -1).join("/"));
  function cambiarRaiz(valor: string) { setRaizId(valor); setRelativa(""); setCarpeta(null); setSeleccionados([]); setAviso(""); setError(""); }
  async function crearCarpeta() {
    if (!nombreNuevo.trim() || !raizId || creando) return;
    setCreando(true); setError(""); setAviso("");
    try {
      const nombre = nombreNuevo.trim();
      const respuesta = await fetch("/api/archivos/carpetas", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raiz: raizId, ruta: relativa, nombre }) });
      const datos = await respuesta.json();
      if (!respuesta.ok) throw new Error(datos.error ?? "No se pudo crear la carpeta.");
      setNombreNuevo(""); setAviso(`Carpeta «${nombre}» creada aquí.`); setRecarga(actual => actual + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo crear la carpeta."); }
    finally { setCreando(false); }
  }
  function elegirArchivo(elemento: ElementoAutorizado) {
    setSeleccionados(actual => actual.some(a => a.ruta === elemento.ruta)
      ? actual.filter(a => a.ruta !== elemento.ruta)
      : onElegirVarios ? [...actual, elemento] : [elemento]);
  }
  function continuar() {
    if (tipo === "carpeta" && carpeta) onElegir(carpeta.carpeta);
    else if (onElegirVarios && seleccionados.length) onElegirVarios(seleccionados);
    else if (seleccionados.length) onElegir(seleccionados[0].ruta);
  }
  return <div className="explorador-capa" onMouseDown={onCerrar}>
    <section className="explorador-dialogo tarjeta" role="dialog" aria-modal="true" aria-label="Explorar carpetas autorizadas" onMouseDown={e => e.stopPropagation()}>
      <div className="fila"><h2><FolderOpen size={20}/> Carpetas autorizadas</h2><button className="boton-icono" onClick={onCerrar} aria-label="Cerrar"><X/></button></div>
      {raices.length === 0 ? <p>En la PC anfitriona, abre «Carpetas» y autoriza primero una carpeta de trabajo.</p> : <>
        <div className="explorador-raiz"><label htmlFor="explorador-raiz">Carpeta raíz autorizada<select id="explorador-raiz" value={raizId} onChange={e => cambiarRaiz(e.target.value)}>{raices.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}</select></label></div>
        <div className="explorador-navegacion">
          <div className="explorador-ubicacion"><button className="boton secundario" disabled={!relativa} onClick={anterior}><ArrowLeft size={16}/> Atrás</button><span className="explorador-ruta" aria-label="Ruta dentro de la carpeta raíz">/{relativa}</span></div>
          <div className="explorador-lista" aria-label="Contenido de la carpeta actual">{archivos.map(e => <button key={e.relativa} type="button" className={`explorador-elemento ${seleccionados.some(a => a.ruta === e.ruta) ? "seleccionado" : ""}`} onClick={() => e.tipo === "carpeta" ? navegar(e.relativa) : elegirArchivo(e)}>{e.tipo === "carpeta" ? <FolderOpen size={18}/> : <FileText size={18}/>}<span>{e.nombre}</span>{e.tipo === "archivo" && seleccionados.some(a => a.ruta === e.ruta) && <span aria-hidden="true">✓</span>}</button>)}{!carpeta ? <p>Cargando carpeta...</p> : !archivos.length && <p>No hay archivos ni carpetas disponibles aquí.</p>}</div>
        </div>
        <form className="explorador-crear" onSubmit={e => { e.preventDefault(); void crearCarpeta(); }}><input value={nombreNuevo} maxLength={80} placeholder="Nombre de carpeta nueva" onChange={e => setNombreNuevo(e.target.value)} aria-label="Nombre de carpeta nueva"/><button className="boton secundario" type="submit" disabled={!carpeta || !nombreNuevo.trim() || creando}><Plus size={16}/> Crear carpeta</button></form>
        {aviso && <p className="explorador-aviso" role="status">{aviso}</p>}
        <div className="explorador-acciones"><button className="boton explorador-continuar" type="button" disabled={!carpeta || (tipo !== "carpeta" && !seleccionados.length)} onClick={continuar}>Continuar</button></div>
      </>}
      {error && <p className="entrenamiento-error" role="alert">{error}</p>}
    </section>
  </div>;
}

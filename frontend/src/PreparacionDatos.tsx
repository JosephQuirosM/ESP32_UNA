import ConfigurarCuadricula from "./ConfigurarCuadricula";
import { generarZonas, type GeometriaCuadricula } from "./cuadricula";
import { useEffect, useRef, useState } from "react";
import { cargarRutasPreferidas } from "./rutasPreferidas";
import ExploradorAutorizado, { type ElementoAutorizado } from "./ExploradorAutorizado";
import PreparacionJugadores from "./PreparacionJugadores";
import { AlertTriangle, CheckCircle2, Download, FileText, FolderOpen, LoaderCircle, Save, Trash2, UploadCloud, UsersRound } from "lucide-react";

type Archivo = { id: string; file?: File; ruta?: string; nombre: string; tamano: number; zona: string };
type Resultado = {
  cuadricula?: GeometriaCuadricula | null; rutaSalida: string; id: string; nombre: string; descarga: string; resumenDescarga: string; zonas: number[];
  resumen: { archivos_entrada: number; filas_entrada: number; vectores_completos: number; vectores_estables: number; duplicados_en_vector: number };
};
const MAX_BYTES = 28 * 1024 * 1024;

export default function PreparacionDatos() {
  const [seccion, setSeccion] = useState<"entrenamiento" | "jugadores">("entrenamiento");
  return <section className="preparacion" aria-label="Preparación de datos">
    <div className="selector-modo preparacion-pestanas" role="group" aria-label="Sección de preparación">
      <button className={seccion === "entrenamiento" ? "activo" : ""} aria-pressed={seccion === "entrenamiento"} onClick={() => setSeccion("entrenamiento")}><Save size={19}/> Entrenamiento</button>
      <button className={seccion === "jugadores" ? "activo" : ""} aria-pressed={seccion === "jugadores"} onClick={() => setSeccion("jugadores")}><UsersRound size={19}/> Jugadores</button>
    </div>
    {seccion === "jugadores" ? <PreparacionJugadores/> : <PreparacionEntrenamiento/>}
  </section>;
}

function PreparacionEntrenamiento() {
  const [archivos, setArchivos] = useState<Archivo[]>([]);
  const [arrastrando, setArrastrando] = useState(false);
  const [error, setError] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [directorioSalida, setDirectorioSalida] = useState("");
  const [seleccionandoCarpeta, setSeleccionandoCarpeta] = useState(false);
  const [selectorLocal, setSelectorLocal] = useState(false);
  const [exploradorRemoto, setExploradorRemoto] = useState<"entrada" | "salida" | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [definirCuadricula, setDefinirCuadricula] = useState(false);
  const [cuadricula, setCuadricula] = useState<GeometriaCuadricula>({ filas: 3, columnas: 3, zonas: generarZonas(3, 3) });
  const inputRef = useRef<HTMLInputElement>(null);
  const contador = useRef(0);
  const arrastres = useRef(0);
  const invalidos = archivos.some((a) => !/^\d+$/.test(a.zona) || !Number.isSafeInteger(Number(a.zona)) || Number(a.zona) < 1 || (definirCuadricula && Number(a.zona) > cuadricula.zonas.length));
  useEffect(() => {
    let vigente = true;
    void cargarRutasPreferidas().then(rutas => {
      if (vigente) setSelectorLocal(rutas.selectorLocal === true);
      if (vigente && rutas.preparacionSalida) setDirectorioSalida(actual => actual || rutas.preparacionSalida!);
    }).catch(() => {});
    return () => { vigente = false; };
  }, []);

  function agregar(lista: FileList | File[]) {
    if (procesando) return;
    const nuevos: Archivo[] = [];
    const avisos: string[] = [];
    let total = archivos.reduce((sum, a) => sum + a.tamano, 0);
    const nombres = new Set(archivos.map((a) => a.nombre.toLowerCase()));
    for (const file of Array.from(lista)) {
      if (!file.name.toLowerCase().endsWith(".csv")) { avisos.push(`${file.name}: sólo se admiten CSV.`); continue; }
      if (!file.size) { avisos.push(`${file.name}: el archivo está vacío.`); continue; }
      if (nombres.has(file.name.toLowerCase())) { avisos.push(`${file.name}: ya está seleccionado.`); continue; }
      if (archivos.length + nuevos.length >= 200 || total + file.size > MAX_BYTES) { avisos.push("El límite es de 200 archivos y 28 MB en total."); break; }
      nombres.add(file.name.toLowerCase()); total += file.size;
      nuevos.push({ id: String(++contador.current), file, nombre: file.name, tamano: file.size, zona: /zona[_ -]?(\d+)(?:[_. -]|$)/i.exec(file.name)?.[1] ?? "" });
    }
    setArchivos((actuales) => [...actuales, ...nuevos]);
    setError(avisos.join(" ")); setResultado(null);
  }
  function agregarDesdePc(elementos: ElementoAutorizado[]) {
    const nuevos: Archivo[] = [];
    const avisos: string[] = [];
    let total = archivos.reduce((sum, a) => sum + a.tamano, 0);
    const nombres = new Set(archivos.map(a => a.nombre.toLowerCase()));
    for (const elemento of elementos) {
      const tamano = elemento.tamano ?? 0;
      if (elemento.tipo !== "archivo" || !elemento.nombre.toLowerCase().endsWith(".csv") || !tamano) { avisos.push(`${elemento.nombre}: CSV no válido.`); continue; }
      if (nombres.has(elemento.nombre.toLowerCase())) { avisos.push(`${elemento.nombre}: ya está seleccionado.`); continue; }
      if (archivos.length + nuevos.length >= 200 || total + tamano > MAX_BYTES) { avisos.push("El límite es de 200 archivos y 28 MB en total."); break; }
      nombres.add(elemento.nombre.toLowerCase()); total += tamano;
      nuevos.push({ id: String(++contador.current), ruta: elemento.ruta, nombre: elemento.nombre, tamano, zona: /zona[_ -]?(\d+)(?:[_. -]|$)/i.exec(elemento.nombre)?.[1] ?? "" });
    }
    setArchivos(actuales => [...actuales, ...nuevos]); setError(avisos.join(" ")); setResultado(null);
    setExploradorRemoto(null);
  }
  function editar(id: string, cambio: Partial<Archivo>) {
    setArchivos((lista) => lista.map((a) => a.id === id ? { ...a, ...cambio } : a));
    setResultado(null); setError("");
  }
  async function explorarCarpeta() {
    setSeleccionandoCarpeta(true); setError("");
    try {
      const respuesta = await fetch("/api/preparacion/seleccionar-carpeta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ruta: directorioSalida }) });
      const datos = await respuesta.json();
      if (!respuesta.ok) throw new Error(datos.error ?? "No se pudo abrir el selector de carpetas.");
      if (datos.ruta) { setDirectorioSalida(datos.ruta); setResultado(null); }
    } catch (e) { setError(e instanceof TypeError ? "No se pudo conectar con el servidor local." : e instanceof Error ? e.message : "No se pudo seleccionar la carpeta."); }
    finally { setSeleccionandoCarpeta(false); }
  }
  async function preparar() {
    if (!directorioSalida.trim()) { setError("Selecciona una carpeta de salida en la PC del backend."); return; }
    setProcesando(true); setError(""); setResultado(null);
    try {
      const carga = await Promise.all(archivos.map(async (a) => a.ruta ? { ruta: a.ruta, zona: Number(a.zona) } :
        { nombre: a.nombre, contenido: await a.file!.text(), zona: Number(a.zona) }));
      const respuesta = await fetch("/api/preparacion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archivos: carga, directorioSalida, ...(definirCuadricula ? { cuadricula } : {}) }) });
      const datos = await respuesta.json();
      if (!respuesta.ok) throw new Error(datos.error ?? "No se pudieron preparar los archivos.");
      setResultado(datos as Resultado);
    } catch (e) {
      setError(e instanceof TypeError ? "No se pudo conectar con el servidor. Conservamos tus archivos seleccionados para reintentar." : e instanceof Error ? e.message : "No se pudo completar la preparación.");
    } finally { setProcesando(false); }
  }
  return (
    <>
      <div className="preparacion-layout">
        <div className="preparacion-entrada">
          <section className={`tarjeta preparacion-drop ${archivos.length ? "con-archivos" : ""} ${arrastrando ? "arrastrando" : ""}`} aria-label="Cargar archivos CSV"
            onDragEnter={(e) => { e.preventDefault(); if (!procesando && e.dataTransfer.types.includes("Files")) { arrastres.current++; setArrastrando(true); } }}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = procesando ? "none" : "copy"; }}
            onDragLeave={(e) => { e.preventDefault(); arrastres.current = Math.max(0, arrastres.current - 1); if (!arrastres.current) setArrastrando(false); }}
            onDrop={(e) => { e.preventDefault(); arrastres.current = 0; setArrastrando(false); agregar(e.dataTransfer.files); }}>
            <input ref={inputRef} type="file" multiple accept=".csv,text/csv" hidden disabled={procesando} aria-label="Seleccionar archivos CSV" onChange={(e) => { if (e.target.files) agregar(e.target.files); e.target.value = ""; }} />
            {!archivos.length && <>
            <span className="preparacion-icono"><UploadCloud size={32} /></span>
            <h2>Arrastra y suelta aquí tus archivos CSV de recolección</h2>
            <p>Un archivo por zona. Puedes cargar tantos como necesites.</p>
            <span className="preparacion-formato"><FileText size={15} /> Archivos aceptados: <strong>.csv</strong></span>
            </>}
            {!!archivos.length && <>
              <div className="preparacion-cantidad" aria-live="polite"><CheckCircle2 size={16} /> {archivos.length} archivos seleccionados</div>
              <div className="preparacion-scroll" role="region" aria-label="Archivos CSV seleccionados" tabIndex={0}>
                {archivos.map((a) => <article className="preparacion-archivo" key={a.id}>
                  <strong className="preparacion-csv">.CSV</strong>
                  <span className="preparacion-nombre" title={a.ruta ?? a.nombre}>{a.nombre}</span>
                  <small>{(a.tamano / 1024).toLocaleString("es-CR", { maximumFractionDigits: 1 })} KB</small>
                  <label>Zona<input type="number" min="1" step="1" value={a.zona} disabled={procesando} aria-label={`Zona de ${a.nombre}`} placeholder="Ej. 1" onChange={(e) => editar(a.id, { zona: e.target.value })} /></label>
                  <button className="preparacion-eliminar" disabled={procesando} aria-label={`Eliminar ${a.nombre}`} onClick={() => { setArchivos((lista) => lista.filter((b) => b.id !== a.id)); setResultado(null); setError(""); }}>Eliminar</button>
                </article>)}
              </div>
            </>}
            <div className="preparacion-acciones">
              <button className="boton secundario" disabled={procesando} onClick={() => inputRef.current?.click()}><FolderOpen size={18} /> Abrir gestor de archivos</button>
              <button className="boton secundario" disabled={procesando} onClick={() => setExploradorRemoto("entrada")}><FolderOpen size={18}/> Explorar CSV de la PC</button>
              <button className="boton preparacion-limpiar" disabled={procesando || !archivos.length} onClick={() => { setArchivos([]); setError(""); setResultado(null); }}><Trash2 size={17} /> Limpiar archivos cargados</button>
            </div>
          </section>
          <section className="tarjeta entrenamiento-seccion">
            <h2>Geometría de las zonas</h2>
            <p>Las capturas guiadas nuevas conservan automáticamente filas, columnas y posiciones. Se guardan en el CSV etiquetado y en el modelo.</p>
            <label className="geometria-opcion"><input type="checkbox" checked={definirCuadricula} disabled={procesando}
              onChange={e => { setDefinirCuadricula(e.target.checked); setResultado(null); }} /><span>Definir cuadrícula para archivos sin geometría</span></label>
            {definirCuadricula && <ConfigurarCuadricula valor={cuadricula} bloqueado={procesando}
              onChange={valor => { setCuadricula(valor); setResultado(null); }} />}
            <small>Si los archivos ya tienen geometría, debe coincidir con la indicada. No combines acomodos diferentes.</small>
          </section>
          <div className="preparacion-aviso"><AlertTriangle size={21} /><p>Verifica la zona de cada archivo antes de preparar. Se reconoce del nombre, por ejemplo <code>dataset1_zona_1.csv</code>, y puedes corregirla en su tarjeta. No se eliminan registros iniciales ni se aplican recortes por tiempo.</p></div>
        </div>
        <aside className="tarjeta preparacion-salida">
          <div className="preparacion-titulo"><span className="preparacion-icono pequeno"><Save size={21} /></span><div><h2>Archivo consolidado de salida</h2><p>Un único CSV etiquetado para entrenar</p></div></div>
          <div className="preparacion-previa"><span>Nombre del archivo:</span><strong><FileText size={17} />dataset_etiquetado.csv</strong></div>
          <p>Se agrupan las cuatro lecturas RSSI de cada secuencia y se conserva su zona y archivo de origen.</p>
          <div className="preparacion-destino">
            <label htmlFor="directorio-salida">Carpeta de salida en la PC del backend</label>
            <div className="preparacion-elegir-ruta"><input id="directorio-salida" value={directorioSalida} placeholder="Selecciona o escribe una carpeta del backend" disabled={procesando || seleccionandoCarpeta} onChange={(e) => { setDirectorioSalida(e.target.value); setResultado(null); }} />{selectorLocal ? <button className="boton secundario" disabled={procesando || seleccionandoCarpeta} onClick={explorarCarpeta}><FolderOpen size={18} /> {seleccionandoCarpeta ? "Seleccionando…" : "Explorar"}</button> : <button className="boton secundario" disabled={procesando} onClick={() => setExploradorRemoto("salida")}><FolderOpen size={18}/> Explorar carpetas</button>}</div>
            {seleccionandoCarpeta && <p role="status">Selecciona la carpeta en la ventana del sistema operativo.</p>}
            <small>El CSV y el resumen se guardarán aquí. Si el nombre ya existe, se añade un número.</small>
          </div>
          {invalidos && <p className="preparacion-pendiente">Revisa las zonas: deben ser enteros positivos y pertenecer a la cuadrícula indicada.</p>}
          <button className="boton primario" disabled={!archivos.length || !directorioSalida.trim() || invalidos || procesando || seleccionandoCarpeta} onClick={preparar}>{procesando ? <LoaderCircle size={19} className="preparacion-girando" /> : <Save size={19} />}{procesando ? "Preparando datos…" : "Preparar datos y unificar CSV"}</button>
          {procesando && <p role="status">Python está validando y agrupando las lecturas. Espera a que termine.</p>}
          {error && <p className="preparacion-error" role="alert">{error}</p>}
          {resultado && <div className="preparacion-resultado" role="status">
            <h3><CheckCircle2 size={19} /> CSV preparado</h3>
            {resultado.cuadricula && <p>Cuadrícula conservada: {resultado.cuadricula.filas} × {resultado.cuadricula.columnas} · {resultado.cuadricula.zonas.length} zonas.</p>}
            <p className="preparacion-guardado">Guardado en: <strong>{resultado.rutaSalida}</strong></p>
            <dl><div><dt>Archivos procesados</dt><dd>{resultado.resumen.archivos_entrada}</dd></div><div><dt>Lecturas recibidas</dt><dd>{resultado.resumen.filas_entrada}</dd></div><div><dt>Vectores completos</dt><dd>{resultado.resumen.vectores_completos}</dd></div><div><dt>Vectores incompletos</dt><dd>{resultado.resumen.vectores_estables - resultado.resumen.vectores_completos}</dd></div><div><dt>Lecturas duplicadas</dt><dd>{resultado.resumen.duplicados_en_vector}</dd></div></dl>
            <p>Los incompletos quedan marcados; sólo los completos se usan para entrenar.</p>
            <a className="boton primario" href={resultado.descarga}><Download size={18} /> Descargar CSV etiquetado</a>
            <a href={resultado.resumenDescarga}>Descargar resumen JSON</a>
          </div>}
        </aside>
      </div>
      {exploradorRemoto === "salida" && <ExploradorAutorizado tipo="carpeta" onCerrar={() => setExploradorRemoto(null)} onElegir={ruta => { setDirectorioSalida(ruta); setResultado(null); setExploradorRemoto(null); }}/>}
      {exploradorRemoto === "entrada" && <ExploradorAutorizado tipo="csv" onCerrar={() => setExploradorRemoto(null)} onElegir={() => {}} onElegirVarios={agregarDesdePc}/>}
    </>
  );
}

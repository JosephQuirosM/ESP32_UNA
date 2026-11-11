import type { GeometriaCuadricula } from "./cuadricula";
import { useEffect, useRef, useState } from "react";
import { Activity, CheckCircle2, Download, FileText, FolderOpen, LoaderCircle, Play, Settings2 } from "lucide-react";
import { cargarRutasPreferidas } from "./rutasPreferidas";
import ExploradorAutorizado from "./ExploradorAutorizado";

type Resumen = { cuadricula?: GeometriaCuadricula | null; entrada: string; filas: number; vectores_completos: number; vectores_incompletos: number; zonas: number[]; por_zona: Record<string, number> };
type Trabajo = { entrada?: string; nombre?: string; directorioSalida?: string; parametros?: Record<string, string | number | boolean | null>; id: string; estado: "pendiente" | "entrenando" | "completado" | "error"; error?: string; rutaModelo?: string; rutaResumen?: string; algoritmo?: string; resumen?: Resumen; duracion_segundos?: number; descarga?: string; resumenDescarga?: string };
async function pedir(ruta: string, carga?: unknown) {
  const respuesta = await fetch(`/api/entrenamiento${ruta}`, carga === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(carga) });
  const datos = await respuesta.json();
  if (!respuesta.ok) throw new Error(datos.error ?? "No se pudo completar la operación.");
  return datos;
}
const esEntero = (s: string, min: number, max: number) => /^\d+$/.test(s) && Number.isSafeInteger(Number(s)) && Number(s) >= min && Number(s) <= max;
const CLAVE = "esp32.entrenamiento.actual";
function ultimoTrabajo() { try { return localStorage.getItem(CLAVE); } catch { return null; } }
function olvidarTrabajo() { try { localStorage.removeItem(CLAVE); } catch { /* Sin almacenamiento local. */ } }

export default function EntrenamientoModelos() {
  const [entrada, setEntrada] = useState("");
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [algoritmo, setAlgoritmo] = useState<"knn" | "random_forest">("knn");
  const [nombre, setNombre] = useState("modelo_knn");
  const [directorioSalida, setDirectorioSalida] = useState("");
  const [selectorLocal, setSelectorLocal] = useState(false);
  const [exploradorRemoto, setExploradorRemoto] = useState<"entrada" | "salida" | null>(null);
  const [k, setK] = useState("5");
  const [pesos, setPesos] = useState("distance");
  const [distancia, setDistancia] = useState("euclidean");
  const [normalizar, setNormalizar] = useState(true);
  const [arboles, setArboles] = useState("300");
  const [profundidad, setProfundidad] = useState("");
  const [minDivision, setMinDivision] = useState("2");
  const [minHoja, setMinHoja] = useState("1");
  const [semilla, setSemilla] = useState("42");
  const [ocupacion, setOcupacion] = useState("");
  const [error, setError] = useState("");
  const [id, setId] = useState<string | null>(ultimoTrabajo);
  const recuperadoAlEntrar = useRef(!!id);
  const [trabajo, setTrabajo] = useState<Trabajo | null>(null);
  const [errorEstado, setErrorEstado] = useState("");
  const enCurso = !!id && (!trabajo || ["pendiente", "entrenando"].includes(trabajo.estado));
  const bloqueado = !!ocupacion || enCurso;
  const parametrosValidos = algoritmo === "knn" ? esEntero(k, 1, resumen?.vectores_completos ?? 1000000) : esEntero(arboles, 1, 2000) && (!profundidad || esEntero(profundidad, 1, 100)) && esEntero(minDivision, 2, 1000) && esEntero(minHoja, 1, 1000) && esEntero(semilla, 0, 2147483647);
  useEffect(() => {
    let vigente = true;
    void cargarRutasPreferidas().then(rutas => {
      if (!vigente) return;
      setSelectorLocal(rutas.selectorLocal === true);
      if (id) return;
      if (rutas.entrenamientoEntrada) setEntrada(actual => actual || rutas.entrenamientoEntrada!);
      if (rutas.entrenamientoSalida) setDirectorioSalida(actual => actual || rutas.entrenamientoSalida!);
    }).catch(() => {});
    return () => { vigente = false; };
  }, [id]);
  useEffect(() => {
    if (!id) return;
    let activo = true;
    let restaurado = false;
    let timer: ReturnType<typeof setTimeout>;
    async function actualizar() {
      try {
        const datos = await pedir(`/${id}`) as Trabajo;
        if (!activo) return;
        if (["completado", "error"].includes(datos.estado) && recuperadoAlEntrar.current) {
          recuperadoAlEntrar.current = false; olvidarTrabajo(); setId(null); setTrabajo(null); setErrorEstado(""); return;
        }
        recuperadoAlEntrar.current = false;
        setTrabajo(datos); setErrorEstado("");
        if (!restaurado && datos.entrada) {
          restaurado = true;
          setEntrada(datos.entrada);
          if (datos.resumen) setResumen({ ...datos.resumen, entrada: datos.entrada });
          if (datos.algoritmo === "knn" || datos.algoritmo === "random_forest") setAlgoritmo(datos.algoritmo);
          if (datos.nombre) setNombre(datos.nombre);
          if (datos.directorioSalida) setDirectorioSalida(datos.directorioSalida);
          const p = datos.parametros;
          if (p) {
            if (p.k !== undefined) setK(String(p.k));
            if (p.pesos) setPesos(String(p.pesos));
            if (p.distancia) setDistancia(String(p.distancia));
            if (typeof p.normalizar === "boolean") setNormalizar(p.normalizar);
            if (p.arboles !== undefined) setArboles(String(p.arboles));
            setProfundidad(p.profundidad == null ? "" : String(p.profundidad));
            if (p.min_division !== undefined) setMinDivision(String(p.min_division));
            if (p.min_hoja !== undefined) setMinHoja(String(p.min_hoja));
            if (p.semilla !== undefined) setSemilla(String(p.semilla));
          }
        }
        if (["completado", "error"].includes(datos.estado)) { olvidarTrabajo(); return; }
      } catch (e) { if (activo) setErrorEstado(e instanceof Error ? e.message : "No se puede consultar el entrenamiento. Reintentando…"); }
      if (activo) timer = setTimeout(actualizar, 1500);
    }
    void actualizar();
    return () => { activo = false; clearTimeout(timer); };
  }, [id]);
  const mensaje = (e: unknown) => e instanceof TypeError ? "No se pudo conectar con el servidor local." : e instanceof Error ? e.message : "No se pudo completar la operación.";
  async function revisar(ruta = entrada) {
    setOcupacion("revisando"); setError(""); setResumen(null);
    try { const datos = await pedir("/inspeccionar", { entrada: ruta }) as Resumen; setResumen(datos); setEntrada(datos.entrada); }
    catch (e) { setError(mensaje(e)); }
    finally { setOcupacion(""); }
  }
  async function seleccionar() {
    setOcupacion("seleccionando"); setError("");
    try {
      const datos = await pedir("/seleccionar-csv", {});
      if (datos.ruta) { setEntrada(datos.ruta); await revisar(datos.ruta); }
    } catch (e) { setError(mensaje(e)); }
    finally { setOcupacion(""); }
  }
  async function carpeta() {
    setOcupacion("carpeta"); setError("");
    try {
      const respuesta = await fetch("/api/preparacion/seleccionar-carpeta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ruta: directorioSalida }) });
      const datos = await respuesta.json();
      if (!respuesta.ok) throw new Error(datos.error);
      if (datos.ruta) setDirectorioSalida(datos.ruta);
    } catch (e) { setError(mensaje(e)); }
    finally { setOcupacion(""); }
  }
  async function entrenar() {
    if (!directorioSalida.trim()) { setError("Selecciona una carpeta de salida en la PC del backend."); return; }
    setOcupacion("iniciando"); setError("");
    const parametros = algoritmo === "knn" ? { k: Number(k), pesos, distancia, normalizar } : { arboles: Number(arboles), profundidad: profundidad ? Number(profundidad) : null, min_division: Number(minDivision), min_hoja: Number(minHoja), semilla: Number(semilla) };
    try {
      const nuevo = await pedir("", { entrada, algoritmo, parametros, nombre, directorioSalida }) as Trabajo;
      setTrabajo(nuevo); setId(nuevo.id);
      try { localStorage.setItem(CLAVE, nuevo.id); } catch { /* El trabajo continúa aunque el almacenamiento del navegador no esté disponible. */ }
    } catch (e) { setError(mensaje(e)); }
    finally { setOcupacion(""); }
  }
  function cambiarAlgoritmo(valor: "knn" | "random_forest") {
    setAlgoritmo(valor);
    if (["modelo_knn", "modelo_random_forest"].includes(nombre)) setNombre(`modelo_${valor}`);
  }
  return <section className="entrenamiento" aria-label="Entrenamiento de modelos">
    <div className="entrenamiento-layout">
      <div className="entrenamiento-columna">
        <section className="tarjeta entrenamiento-seccion">
          <h2><FileText size={21} /> 1. Datos etiquetados</h2>
          <p>Selecciona el CSV generado en Preparación de Datos. El nombre del archivo y su dataset no limitan el entrenamiento.</p>
          <label className="entrenamiento-campo">Archivo CSV en la PC del backend<input value={entrada} disabled={bloqueado} placeholder="Ruta al archivo etiquetado.csv" onChange={e => { setEntrada(e.target.value); setResumen(null); }} /></label>
          <div className="entrenamiento-acciones">{selectorLocal ? <button className="boton secundario" disabled={bloqueado} onClick={seleccionar}><FolderOpen size={18} /> Seleccionar CSV</button> : <button className="boton secundario" disabled={bloqueado} onClick={() => setExploradorRemoto("entrada")}><FolderOpen size={18}/> Explorar CSV</button>}<button className="boton secundario" disabled={bloqueado || !entrada.trim()} onClick={() => void revisar()}>Revisar CSV</button></div>
          {resumen && <div className="entrenamiento-resumen"><h3><CheckCircle2 size={18} /> CSV listo para entrenar</h3>{resumen.cuadricula ? <p>Cuadrícula: {resumen.cuadricula.filas} × {resumen.cuadricula.columnas} · {resumen.cuadricula.zonas.length} zonas. El modelo conservará este acomodo.</p> : <p>CSV sin geometría. Puedes entrenar sus zonas; define filas y columnas en Preparación o al generar mapas.</p>}<div className="entrenamiento-cifras"><div><strong>{resumen.vectores_completos}</strong><span>Vectores completos</span></div><div><strong>{resumen.vectores_incompletos}</strong><span>Incompletos, excluidos</span></div><div><strong>{resumen.zonas.length}</strong><span>Zonas presentes</span></div></div><div className="chips">{resumen.zonas.map(z => <span key={z}>Zona {z}: {resumen.por_zona[String(z)]}</span>)}</div></div>}
        </section>
        <section className="tarjeta entrenamiento-seccion">
          <h2><Settings2 size={21} /> 2. Configura el modelo</h2>
          <div className="entrenamiento-algoritmos" aria-label="Algoritmo"><button aria-pressed={algoritmo === "knn"} disabled={bloqueado} onClick={() => cambiarAlgoritmo("knn")}><strong>KNN</strong><span>Clasifica por vecinos cercanos</span></button><button aria-pressed={algoritmo === "random_forest"} disabled={bloqueado} onClick={() => cambiarAlgoritmo("random_forest")}><strong>Random Forest</strong><span>Combina árboles de decisión</span></button></div>
          <div className="entrenamiento-campos">
            {algoritmo === "knn" ? <>
              <label className="entrenamiento-campo">Número de vecinos (K)<input type="number" min="1" max={resumen?.vectores_completos} step="1" value={k} disabled={bloqueado} onChange={e => setK(e.target.value)} /><small>No debe superar los vectores completos.</small></label>
              <label className="entrenamiento-campo">Peso de los vecinos<select value={pesos} disabled={bloqueado} onChange={e => setPesos(e.target.value)}><option value="distance">Por distancia</option><option value="uniform">Todos por igual</option></select></label>
              <label className="entrenamiento-campo">Distancia<select value={distancia} disabled={bloqueado} onChange={e => setDistancia(e.target.value)}><option value="euclidean">Euclidiana</option><option value="manhattan">Manhattan</option></select></label>
              <label className="entrenamiento-check"><input type="checkbox" checked={normalizar} disabled={bloqueado} onChange={e => setNormalizar(e.target.checked)} /><span>Normalizar RSSI con StandardScaler<small>Se guarda junto al clasificador en el .joblib.</small></span></label>
            </> : <>
              <label className="entrenamiento-campo">Número de árboles<input type="number" min="1" max="2000" value={arboles} disabled={bloqueado} onChange={e => setArboles(e.target.value)} /></label>
              <label className="entrenamiento-campo">Profundidad máxima<input type="number" min="1" max="100" value={profundidad} placeholder="Sin límite" disabled={bloqueado} onChange={e => setProfundidad(e.target.value)} /><small>Vacío significa sin límite.</small></label>
              <label className="entrenamiento-campo">Muestras mínimas para dividir<input type="number" min="2" max="1000" value={minDivision} disabled={bloqueado} onChange={e => setMinDivision(e.target.value)} /></label>
              <label className="entrenamiento-campo">Muestras mínimas por hoja<input type="number" min="1" max="1000" value={minHoja} disabled={bloqueado} onChange={e => setMinHoja(e.target.value)} /></label>
              <label className="entrenamiento-campo">Semilla aleatoria<input type="number" min="0" max="2147483647" value={semilla} disabled={bloqueado} onChange={e => setSemilla(e.target.value)} /><small>Permite repetir el entrenamiento.</small></label>
            </>}
          </div>
        </section>
      </div>
      <aside className="tarjeta entrenamiento-seccion entrenamiento-salida">
        <h2><Activity size={21} /> 3. Generar modelo</h2>
        <label className="entrenamiento-campo">Nombre del modelo<input value={nombre} maxLength={80} disabled={bloqueado} onChange={e => setNombre(e.target.value)} /><small>Letras, números, guiones y guiones bajos. Se añade .joblib.</small></label>
        <label className="entrenamiento-campo" htmlFor="entrenamiento-destino">Carpeta de salida en la PC del backend</label>
        <div className="preparacion-elegir-ruta"><input id="entrenamiento-destino" value={directorioSalida} placeholder="Selecciona o escribe una carpeta del backend" disabled={bloqueado} onChange={e => setDirectorioSalida(e.target.value)} />{selectorLocal ? <button className="boton secundario" disabled={bloqueado} onClick={carpeta}><FolderOpen size={18} /> Explorar</button> : <button className="boton secundario" disabled={bloqueado} onClick={() => setExploradorRemoto("salida")}><FolderOpen size={18}/> Explorar carpetas</button>}</div>
        <p>Se entrenará con todos los vectores completos del CSV. Los archivos existentes se conservan y el nombre recibe un número si hace falta.</p>
        {!parametrosValidos && <p className="entrenamiento-error">Revisa los parámetros: deben estar dentro de los límites indicados.</p>}
        <button className="boton primario" disabled={bloqueado || !directorioSalida.trim() || !resumen || !parametrosValidos || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(nombre)} onClick={entrenar}>{bloqueado ? <LoaderCircle size={18} className="preparacion-girando" /> : <Play size={18} />}{enCurso ? "Entrenando modelo…" : ocupacion === "revisando" ? "Revisando CSV…" : ocupacion === "seleccionando" || ocupacion === "carpeta" ? "Seleccionando…" : ocupacion === "iniciando" ? "Iniciando…" : "Entrenar y guardar modelo"}</button>
        {ocupacion === "seleccionando" || ocupacion === "carpeta" ? <p role="status">Completa la selección en la ventana del sistema operativo.</p> : null}
        {enCurso && <p role="status">Python está entrenando. Puedes cambiar de módulo; el proceso continúa en esta PC.</p>}
        {error && <p className="entrenamiento-error" role="alert">{error}</p>}
        {errorEstado && <p className="entrenamiento-error" role="alert">{errorEstado}</p>}
        {trabajo?.estado === "error" && <p className="entrenamiento-error" role="alert">{trabajo.error}</p>}
        {trabajo?.estado === "completado" && <div className="entrenamiento-resultado" role="status"><h3><CheckCircle2 size={19} /> Modelo entrenado</h3><p>{trabajo.algoritmo === "knn" ? "KNN" : "Random Forest"} · {trabajo.resumen?.vectores_completos} vectores · {trabajo.duracion_segundos?.toFixed(1)} s</p><p>Guardado en: <strong>{trabajo.rutaModelo}</strong></p><a className="boton primario" href={trabajo.descarga}><Download size={18} /> Descargar modelo .joblib</a><a href={trabajo.resumenDescarga}>Descargar resumen JSON</a><p>La precisión se medirá al probar el modelo con un archivo etiquetado elegido por el usuario.</p></div>}
        {id && (!enCurso || !!errorEstado) && <button className="boton secundario" onClick={() => { olvidarTrabajo(); setId(null); setTrabajo(null); setResumen(null); setNombre("modelo_knn"); setAlgoritmo("knn"); setError(""); setErrorEstado(""); }}>Nuevo entrenamiento</button>}
      </aside>
      {exploradorRemoto && <ExploradorAutorizado tipo={exploradorRemoto === "entrada" ? "csv" : "carpeta"} onCerrar={() => setExploradorRemoto(null)} onElegir={ruta => { if (exploradorRemoto === "entrada") { setEntrada(ruta); setResumen(null); } else setDirectorioSalida(ruta); setExploradorRemoto(null); }}/>}
    </div>
  </section>;
}

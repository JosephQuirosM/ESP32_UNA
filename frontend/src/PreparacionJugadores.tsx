import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, FileText, FolderOpen, LoaderCircle, UsersRound } from "lucide-react";
import ExploradorAutorizado from "./ExploradorAutorizado";
import { cargarRutasPreferidas } from "./rutasPreferidas";

type Estadisticas = {
  total_recibido: number; paquetes_esperados: number | null; paquetes_unicos_recibidos: number | null;
  recepcion_porcentaje: number | null; vectores_completos: number | null;
  vectores_completos_porcentaje: number | null; duplicados: number | null;
  secuencias_ausentes: number | null; vectores_incompletos: number | null;
};
type Jugador = {
  indice: number; entrada: string; sesionGateway: number | null; jugadorId: number | null;
  rutaLecturas: string; descarga: string; estadisticas: Estadisticas;
};
type Trabajo = {
  id: string; estado: "pendiente" | "procesando" | "completado" | "error"; error?: string;
  entrada?: string; directorioSalida?: string; nombre?: string;
  total: number; procesados: number; jugadoresProcesados: number; jugadores: Jugador[];
  resumenGeneralCsv?: string; resumenGeneralJson?: string;
};
const CLAVE = "esp32.preparacion.jugadores.actual";
const porcentaje = (valor: number | null) => valor == null ? "No disponible" : `${valor.toFixed(2)} %`;
const nombreArchivo = (ruta: string) => ruta.split(/[\\/]/).at(-1) ?? ruta;
function ultimoTrabajo() { try { return localStorage.getItem(CLAVE); } catch { return null; } }
function olvidarTrabajo() { try { localStorage.removeItem(CLAVE); } catch { /* Sin almacenamiento local. */ } }
async function pedir<T = Trabajo>(ruta: string, datos?: unknown): Promise<T> {
  const respuesta = await fetch(`/api/preparacion/jugadores${ruta}`, datos === undefined ? undefined :
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos) });
  const contenido = await respuesta.json();
  if (!respuesta.ok) throw new Error(contenido.error ?? "No se pudo completar la separación.");
  return contenido as T;
}

export default function PreparacionJugadores() {
  const [entrada, setEntrada] = useState("");
  const [directorioSalida, setDirectorioSalida] = useState("");
  const [nombre, setNombre] = useState("lecturas_jugadores");
  const [selectorLocal, setSelectorLocal] = useState(false);
  const [explorador, setExplorador] = useState<"entrada" | "salida" | null>(null);
  const [ocupacion, setOcupacion] = useState("");
  const [error, setError] = useState("");
  const [errorEstado, setErrorEstado] = useState("");
  const [id, setId] = useState<string | null>(ultimoTrabajo);
  const recuperadoAlEntrar = useRef(!!id);
  const [trabajo, setTrabajo] = useState<Trabajo | null>(null);
  const enCurso = !!id && (!trabajo || ["pendiente", "procesando"].includes(trabajo.estado));
  const bloqueado = !!ocupacion || (enCurso && !errorEstado);
  const nombreValido = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,79}$/u.test(nombre);

  useEffect(() => {
    let vigente = true;
    void cargarRutasPreferidas().then(rutas => {
      if (!vigente) return;
      setSelectorLocal(rutas.selectorLocal === true);
      if (!id) {
        if (rutas.jugadoresEntrada) setEntrada(actual => actual || rutas.jugadoresEntrada!);
        if (rutas.jugadoresSalida) setDirectorioSalida(actual => actual || rutas.jugadoresSalida!);
      }
    }).catch(() => {});
    return () => { vigente = false; };
  }, [id]);
  useEffect(() => {
    if (!id) return;
    let vigente = true, restaurado = false;
    let timer: ReturnType<typeof setTimeout>;
    async function actualizar() {
      try {
        const datos = await pedir(`/${id}`);
        if (!vigente) return;
        if (["completado", "error"].includes(datos.estado) && recuperadoAlEntrar.current) {
          recuperadoAlEntrar.current = false; olvidarTrabajo(); setId(null); setTrabajo(null); setErrorEstado(""); return;
        }
        recuperadoAlEntrar.current = false;
        setTrabajo(datos); setErrorEstado("");
        if (!restaurado) {
          restaurado = true;
          setEntrada(datos.entrada ?? "");
          setDirectorioSalida(datos.directorioSalida ?? "");
          setNombre(datos.nombre ?? "lecturas_jugadores");
        }
        if (["completado", "error"].includes(datos.estado)) { olvidarTrabajo(); return; }
      } catch (e) {
        if (vigente) setErrorEstado(e instanceof Error ? e.message : "No se pudo consultar el trabajo.");
      }
      if (vigente) timer = setTimeout(actualizar, 1500);
    }
    void actualizar();
    return () => { vigente = false; clearTimeout(timer); };
  }, [id]);

  async function seleccionarEntrada() {
    setOcupacion("entrada"); setError("");
    try {
      const datos = await pedir<{ ruta: string | null }>("/seleccionar", {});
      if (datos.ruta) setEntrada(datos.ruta);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo seleccionar el CSV."); }
    finally { setOcupacion(""); }
  }
  async function seleccionarSalida() {
    setOcupacion("salida"); setError("");
    try {
      const datos = await pedir<{ ruta: string | null }>("/seleccionar-carpeta", { ruta: directorioSalida });
      if (datos.ruta) setDirectorioSalida(datos.ruta);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo seleccionar la carpeta."); }
    finally { setOcupacion(""); }
  }
  async function separar() {
    setOcupacion("iniciando"); setError(""); setErrorEstado("");
    try {
      const nuevo = await pedir("", { entrada, directorioSalida, nombre });
      setTrabajo(nuevo); setId(nuevo.id);
      try { localStorage.setItem(CLAVE, nuevo.id); } catch { /* El backend conserva el trabajo. */ }
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo iniciar la separación."); }
    finally { setOcupacion(""); }
  }
  function nuevaSeparacion() {
    setId(null); setTrabajo(null); setError(""); setErrorEstado("");
    setNombre("lecturas_jugadores");
    olvidarTrabajo();
  }

  return <div className="preparacion-jugadores">
    <div className="entrenamiento-layout mapas-layout">
      <section className="tarjeta entrenamiento-seccion">
        <h2><FileText size={21}/> CSV de lecturas</h2>
        <p>Elige un CSV con las lecturas mezcladas de hasta 10 jugadores por sesión del Gateway. Se conservarán todas sus filas y columnas, incluidos los duplicados.</p>
        <label className="entrenamiento-campo">Archivo de entrada (.csv)<input value={entrada} disabled={bloqueado} placeholder="Selecciona un CSV de lecturas" onChange={e => setEntrada(e.target.value)}/></label>
        {selectorLocal ? <button className="boton secundario" disabled={bloqueado} onClick={() => void seleccionarEntrada()}><FolderOpen size={18}/> Seleccionar CSV</button> : <button className="boton secundario" disabled={bloqueado} onClick={() => setExplorador("entrada")}><FolderOpen size={18}/> Explorar CSV</button>}
        <p>La identidad se determina con la sesión del Gateway y el ID del jugador. Cada CSV resultante se ordena por sesión del jugador, secuencia y torre.</p>
      </section>
      <section className="tarjeta entrenamiento-seccion">
        <h2><UsersRound size={21}/> Separar jugadores</h2>
        <label className="entrenamiento-campo">Nombre base de los archivos<input value={nombre} maxLength={80} disabled={bloqueado} onChange={e => setNombre(e.target.value)}/></label>
        <label className="entrenamiento-campo">Carpeta de salida en la PC del backend<input value={directorioSalida} disabled={bloqueado} placeholder="Selecciona una carpeta autorizada" onChange={e => setDirectorioSalida(e.target.value)}/></label>
        {selectorLocal ? <button className="boton secundario" disabled={bloqueado} onClick={() => void seleccionarSalida()}><FolderOpen size={18}/> Explorar carpetas</button> : <button className="boton secundario" disabled={bloqueado} onClick={() => setExplorador("salida")}><FolderOpen size={18}/> Explorar carpetas</button>}
        <p>Obtendrás un CSV por jugador y resúmenes de recepción en CSV y JSON. No necesitas un modelo y no se generan mapas.</p>
        {!nombreValido && <p className="entrenamiento-error">Usa un nombre de 1 a 80 caracteres: letras, números, espacios, guiones o guiones bajos.</p>}
        <button className="boton primario" disabled={bloqueado || !!id || !entrada.trim().toLowerCase().endsWith(".csv") || !directorioSalida.trim() || !nombreValido} onClick={() => void separar()}>{bloqueado ? <LoaderCircle className="preparacion-girando" size={19}/> : <UsersRound size={19}/>} {ocupacion === "iniciando" ? "Iniciando…" : "Separar CSV por jugador"}</button>
        {enCurso && <div className="mapas-progreso" role="status"><p>Jugadores separados: {trabajo?.jugadoresProcesados ?? 0} · Archivo procesado: {trabajo?.procesados ?? 0} de 1</p><progress value={trabajo?.procesados ?? 0} max={1}/><small>Puedes cambiar de sección o recargar; el proceso continúa en la PC.</small></div>}
        {error && <p className="entrenamiento-error" role="alert">{error}</p>}
        {errorEstado && <p className="entrenamiento-error" role="alert">{errorEstado}</p>}
        {trabajo?.estado === "error" && <p className="entrenamiento-error" role="alert">{trabajo.error}</p>}
        {trabajo?.estado === "completado" && <p className="mapas-exito" role="status"><CheckCircle2 size={18}/> {trabajo.jugadoresProcesados} CSV de jugadores guardados.</p>}
        {id && (!enCurso || !!errorEstado) && <button className="boton secundario" onClick={nuevaSeparacion}>Nueva separación</button>}
      </section>
    </div>
    {trabajo?.jugadores.length ? <section className="tarjeta mapas-resumen" aria-label="Resultados por jugador">
      <h2>Resultados por jugador</h2>
      <p>Recepción = paquetes únicos / (secuencias esperadas × 4). Los rangos se calculan por sesión entre la primera y última secuencia observadas.</p>
      <div className="mapas-tabla" role="region" aria-label="Estadísticas de recepción por jugador" tabIndex={0}><table><thead><tr><th>Jugador</th><th>Total recibido</th><th>Únicos / esperados</th><th>Recepción</th><th>Vectores completos</th><th>% completos</th><th>Incompletos</th><th>Secuencias ausentes</th><th>Duplicados</th><th>CSV</th></tr></thead><tbody>{trabajo.jugadores.map(jugador => <tr key={jugador.indice}><th scope="row">{jugador.jugadorId == null ? "Sin identificar" : `Jugador ${jugador.jugadorId}`} · Gateway {jugador.sesionGateway ?? "sin identificar"}</th><td>{jugador.estadisticas.total_recibido}</td><td>{jugador.estadisticas.paquetes_unicos_recibidos ?? "—"} / {jugador.estadisticas.paquetes_esperados ?? "—"}</td><td>{porcentaje(jugador.estadisticas.recepcion_porcentaje)}</td><td>{jugador.estadisticas.vectores_completos ?? "—"}</td><td>{porcentaje(jugador.estadisticas.vectores_completos_porcentaje)}</td><td>{jugador.estadisticas.vectores_incompletos ?? "—"}</td><td>{jugador.estadisticas.secuencias_ausentes ?? "—"}</td><td>{jugador.estadisticas.duplicados ?? "—"}</td><td><a href={jugador.descarga} aria-label={`Descargar lecturas de ${nombreArchivo(jugador.rutaLecturas)}`}><Download size={16}/> Descargar</a></td></tr>)}</tbody></table></div>
      <p>Los CSV preparados no permiten reconstruir paquetes originales; esas métricas aparecen como no disponibles.</p>
      <div className="entrenamiento-acciones">{trabajo.resumenGeneralCsv && <a className="boton secundario" href={trabajo.resumenGeneralCsv}><Download size={17}/> Resumen general CSV</a>}{trabajo.resumenGeneralJson && <a href={trabajo.resumenGeneralJson}>Resumen general JSON</a>}</div>
    </section> : null}
    {explorador && <ExploradorAutorizado tipo={explorador === "entrada" ? "csv" : "carpeta"} onCerrar={() => setExplorador(null)} onElegir={ruta => { if (explorador === "entrada") setEntrada(ruta); else setDirectorioSalida(ruta); setExplorador(null); }}/>} 
  </div>;
}

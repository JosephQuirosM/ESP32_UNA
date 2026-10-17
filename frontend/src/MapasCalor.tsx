import { useEffect, useState } from "react";
import { CheckCircle2, Download, FileText, FolderOpen, Image, LoaderCircle, Plus, SlidersHorizontal, Thermometer, Trash2 } from "lucide-react";

type Mapa = { indice: number; entrada: string; nombre: string; vectores: number; ventana: number; rutaImagen: string; imagen: string; descarga: string; predicciones: string; resumenDescarga: string; conteos: Record<string,number> };
type Trabajo = { id: string; estado: "pendiente"|"generando"|"completado"|"error"; error?: string; entradas?: string[]; modelo?: string; nombre?: string; directorioSalida?: string; ventana?: number; procesados: number; total: number; mapas: Mapa[] };
const archivoNombre = (ruta: string) => ruta.split(/[\\/]/).pop() ?? ruta;
async function pedir(ruta: string, carga?: unknown) {
  const res = await fetch(`/api/mapas${ruta}`, carga===undefined ? undefined : {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(carga)});
  const datos=await res.json();
  if(!res.ok)throw new Error(datos.error??"No se pudo completar la operación.");
  return datos;
}
function ultimo() {try{return localStorage.getItem("esp32.mapas.actual");}catch{return null;}}

export default function MapasCalor() {
  const [entradas,setEntradas]=useState<string[]>([]);
  const [rutaCsv,setRutaCsv]=useState("");
  const [modelo,setModelo]=useState("");
  const [nombre,setNombre]=useState("mapa_calor");
  const [directorioSalida,setDirectorioSalida]=useState("");
  const [ventana,setVentana]=useState("5");
  const [ocupacion,setOcupacion]=useState("");
  const [error,setError]=useState("");
  const [errorEstado,setErrorEstado]=useState("");
  const [id,setId]=useState<string|null>(ultimo);
  const [trabajo,setTrabajo]=useState<Trabajo|null>(null);
  const enCurso=!!id&&(!trabajo||["pendiente","generando"].includes(trabajo.estado));
  const bloqueado=!!ocupacion||enCurso;
  const ventanaValida=/^\d+$/.test(ventana)&&Number(ventana)>=1&&Number(ventana)<=1000;
  const nombreValido=/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,79}$/u.test(nombre);
  const mensaje=(e:unknown)=>e instanceof TypeError?"No se pudo conectar con el servidor local.":e instanceof Error?e.message:"No se pudo completar la operación.";
  useEffect(()=>{
    if(!id)return;
    let activo=true,restaurado=false;
    let timer:ReturnType<typeof setTimeout>;
    async function actualizar(){
      try{
        const datos=await pedir(`/${id}`) as Trabajo;
        if(!activo)return;
        setTrabajo(datos);setErrorEstado("");
        if(!restaurado&&datos.entradas){
          restaurado=true;setEntradas(datos.entradas);setModelo(datos.modelo??"");setNombre(datos.nombre??"mapa_calor");setDirectorioSalida(datos.directorioSalida??"");setVentana(String(datos.ventana??5));
        }
        if(["completado","error"].includes(datos.estado))return;
      }catch(e){if(activo)setErrorEstado(mensaje(e));}
      if(activo)timer=setTimeout(actualizar,1500);
    }
    void actualizar();
    return()=>{activo=false;clearTimeout(timer);};
  },[id]);
  function agregar(rutas:string[]){
    const nuevas=[...new Set([...entradas,...rutas.map(r=>r.trim()).filter(Boolean)])];
    if(nuevas.some(r=>!r.toLowerCase().endsWith(".csv"))){setError("Selecciona archivos con extensión .csv.");return;}
    if(nuevas.length>50){setError("Puedes generar hasta 50 mapas por solicitud.");return;}
    setEntradas(nuevas);setRutaCsv("");setError("");
  }
  async function seleccionar(tipo:"csv"|"joblib"){
    setOcupacion(tipo);setError("");
    try{const datos=await pedir("/seleccionar",{tipo});if(tipo==="csv")agregar(datos.archivos);else if(datos.archivos.length)setModelo(datos.archivos[0]);}
    catch(e){setError(mensaje(e));}finally{setOcupacion("");}
  }
  async function carpeta(){
    setOcupacion("carpeta");setError("");
    try{
      const res=await fetch("/api/preparacion/seleccionar-carpeta",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ruta:directorioSalida})});
      const datos=await res.json();if(!res.ok)throw new Error(datos.error);if(datos.ruta)setDirectorioSalida(datos.ruta);
    }catch(e){setError(mensaje(e));}finally{setOcupacion("");}
  }
  async function generar(){
    setOcupacion("iniciando");setError("");
    try{
      const nuevo=await pedir("",{entradas,modelo,nombre,directorioSalida,ventana:Number(ventana)}) as Trabajo;
      setTrabajo(nuevo);setId(nuevo.id);
      try{localStorage.setItem("esp32.mapas.actual",nuevo.id);}catch{/* La generación continúa sin persistencia local. */}
    }catch(e){setError(mensaje(e));}finally{setOcupacion("");}
  }
  return <section className="mapas" aria-label="Generación de mapas de calor">
    <div className="entrenamiento-layout mapas-layout">
      <div className="entrenamiento-columna">
        <section className="tarjeta entrenamiento-seccion">
          <h2><FileText size={21}/> 1. Archivos de lecturas</h2>
          <p>Selecciona uno o varios CSV de esta PC. Se generará una imagen por archivo, con lecturas crudas del gateway o vectores ya preparados.</p>
          <div className="entrenamiento-acciones"><button className="boton secundario" disabled={bloqueado} onClick={()=>void seleccionar("csv")}><FolderOpen size={18}/> Seleccionar CSV</button><button className="boton mapas-limpiar" disabled={bloqueado||!entradas.length} onClick={()=>setEntradas([])}><Trash2 size={17}/> Limpiar selección</button></div>
          <div className="mapas-ruta-manual"><label className="entrenamiento-campo">Añadir CSV por ruta<input value={rutaCsv} disabled={bloqueado} placeholder="Ruta al archivo de lecturas.csv" onChange={e=>setRutaCsv(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!bloqueado&&rutaCsv.trim()){e.preventDefault();agregar([rutaCsv]);}}}/></label><button className="boton secundario" disabled={bloqueado||!rutaCsv.trim()} onClick={()=>agregar([rutaCsv])}><Plus size={17}/> Añadir</button></div>
          {entradas.length ? <><p className="mapas-cantidad" aria-live="polite">{entradas.length} CSV seleccionados</p><div className="mapas-archivos" role="region" aria-label="CSV seleccionados" tabIndex={0}>{entradas.map(ruta=><article className="mapas-archivo" key={ruta}><strong>.CSV</strong><div><span>{archivoNombre(ruta)}</span><small title={ruta}>{ruta}</small></div><button className="preparacion-eliminar" disabled={bloqueado} aria-label={`Eliminar ${archivoNombre(ruta)}`} onClick={()=>setEntradas(lista=>lista.filter(r=>r!==ruta))}>Eliminar</button></article>)}</div></> : <div className="mapas-vacio"><FileText size={29}/><p>Añade tus CSV para comenzar.</p></div>}
        </section>
        <section className="tarjeta entrenamiento-seccion">
          <h2><SlidersHorizontal size={21}/> 2. Modelo y suavizado</h2>
          <label className="entrenamiento-campo">Modelo entrenado (.joblib)<input value={modelo} disabled={bloqueado} placeholder="Ruta al modelo .joblib" onChange={e=>setModelo(e.target.value)}/></label>
          <button className="boton secundario mapas-seleccionar-modelo" disabled={bloqueado} onClick={()=>void seleccionar("joblib")}><FolderOpen size={18}/> Seleccionar modelo</button>
          <label className="entrenamiento-campo">Ventana de suavizado<input type="number" min="1" max="1000" step="1" value={ventana} disabled={bloqueado} onChange={e=>setVentana(e.target.value)}/><small>1 = sin suavizado. 5 = mayoría de las últimas cinco predicciones. Se aplica por separado en cada archivo y jugador.</small></label>
          <p>Una ventana mayor reduce los saltos aislados, pero puede retrasar la detección de cambios de zona. No modifica el modelo ni las lecturas.</p>
          <p>Cuadrícula actual: 3 × 3, zonas 1 a 9. No se eliminan registros iniciales ni segundos de captura.</p>
        </section>
      </div>
      <aside className="tarjeta entrenamiento-seccion">
        <h2><Thermometer size={21}/> 3. Generar imágenes</h2>
        <label className="entrenamiento-campo">Nombre de los mapas<input value={nombre} maxLength={80} disabled={bloqueado} onChange={e=>setNombre(e.target.value)}/><small>Si eliges varios CSV, se añade un número y su nombre a cada imagen.</small></label>
        <label className="entrenamiento-campo" htmlFor="mapas-destino">Carpeta de salida en esta PC</label>
        <div className="preparacion-elegir-ruta"><input id="mapas-destino" value={directorioSalida} disabled={bloqueado} placeholder="Por defecto: data/processed/mapas/" onChange={e=>setDirectorioSalida(e.target.value)}/><button className="boton secundario" disabled={bloqueado} onClick={carpeta}><FolderOpen size={18}/> Explorar</button></div>
        <p>Se guardará cada mapa en PNG junto con sus predicciones y un resumen. Si el nombre ya existe, se añade un número.</p>
        {(!ventanaValida||!nombreValido)&&<p className="entrenamiento-error">Revisa el nombre y la ventana de suavizado (entero de 1 a 1000).</p>}
        <button className="boton primario" disabled={bloqueado||!entradas.length||!modelo.trim().toLowerCase().endsWith(".joblib")||!ventanaValida||!nombreValido} onClick={generar}>{bloqueado?<LoaderCircle className="preparacion-girando" size={19}/>:<Image size={19}/>} {enCurso?"Generando mapas…":ocupacion==="iniciando"?"Iniciando…":ocupacion?"Seleccionando…":"Generar mapa de calor"}</button>
        {ocupacion&&ocupacion!=="iniciando"&&<p role="status">Completa la selección en el gestor de archivos del sistema operativo.</p>}
        {enCurso&&<div className="mapas-progreso" role="status"><p>Mapas generados: {trabajo?.procesados??0} de {trabajo?.total??entradas.length}</p><progress value={trabajo?.procesados??0} max={trabajo?.total||entradas.length||1}/><small>Puedes cambiar de módulo; Python continúa en esta PC.</small></div>}
        {error&&<p className="entrenamiento-error" role="alert">{error}</p>}
        {errorEstado&&<p className="entrenamiento-error" role="alert">{errorEstado}</p>}
        {trabajo?.estado==="error"&&<p className="entrenamiento-error" role="alert">{trabajo.error}</p>}
        {trabajo?.estado==="completado"&&<p className="mapas-exito" role="status"><CheckCircle2 size={18}/> {trabajo.procesados} mapas generados y guardados.</p>}
        {id&&(!enCurso||!!errorEstado)&&<button className="boton secundario" onClick={()=>{setId(null);setTrabajo(null);setErrorEstado("");try{localStorage.removeItem("esp32.mapas.actual");}catch{/* Sin persistencia local. */}}}>Nueva generación</button>}
      </aside>
    </div>
    <section className="mapas-resultados" aria-label="Mapas generados">
      <h2><Image size={22}/> Mapas generados</h2>
      <p>El número es la cantidad de vectores asignados a cada zona; el porcentaje es su proporción del total. No representan precisión ni confianza del modelo.</p>
      {!trabajo?.mapas.length?<div className="tarjeta mapas-vacio"><Thermometer size={34}/><p>Los mapas de Python aparecerán aquí al generarlos.</p></div>:<div className="mapas-galeria">{trabajo.mapas.map(mapa=><article className="tarjeta mapas-imagen" key={mapa.indice}><h3>{archivoNombre(mapa.entrada)}</h3><p>{mapa.vectores} vectores completos · {mapa.ventana===1?"Sin suavizado":`Suavizado: ${mapa.ventana} predicciones`}</p><a href={mapa.imagen} target="_blank" rel="noreferrer" aria-label={`Ampliar mapa de ${archivoNombre(mapa.entrada)}`}><img src={mapa.imagen} alt={`Mapa de calor de ${archivoNombre(mapa.entrada)}`}/></a><p className="mapas-ruta-resultado">Guardado en: <strong>{mapa.rutaImagen}</strong></p><div className="entrenamiento-acciones"><a className="boton primario" href={mapa.descarga}><Download size={17}/> Descargar PNG</a><a className="boton secundario" href={mapa.predicciones}>Predicciones CSV</a><a href={mapa.resumenDescarga}>Resumen JSON</a></div></article>)}</div>}
    </section>
  </section>;
}

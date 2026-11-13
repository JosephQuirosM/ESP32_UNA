import { useEffect, useState } from "react";
import { FolderOpen, ShieldCheck, Trash2 } from "lucide-react";
import ExploradorAutorizado from "./ExploradorAutorizado";

type Raiz = { id: string; ruta: string; nombre: string };
export default function CarpetasAutorizadas() {
  const [token, setToken] = useState("");
  const [raices, setRaices] = useState<Raiz[]>([]);
  const [ruta, setRuta] = useState("");
  const [error, setError] = useState("");
  const [local, setLocal] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [exploradorAbierto, setExploradorAbierto] = useState(false);
  useEffect(() => {
    let vigente = true;
    void fetch("/api/admin/sesion").then(async r => {
      if (r.status === 403) {
        const raicesRespuesta = await fetch("/api/archivos/raices");
        if (!raicesRespuesta.ok) throw new Error("No se pudieron leer las carpetas autorizadas.");
        const disponibles = await raicesRespuesta.json() as Raiz[];
        if (vigente) setRaices(disponibles);
        return;
      }
      if (!r.ok) throw new Error("No se pudo abrir la configuración de carpetas.");
      const datos = await r.json() as { token: string; codigoAcceso: string | null; raices: Raiz[] };
      if (vigente) { setToken(datos.token); setCodigo(datos.codigoAcceso ?? ""); setRaices(datos.raices); setLocal(true); }
    }).catch(e => { if (vigente) setError(e instanceof Error ? e.message : "No se pudo abrir la configuración."); });
    return () => { vigente = false; };
  }, []);
  async function pedir(url: string, metodo: string, body?: object) {
    const res = await fetch(url, { method: metodo, headers: { "X-Heatmap-Admin": token, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const datos = res.status === 204 ? null : await res.json();
    if (!res.ok) throw new Error(datos?.error ?? "No se pudo guardar el cambio.");
    return datos;
  }
  async function elegir() {
    setOcupado(true); setError("");
    try { const datos = await pedir("/api/admin/seleccionar-carpeta", "POST") as { ruta: string | null }; if (datos.ruta) setRuta(datos.ruta); }
    catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  }
  async function agregar() {
    setOcupado(true); setError("");
    try { const nueva = await pedir("/api/admin/raices", "POST", { ruta }) as Raiz; setRaices(actual => [...actual, nueva]); setRuta(""); }
    catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  }
  async function quitar(id: string) {
    setOcupado(true); setError("");
    try { await pedir(`/api/admin/raices/${id}`, "DELETE"); setRaices(actual => actual.filter(r => r.id !== id)); }
    catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  }
  return <section className="tarjeta carpetas-autorizadas">
    <h2><ShieldCheck size={22}/> Carpetas de trabajo</h2>
    <p>Los dispositivos que ingresen con el código pueden usar archivos y subcarpetas dentro de estas carpetas. La PC anfitriona decide qué raíces están autorizadas.</p>
    {local && <>
      {codigo && <p className="codigo-acceso">Código para otros dispositivos: <strong>{codigo}</strong><br/><small>Se renueva al reiniciar el backend. Compártelo sólo con quienes usarán el panel.</small></p>}
      <div className="preparacion-elegir-ruta"><input value={ruta} placeholder="Ruta absoluta de una carpeta de esta PC" onChange={e => setRuta(e.target.value)} disabled={ocupado}/><button className="boton secundario" onClick={() => void elegir()} disabled={ocupado}><FolderOpen size={18}/> Explorar</button><button className="boton primario" onClick={() => void agregar()} disabled={ocupado || !ruta.trim()}>Autorizar</button></div>
      <div className="carpetas-lista">{raices.map(r => <article key={r.id}><div><strong>{r.nombre}</strong><small>{r.ruta}</small></div><button className="boton secundario" onClick={() => void quitar(r.id)} disabled={ocupado} aria-label={`Quitar ${r.nombre}`}><Trash2 size={17}/> Quitar</button></article>)}{!raices.length && <p>Aún no hay carpetas autorizadas. Selecciona una para empezar.</p>}</div>
    </>}
    {!local && <div className="carpetas-lista">{raices.map(r => <article key={r.id}><div><strong>{r.nombre}</strong><small>{r.ruta}</small></div></article>)}{!raices.length && <p>Aún no hay carpetas autorizadas. La PC anfitriona debe agregar una.</p>}</div>}
    {!!raices.length && <button className="boton secundario" onClick={() => setExploradorAbierto(true)}><FolderOpen size={18}/> Explorar archivos y crear carpetas</button>}
    {error && <p className="entrenamiento-error" role="alert">{error}</p>}
    {exploradorAbierto && <ExploradorAutorizado tipo="todos" onCerrar={() => setExploradorAbierto(false)} onElegir={ruta => { window.location.href = `/api/archivos/descargar?ruta=${encodeURIComponent(ruta)}`; }}/>}
  </section>;
}

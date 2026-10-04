import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowRight,
  Check,
  Clock3,
  FileText,
  Grid3X3,
  Info,
  RefreshCw,
  SkipForward,
  Square,
} from "lucide-react";
import {
  api,
  ErrorApi,
  capturaActiva,
  type Captura,
  type EstadoServidor,
  type SolicitudLectura,
} from "./api";
import { dimensionValida, generarZonas, MAXIMO_DIMENSION } from "./cuadricula";
import Cuadricula from "./Cuadricula";
import { crearSolicitudId } from "./solicitudId";

type Fase =
  | "configuracion"
  | "esperando"
  | "captura"
  | "completada"
  | "detenida"
  | "error";
interface Sesion {
  modo: "manual" | "guiado";
  nombre: string;
  duracion: string;
  filas: string;
  columnas: string;
  zonas: number[];
  indice: number;
  completas: number[];
  omitidas: number[];
  fase: Fase;
  solicitud: SolicitudLectura | null;
  captura: Captura | null;
}
const CLAVE = "esp32.lecturas.v1";
const inicial: Sesion = {
  modo: "guiado",
  nombre: "",
  duracion: "60",
  filas: "3",
  columnas: "3",
  zonas: generarZonas(3, 3),
  indice: 0,
  completas: [],
  omitidas: [],
  fase: "configuracion",
  solicitud: null,
  captura: null,
};

/** Recupera el recorrido local; el resultado de la captura se consulta siempre al backend. */
function recuperar(): Sesion {
  try {
    const valor = JSON.parse(
      localStorage.getItem(CLAVE) ?? "null",
    ) as Sesion | null;
    if (
      !valor ||
      !["manual", "guiado"].includes(valor.modo) ||
      ![
        "configuracion",
        "esperando",
        "captura",
        "completada",
        "detenida",
        "error",
      ].includes(valor.fase) ||
      !dimensionValida(Number(valor.filas)) ||
      !dimensionValida(Number(valor.columnas)) ||
      !Array.isArray(valor.zonas) ||
      valor.zonas.length !== Number(valor.filas) * Number(valor.columnas) ||
      new Set(valor.zonas).size !== valor.zonas.length ||
      valor.zonas.some(
        (zona) =>
          !Number.isInteger(zona) || zona < 1 || zona > valor.zonas.length,
      ) ||
      !Number.isInteger(valor.indice) ||
      valor.indice < 0 ||
      valor.indice >= valor.zonas.length ||
      typeof valor.nombre !== "string" ||
      typeof valor.duracion !== "string" ||
      !Array.isArray(valor.completas) ||
      !Array.isArray(valor.omitidas)
    )
      return inicial;
    // Recupera un inicio que falló antes de crear y enviar su identificador.
    if (valor.fase === "captura" && !valor.solicitud && !valor.captura)
      return { ...valor, fase: valor.modo === "guiado" ? "esperando" : "configuracion" };
    return valor;
  } catch {
    return inicial;
  }
}
function formatoTiempo(segundos: number) {
  const total = Math.max(0, Math.ceil(segundos));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
const ETIQUETAS: Record<Captura["estado"], string> = {
  iniciando: "INICIANDO",
  grabando: "GRABANDO",
  cerrando: "CERRANDO CSV",
  completada: "COMPLETADA",
  detenida: "DETENIDA",
  error: "ERROR",
};

/** Envía una instrucción por archivo y deja el tiempo y la escritura a Python. */
export default function Lecturas({
  servidor,
  conectado,
}: {
  servidor: EstadoServidor | null;
  conectado: boolean;
}) {
  const [sesion, setSesion] = useState<Sesion>(recuperar);
  const sesionRef = useRef(sesion);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const ocupadoRef = useRef(false);
  const [sinCrear, setSinCrear] = useState(false);
  const [conexionCaptura, setConexionCaptura] = useState(true);
  const [ahora, setAhora] = useState(Date.now());
  const filas = Number(sesion.filas),
    columnas = Number(sesion.columnas);
  const dimensionesValidas =
    dimensionValida(filas) && dimensionValida(columnas);
  const total = sesion.zonas.length,
    zona = sesion.indice + 1,
    segundos = Number(sesion.duracion);
  const otraActiva =
    capturaActiva(servidor?.actual ?? null) &&
    servidor?.actual?.solicitudId !== sesion.solicitud?.solicitudId;

  /** Persiste la instrucción antes de enviarla, para poder recuperar una respuesta perdida. */
  function actualizar(cambio: Partial<Sesion> | ((previa: Sesion) => Sesion)) {
    const siguiente =
      typeof cambio === "function"
        ? cambio(sesionRef.current)
        : { ...sesionRef.current, ...cambio };
    sesionRef.current = siguiente;
    try {
      localStorage.setItem(CLAVE, JSON.stringify(siguiente));
    } catch {
      setError(
        "El navegador no pudo conservar el recorrido. Evita recargar hasta terminar; los CSV permanecen en el backend.",
      );
    }
    setSesion(siguiente);
  }

  function recibir(captura: Captura) {
    const previa = sesionRef.current;
    if (captura.solicitudId !== previa.solicitud?.solicitudId) return;
    setSinCrear(false);
    setConexionCaptura(true);
    if (capturaActiva(captura)) {
      actualizar({ captura });
      return;
    }
    if (captura.estado === "completada" && previa.modo === "guiado") {
      actualizar({
        ...previa,
        captura,
        solicitud: null,
        completas: [...previa.completas, previa.indice + 1],
        indice: Math.min(previa.indice + 1, previa.zonas.length - 1),
        fase:
          previa.indice + 1 < previa.zonas.length ? "esperando" : "completada",
      });
    } else {
      actualizar({
        captura,
        solicitud: null,
        fase:
          captura.estado === "completada"
            ? "completada"
            : captura.estado === "detenida"
              ? "detenida"
              : "error",
      });
      if (captura.error) setError(captura.error);
    }
  }

  // Una recarga recupera la misma solicitud y nunca crea otra automáticamente.
  useEffect(() => {
    let vigente = true;
    let intervalo: ReturnType<typeof setTimeout>;
    const consultar = async () => {
      const solicitud = sesionRef.current.solicitud;
      if (solicitud) {
        try {
          const captura = await api.solicitud(solicitud.solicitudId);
          if (vigente) recibir(captura);
        } catch (error) {
          if (vigente) {
            setConexionCaptura(
              !(error instanceof ErrorApi) || error.codigo !== 0,
            );
            if (error instanceof ErrorApi && error.codigo === 404)
              setSinCrear(true);
          }
        }
      }
      if (vigente) intervalo = setTimeout(consultar, 1000);
    };
    void consultar();
    return () => {
      vigente = false;
      clearTimeout(intervalo);
    };
    // El ciclo lee la sesión actual de una referencia para no duplicar peticiones.
  }, []);
  useEffect(() => {
    const reloj = setInterval(() => setAhora(Date.now()), 200);
    return () => clearInterval(reloj);
  }, []);

  /** Reenvía exactamente la misma solicitud cuando su respuesta se perdió. */
  async function enviar(solicitud: SolicitudLectura) {
    if (ocupadoRef.current) return;
    ocupadoRef.current = true;
    setOcupado(true);
    setError("");
    setSinCrear(false);
    try {
      recibir(await api.iniciar(solicitud));
    } catch (error) {
      setError((error as Error).message);
      if (error instanceof ErrorApi && error.codigo !== 0)
        actualizar({ fase: "error", solicitud: null });
      else {
        setConexionCaptura(false);
        setSinCrear(true);
      }
    } finally {
      ocupadoRef.current = false;
      setOcupado(false);
    }
  }

  function iniciar(nombreArchivo?: string) {
    const previa = sesionRef.current;
    if (ocupadoRef.current || previa.solicitud) return;
    let solicitudId: string;
    try {
      solicitudId = crearSolicitudId();
    } catch (error) {
      setError((error as Error).message);
      actualizar({ fase: previa.modo === "guiado" ? "esperando" : "configuracion" });
      return;
    }
    const solicitud: SolicitudLectura = {
      solicitudId,
      nombreArchivo:
        nombreArchivo ?? `${previa.nombre}_zona_${previa.indice + 1}`,
      duracionSegundos: Number(previa.duracion),
    };
    actualizar({ fase: "captura", solicitud, captura: null });
    void enviar(solicitud);
  }

  function preparar(evento: FormEvent) {
    evento.preventDefault();
    const nombre = sesion.nombre.trim().replace(/\.csv$/i, "");
    if (!nombre || nombre.length > 80 || !/^[\p{L}\p{N}_ -]+$/u.test(nombre)) {
      setError(
        "Escribe un nombre de hasta 80 caracteres con letras, números, espacios o guiones.",
      );
      return;
    }
    if (!Number.isInteger(segundos) || segundos < 1 || segundos > 86400) {
      setError("La duración debe estar entre 1 y 86400 segundos enteros.");
      return;
    }
    if (sesion.modo === "guiado" && !dimensionesValidas) {
      setError(
        `Filas y columnas deben ser enteros entre 1 y ${MAXIMO_DIMENSION}.`,
      );
      return;
    }
    setError("");
    actualizar({
      nombre,
      indice: 0,
      completas: [],
      omitidas: [],
      captura: null,
      solicitud: null,
      fase: sesion.modo === "guiado" ? "esperando" : "captura",
    });
    if (sesion.modo === "manual") iniciar(nombre);
  }

  function cambiarDimensiones(campo: "filas" | "columnas", valor: string) {
    const f = Number(campo === "filas" ? valor : sesion.filas),
      c = Number(campo === "columnas" ? valor : sesion.columnas);
    actualizar({
      [campo]: valor,
      ...(dimensionValida(f) && dimensionValida(c)
        ? { zonas: generarZonas(f, c) }
        : {}),
    });
  }
  function saltar() {
    if (sesion.fase !== "esperando" || sesion.solicitud) return;
    actualizar({
      omitidas: [...sesion.omitidas, zona],
      indice: Math.min(sesion.indice + 1, total - 1),
      fase: sesion.indice + 1 < total ? "esperando" : "completada",
    });
  }
  async function detener() {
    if (ocupadoRef.current) return;
    if (sesion.fase === "esperando") {
      actualizar({ fase: "detenida" });
      return;
    }
    if (!sesion.captura) {
      setError(
        "Espera a recuperar el identificador de la captura antes de detenerla.",
      );
      return;
    }
    ocupadoRef.current = true;
    setOcupado(true);
    try {
      recibir(await api.detener(sesion.captura.id));
      setError("");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      ocupadoRef.current = false;
      setOcupado(false);
    }
  }
  const captura = sesion.captura;
  const instanteReloj = captura?.finUtc ? Date.parse(captura.finUtc) : ahora;
  const restante = captura?.finPrevistoUtc
    ? Math.max(0, (Date.parse(captura.finPrevistoUtc) - instanteReloj) / 1000)
    : segundos;
  const vistaNombre = `${sesion.nombre.trim().replace(/\.csv$/i, "") || "nombre"}${sesion.modo === "guiado" ? "_zona_1" : ""}_DD_MM_YY_HH_MM.csv`;
  const fasesActivas = sesion.fase === "esperando" || sesion.fase === "captura";

  return (
    <>
      {!conectado && (
        <div className="aviso-demo" role="status">
          <Info size={19} />
          <span>
            Backend local sin conexión. Los archivos ya creados permanecen en
            esta PC; una captura activa termina por su propio tiempo.
          </span>
        </div>
      )}
      {otraActiva && (
        <div className="aviso-demo">
          <Info size={19} />
          <span>
            Hay otra captura activa:{" "}
            <strong>{servidor?.actual?.archivo}</strong>. Espera su cierre para
            iniciar otro archivo. Puedes consultar su resultado en Datasets.
          </span>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {sesion.fase === "configuracion" ? (
        <div className="layout-captura">
          <section className="tarjeta configuracion">
            <h2>Configura tu recolección</h2>
            <p className="texto-suave">
              Cada captura crea un CSV independiente en esta PC.
            </p>
            <div
              className="selector-modo"
              role="group"
              aria-label="Modo de recolección"
            >
              <button
                aria-pressed={sesion.modo === "guiado"}
                className={sesion.modo === "guiado" ? "activo" : ""}
                onClick={() => actualizar({ modo: "guiado" })}
              >
                <Grid3X3 size={19} />
                Guiado
              </button>
              <button
                aria-pressed={sesion.modo === "manual"}
                className={sesion.modo === "manual" ? "activo" : ""}
                onClick={() => actualizar({ modo: "manual" })}
              >
                <Clock3 size={19} />
                Manual
              </button>
            </div>
            <p className="descripcion-modo">
              {sesion.modo === "guiado"
                ? `Recorre ${total} zonas. Confirma tu posición o salta cada zona antes de grabar.`
                : "Escribe un nombre, elige una duración y comienza la captura."}
            </p>
            <form onSubmit={preparar} noValidate>
              {sesion.modo === "guiado" && (
                <fieldset className="dimensiones">
                  <legend>Tamaño de la cuadrícula</legend>
                  <div className="campos-dimensiones">
                    <div>
                      <label htmlFor="filas">Filas</label>
                      <input
                        id="filas"
                        type="number"
                        min="1"
                        max={MAXIMO_DIMENSION}
                        step="1"
                        value={sesion.filas}
                        onChange={(evento) =>
                          cambiarDimensiones("filas", evento.target.value)
                        }
                      />
                    </div>
                    <span aria-hidden="true">×</span>
                    <div>
                      <label htmlFor="columnas">Columnas</label>
                      <input
                        id="columnas"
                        type="number"
                        min="1"
                        max={MAXIMO_DIMENSION}
                        step="1"
                        value={sesion.columnas}
                        onChange={(evento) =>
                          cambiarDimensiones("columnas", evento.target.value)
                        }
                      />
                    </div>
                  </div>
                  <small>
                    De 1 a {MAXIMO_DIMENSION} por lado. Cambiar el tamaño
                    restablece las posiciones.
                  </small>
                  {!dimensionesValidas && (
                    <p className="error">Introduce filas y columnas válidas.</p>
                  )}
                </fieldset>
              )}
              <label htmlFor="nombre">Nombre del archivo</label>
              <input
                id="nombre"
                value={sesion.nombre}
                maxLength={84}
                placeholder="Ej. laboratorio_piso2"
                onChange={(evento) =>
                  actualizar({ nombre: evento.target.value })
                }
              />
              <small>
                Letras, números, espacios y guiones. No escribas una ruta.
              </small>
              <label htmlFor="duracion">
                {sesion.modo === "guiado" ? "Duración por zona" : "Duración"}
              </label>
              <div className="input-unidad">
                <input
                  id="duracion"
                  type="number"
                  min="1"
                  max="86400"
                  step="1"
                  value={sesion.duracion}
                  onChange={(evento) =>
                    actualizar({ duracion: evento.target.value })
                  }
                />
                <span>segundos</span>
              </div>
              <small>
                El receptor controla el tiempo aunque cierres el navegador.
              </small>
              <div className="vista-nombre">
                <FileText size={18} />
                <span>{vistaNombre}</span>
                <small>
                  Fecha y hora reales de inicio en Costa Rica, asignadas por el
                  backend.
                </small>
              </div>
              <button
                className="boton primario ancho"
                disabled={
                  ocupado ||
                  otraActiva ||
                  (sesion.modo === "manual" && !conectado)
                }
                type="submit"
              >
                {sesion.modo === "guiado"
                  ? "Preparar recorrido"
                  : "Iniciar captura"}
                <ArrowRight size={18} />
              </button>
            </form>
          </section>
          <section className="tarjeta preview">
            <div className="fila">
              <h2>
                {sesion.modo === "guiado"
                  ? `Tu recorrido ${sesion.filas}×${sesion.columnas}`
                  : "A tu propio ritmo"}
              </h2>
              <span className="badge">
                {sesion.modo === "guiado" ? `${total} ZONAS` : "MANUAL"}
              </span>
            </div>
            {sesion.modo === "guiado" ? (
              <>
                <Cuadricula
                  filas={dimensionValida(filas) ? filas : 3}
                  columnas={dimensionValida(columnas) ? columnas : 3}
                  zonas={sesion.zonas}
                  actual={1}
                  completas={[]}
                  ejecutando={false}
                  onReordenar={
                    dimensionesValidas
                      ? (zonas) => actualizar({ zonas })
                      : undefined
                  }
                />
                <p className="leyenda">
                  Orden del recorrido: zonas 1 a {total}. Mover los cuadrados
                  solo cambia su posición visual.
                </p>
                <div className="nota">
                  <Info size={18} />
                  <span>
                    Antes de cada zona puedes confirmar tu posición o saltarla
                    sin crear un CSV.
                  </span>
                </div>
              </>
            ) : (
              <div className="preview-manual">
                <span className="icono-redondo grande">
                  <Clock3 size={38} />
                </span>
                <strong>Modo Libre</strong>
                <p>
                  Una pantalla sencilla con el cronómetro y un botón para
                  detenerlo.
                </p>
                <span className="reloj-preview">
                  {formatoTiempo(Number.isFinite(segundos) ? segundos : 0)}
                </span>
              </div>
            )}
          </section>
        </div>
      ) : (
        <div
          className={`layout-captura ${sesion.modo === "manual" ? "solo-manual" : ""}`}
        >
          <section className="tarjeta consola">
            <div className="fila">
              <h2>
                {sesion.modo === "guiado"
                  ? `Zona ${zona} de ${total}`
                  : "Modo Libre"}
              </h2>
              <span className="badge">
                {sesion.fase === "esperando"
                  ? "EN ESPERA"
                  : sesion.fase === "captura"
                    ? captura
                      ? ETIQUETAS[captura.estado]
                      : "INICIO PENDIENTE"
                    : sesion.fase.toUpperCase()}
              </span>
            </div>
            <p className="nombre-sesion">{sesion.nombre}</p>
            <span className="icono-redondo">
              <Clock3 />
            </span>
            <div
              className="temporizador"
              role="timer"
              aria-label="Tiempo restante"
            >
              {formatoTiempo(
                sesion.fase === "esperando"
                  ? segundos
                  : sesion.fase === "completada"
                    ? 0
                    : restante,
              )}
            </div>
            <p className="texto-suave">
              {sesion.fase === "esperando"
                ? `Ubícate en la zona ${zona} para continuar.`
                : sesion.fase === "captura"
                  ? captura?.estado === "cerrando"
                    ? "Cerrando el CSV y conservando los registros aceptados…"
                    : "El tiempo y la escritura están controlados por Python."
                  : sesion.fase === "completada"
                    ? "Recorrido finalizado."
                    : sesion.fase === "error"
                      ? "La captura encontró un error. Revisa el resultado antes de continuar."
                      : "Recolección detenida. Los datos registrados se conservan."}
            </p>
            {sesion.fase === "captura" && captura?.inicioUtc && (
              <progress
                value={Math.max(0, segundos - restante)}
                max={segundos}
                aria-label="Progreso de captura"
              />
            )}
            {captura && (
              <div className="resumen-captura">
                <FileText size={18} />
                <strong>{captura.archivo}</strong>
                <span>{captura.filasEscritas} registros escritos</span>
                {!capturaActiva(captura) && captura.inicioUtc && (
                  <a
                    href={`/api/lecturas/${captura.id}/archivo`}
                    className="boton secundario"
                    download
                  >
                    Descargar CSV
                  </a>
                )}
              </div>
            )}
            {!conexionCaptura && (
              <p className="error">
                Sin conexión para consultar el estado. Python termina la captura
                por tiempo. Reconecta antes de iniciar otra.
              </p>
            )}
            <div className="acciones-consola">
              {sesion.fase === "esperando" && (
                <>
                  <button
                    className="boton primario ancho"
                    disabled={!conectado || ocupado || otraActiva}
                    onClick={() => iniciar()}
                  >
                    <Check size={18} />
                    Estoy en la zona {zona}, iniciar captura
                  </button>
                  <button className="boton secundario ancho" onClick={saltar}>
                    <SkipForward size={18} />
                    Saltar zona {zona}
                  </button>
                </>
              )}
              {sesion.fase === "captura" && sinCrear && sesion.solicitud && (
                <button
                  className="boton secundario ancho"
                  disabled={!conectado || ocupado || otraActiva}
                  onClick={() => void enviar(sesion.solicitud!)}
                >
                  <RefreshCw size={18} />
                  Reintentar inicio de esta captura
                </button>
              )}
              {fasesActivas ? (
                <button
                  className="boton peligro ancho"
                  disabled={
                    ocupado ||
                    (sesion.fase === "captura" &&
                      (!conectado || !captura || captura.estado === "cerrando"))
                  }
                  onClick={() => void detener()}
                >
                  <Square size={16} />
                  Detener
                </button>
              ) : (
                <button
                  className="boton primario ancho"
                  onClick={() => {
                    setError("");
                    actualizar({
                      fase: "configuracion",
                      solicitud: null,
                      captura: null,
                      indice: 0,
                      completas: [],
                      omitidas: [],
                    });
                  }}
                >
                  Nueva recolección
                  <ArrowRight size={18} />
                </button>
              )}
            </div>
          </section>
          {sesion.modo === "guiado" && (
            <section className="tarjeta preview">
              <div className="fila">
                <h2>Recorrido de recolección</h2>
                <span className="badge">
                  {sesion.completas.length} / {total} guardadas
                </span>
              </div>
              <Cuadricula
                filas={filas}
                columnas={columnas}
                zonas={sesion.zonas}
                actual={zona}
                completas={sesion.completas}
                omitidas={sesion.omitidas}
                ejecutando={
                  sesion.fase === "captura" && captura?.estado === "grabando"
                }
                onReordenar={(zonas) => actualizar({ zonas })}
              />
              <div className="leyenda-zonas">
                <span>
                  <i className="muestra actual" />
                  Zona actual
                </span>
                <span>
                  <i className="muestra completa" />
                  Guardada
                </span>
                <span>
                  <i className="muestra omitida" />
                  Omitida
                </span>
              </div>
              <p className="texto-suave">
                {sesion.omitidas.length} zonas omitidas. Cada zona grabada tiene
                su propio CSV.
              </p>
            </section>
          )}
        </div>
      )}
    </>
  );
}

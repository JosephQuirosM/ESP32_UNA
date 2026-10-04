import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Database,
  FileText,
  Filter,
  Grid3X3,
  Info,
  Layers,
  LockKeyhole,
  Menu,
  Radio,
  Settings2,
  ShieldCheck,
  Square,
  Thermometer,
  WifiOff,
  X,
} from "lucide-react";
import {
  DIMENSIONES_INICIALES,
  MAXIMO_DIMENSION,
  dimensionValida,
  generarZonas,
} from "./cuadricula";
import Cuadricula from "./Cuadricula";

type Pagina = "inicio" | "captura" | "gateway" | "datasets" | "ayuda";
type Modo = "manual" | "guiado";
type Fase =
  "configuracion" | "esperando" | "ejecutando" | "completada" | "detenida";
const NAVEGACION: { pagina: Pagina; titulo: string; icono: typeof Grid3X3 }[] =
  [
    { pagina: "inicio", titulo: "Inicio", icono: Layers },
    { pagina: "captura", titulo: "Recolección", icono: Grid3X3 },
    { pagina: "gateway", titulo: "Gateway", icono: Radio },
    { pagina: "datasets", titulo: "Datasets", icono: Database },
    { pagina: "ayuda", titulo: "Ayuda", icono: CircleHelp },
  ];
const MODULOS = [
  {
    titulo: "Preparación de Datos",
    texto:
      "Filtrado de ruido, normalización de lecturas RSSI y etiquetado para exportación.",
    detalle: "Técnicas en desarrollo:",
    etiquetas: ["Filtro Kalman", "Outliers IQR"],
    icono: Filter,
  },
  {
    titulo: "Entrenamiento de Modelos",
    texto:
      "Generación de clasificadores de posición usando los datasets recolectados.",
    detalle: "Algoritmos previstos:",
    etiquetas: ["k-NN Weighted", "Random Forest"],
    icono: Activity,
  },
  {
    titulo: "Mapas de Calor",
    texto:
      "Visualización 2D de cobertura de señal RSSI y estimación de ubicación sobre planos.",
    detalle: "Visualización prevista:",
    etiquetas: ["Mapa 2D", "Heatmap Canvas"],
    icono: Thermometer,
  },
];

/** Formatea el tiempo restante sin depender de una conexión externa. */
function formatoTiempo(segundos: number) {
  const total = Math.max(0, Math.ceil(segundos));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Panel exclusivamente visual: todos los flujos utilizan estado local. */
export default function App() {
  const [pagina, setPagina] = useState<Pagina>("inicio");
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [modo, setModo] = useState<Modo>("guiado");
  const [nombre, setNombre] = useState("");
  const [duracion, setDuracion] = useState("60");
  const [filasEntrada, setFilasEntrada] = useState("3");
  const [columnasEntrada, setColumnasEntrada] = useState("3");
  const [dimensiones, setDimensiones] = useState(DIMENSIONES_INICIALES);
  const [zonasVisuales, setZonasVisuales] = useState(() => generarZonas(3, 3));
  const totalZonas = dimensiones.filas * dimensiones.columnas;
  const dimensionesValidas =
    dimensionValida(Number(filasEntrada)) &&
    dimensionValida(Number(columnasEntrada));
  const [error, setError] = useState("");
  const [fase, setFase] = useState<Fase>("configuracion");
  const [indiceZona, setIndiceZona] = useState(0);
  const [zonasCompletadas, setZonasCompletadas] = useState<number[]>([]);
  const [restante, setRestante] = useState(60);
  const finRef = useRef(0);
  const principalRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLElement>(null);
  const botonMenuRef = useRef<HTMLButtonElement>(null);
  const segundos = Number(duracion);
  const zona = indiceZona + 1;
  const activa = fase === "esperando" || fase === "ejecutando";

  // El reloj usa una fecha límite para evitar acumular retrasos entre intervalos.
  useEffect(() => {
    if (fase !== "ejecutando") return;
    const actualizar = () => {
      const tiempo = Math.max(0, (finRef.current - Date.now()) / 1000);
      setRestante(tiempo);
      if (tiempo > 0) return;
      if (modo === "guiado") {
        setZonasCompletadas((previas) =>
          previas.includes(zona) ? previas : [...previas, zona],
        );
        if (indiceZona < totalZonas - 1) {
          setIndiceZona(indiceZona + 1);
          setFase("esperando");
        } else setFase("completada");
      } else setFase("completada");
    };
    actualizar();
    const intervalo = window.setInterval(actualizar, 100);
    return () => window.clearInterval(intervalo);
  }, [fase, modo, indiceZona, zona, totalZonas]);

  // El panel lateral conserva el foco y permite salir mediante Escape.
  useEffect(() => {
    if (!menuAbierto) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const teclado = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") setMenuAbierto(false);
      if (evento.key !== "Tab") return;
      const controles =
        menuRef.current?.querySelectorAll<HTMLButtonElement>("button");
      if (!controles?.length) return;
      const primero = controles[0],
        ultimo = controles[controles.length - 1];
      if (evento.shiftKey && document.activeElement === primero) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primero.focus();
      }
    };
    document.addEventListener("keydown", teclado);
    return () => {
      document.body.style.overflow = anterior;
      document.removeEventListener("keydown", teclado);
      botonMenuRef.current?.focus();
    };
  }, [menuAbierto]);

  /** Cambia de pantalla conservando la demostración activa. */
  function navegar(destino: Pagina) {
    setPagina(destino);
    setMenuAbierto(false);
    requestAnimationFrame(() => {
      principalRef.current?.focus();
      window.scrollTo({ top: 0 });
    });
  }

  /** Regenera la disposición solo cuando ambos campos contienen dimensiones válidas. */
  function cambiarDimensiones(campo: "filas" | "columnas", valor: string) {
    setError("");
    const filas = Number(campo === "filas" ? valor : filasEntrada);
    const columnas = Number(campo === "columnas" ? valor : columnasEntrada);
    if (campo === "filas") setFilasEntrada(valor);
    else setColumnasEntrada(valor);
    if (dimensionValida(filas) && dimensionValida(columnas)) {
      setDimensiones({ filas, columnas });
      setZonasVisuales(generarZonas(filas, columnas));
    }
  }

  /** Valida el formulario y prepara la demostración sin crear archivos. */
  function preparar(evento: FormEvent) {
    evento.preventDefault();
    if (modo === "guiado" && !dimensionesValidas) {
      setError(
        `Las filas y columnas deben ser números enteros entre 1 y ${MAXIMO_DIMENSION}.`,
      );
      return;
    }
    const limpio = nombre.trim().replace(/\.csv$/i, "");
    if (!limpio || !/^[\p{L}\p{N}_ -]+$/u.test(limpio) || limpio.length > 80) {
      setError(
        "Escribe un nombre de hasta 80 caracteres, usando letras, números, espacios, guiones o guiones bajos.",
      );
      return;
    }
    if (!Number.isInteger(segundos) || segundos < 1 || segundos > 86400) {
      setError(
        "La duración debe ser un número entero entre 1 y 86400 segundos.",
      );
      return;
    }
    setNombre(limpio);
    setError("");
    setIndiceZona(0);
    setZonasCompletadas([]);
    setRestante(segundos);
    if (modo === "guiado") setFase("esperando");
    else iniciarTiempo();
  }

  /** Inicia únicamente el temporizador local de la interfaz. */
  function iniciarTiempo() {
    finRef.current = Date.now() + segundos * 1000;
    setRestante(segundos);
    setFase("ejecutando");
  }

  function nuevaDemostracion() {
    setFase("configuracion");
    setIndiceZona(0);
    setZonasCompletadas([]);
    setError("");
  }

  const pasos = [
    {
      titulo: "Configura nombre y tiempo",
      texto:
        "Elige un nombre para el archivo y la duración deseada. Usa el modo guiado o el modo manual.",
      icono: Settings2,
    },
    {
      titulo: "Recorre las zonas marcadas",
      texto:
        "En modo guiado, sigue la cuadrícula y confirma cuando estés en la siguiente zona.",
      icono: Grid3X3,
    },
    {
      titulo: "Conoce el flujo de trabajo",
      texto:
        "Explora los controles de la interfaz. En esta demostración no se reciben ni guardan datos.",
      icono: ShieldCheck,
    },
  ];

  return (
    <>
      <a className="saltar" href="#contenido">
        Saltar al contenido
      </a>
      <header className="cabecera">
        <div className="marca">
          <button
            ref={botonMenuRef}
            className="boton-icono"
            aria-label="Abrir menú de módulos"
            aria-expanded={menuAbierto}
            aria-controls="menu-modulos"
            onClick={() => setMenuAbierto(true)}
          >
            <Menu />
          </button>
          <span className="logo">
            <Grid3X3 size={23} />
          </span>
          <div>
            <strong>Mapa de Calor ESP32</strong>
            <small>Panel administrativo</small>
          </div>
        </div>
        <span className="conexion-cabecera">
          <span className="punto" /> Servicio Python:{" "}
          <strong>Sin conectar</strong>
          <span className="separador">·</span> Gateway:{" "}
          <strong>Sin conectar</strong>
        </span>
        <nav aria-label="Navegación principal">
          {NAVEGACION.map(({ pagina: destino, titulo }) => (
            <button
              key={destino}
              aria-current={pagina === destino ? "page" : undefined}
              onClick={() => navegar(destino)}
            >
              {titulo}
            </button>
          ))}
        </nav>
      </header>
      {menuAbierto && (
        <div className="capa-menu" onClick={() => setMenuAbierto(false)}>
          <aside
            ref={menuRef}
            id="menu-modulos"
            className="panel-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Módulos del sistema"
            onClick={(evento) => evento.stopPropagation()}
          >
            <div className="menu-titulo">
              <span className="logo">
                <Grid3X3 />
              </span>
              <strong>Módulos del Sistema</strong>
              <button
                className="boton-icono"
                aria-label="Cerrar menú"
                onClick={() => setMenuAbierto(false)}
              >
                <X />
              </button>
            </div>
            <p className="etiqueta">ESP32 · PANEL DE CONTROL</p>
            {NAVEGACION.map(({ pagina: destino, titulo, icono: Icono }) => (
              <button
                className={`opcion-menu ${pagina === destino ? "seleccionada" : ""}`}
                key={destino}
                onClick={() => navegar(destino)}
              >
                <Icono size={20} />
                {titulo}
                <ChevronRight size={16} />
              </button>
            ))}
            <div className="menu-futuros">
              {MODULOS.map(({ titulo, icono: Icono }) => (
                <div key={titulo}>
                  <Icono size={19} />
                  <span>{titulo}</span>
                  <LockKeyhole size={15} />
                </div>
              ))}
            </div>
            <div className="menu-nota">
              <Info size={18} />
              <span>
                Demostración visual
                <br />
                Sin captura de datos
              </span>
            </div>
          </aside>
        </div>
      )}
      <main id="contenido" ref={principalRef} tabIndex={-1}>
        {pagina === "inicio" ? (
          <>
            <section className="hero">
              <p className="etiqueta">
                <Radio size={17} /> PLATAFORMA TELEMÉTRICA EXPERIMENTAL
              </p>
              <h1>Sistema de Posicionamiento ESP32</h1>
              <p>
                Gestiona la recolección de mediciones de señal para
                entrenamiento y calibración de cuadrículas.
                <br className="solo-escritorio" /> Diseñado para captura ágil.
              </p>
              <span className="nota-demo">
                <Info size={15} /> Demostración: sin captura de datos
              </span>
            </section>
            <section className="estado-sistema" aria-label="Estado del sistema">
              <h2>
                <Activity size={20} /> Estado del Sistema
              </h2>
              <div className="estados">
                <div className="estado">
                  <span className="punto" />
                  <div>
                    <small>Servicio Python</small>
                    <strong>Sin conectar</strong>
                  </div>
                </div>
                <div className="estado">
                  <WifiOff size={19} />
                  <div>
                    <small>Gateway ESP32</small>
                    <strong>Sin conectar</strong>
                  </div>
                </div>
              </div>
            </section>
            <section>
              <h2 className="titulo-seccion">Módulos de Trabajo</h2>
              <div className="modulos">
                <article className="modulo modulo-activo">
                  <span className="icono-modulo azul">
                    <Grid3X3 />
                  </span>
                  <h3>Recolección de Datos</h3>
                  <p>
                    Explora la captura de telemetría RSSI con un recorrido
                    guiado por zonas o con controles manuales.
                  </p>
                  <div className="detalle">
                    <strong>Dos modos de trabajo:</strong>
                    <div className="chips">
                      <span>Guiado por zonas</span>
                      <span>Manual</span>
                    </div>
                  </div>
                  <button
                    className="boton primario"
                    onClick={() => navegar("captura")}
                  >
                    {activa ? "Continuar demostración" : "Empezar recolección"}
                    <ArrowRight size={18} />
                  </button>
                </article>
                {MODULOS.map(
                  ({ titulo, texto, detalle, etiquetas, icono: Icono }) => (
                    <article className="modulo" key={titulo}>
                      <div className="fila">
                        <span className="icono-modulo">
                          <Icono />
                        </span>
                        <span className="badge">PRÓXIMAMENTE</span>
                      </div>
                      <h3>{titulo}</h3>
                      <p>{texto}</p>
                      <div className="detalle">
                        <strong>{detalle}</strong>
                        <div className="chips">
                          {etiquetas.map((etiqueta) => (
                            <span key={etiqueta}>{etiqueta}</span>
                          ))}
                        </div>
                      </div>
                      <button className="boton" disabled>
                        <LockKeyhole size={16} />
                        En desarrollo
                      </button>
                    </article>
                  ),
                )}
              </div>
            </section>
            <section className="tarjeta instrucciones">
              <div className="fila titulo-instrucciones">
                <div className="titulo-con-icono">
                  <span className="icono-redondo">
                    <CircleHelp />
                  </span>
                  <div>
                    <h2>¿Cómo funciona la recolección?</h2>
                    <p>Conoce el flujo antes de conectar tu sistema.</p>
                  </div>
                </div>
                <span className="etiqueta-formato">
                  <FileText size={16} /> Formato previsto: CSV UTF-8
                </span>
              </div>
              <div className="pasos">
                {pasos.map(({ titulo, texto, icono: Icono }, indice) => (
                  <article key={titulo}>
                    <div className="fila">
                      <span className={`numero ${indice === 2 ? "verde" : ""}`}>
                        {indice + 1}
                      </span>
                      <Icono size={23} />
                    </div>
                    <h3>{titulo}</h3>
                    <p>{texto}</p>
                  </article>
                ))}
              </div>
              <div className="barra-ayuda">
                <span>
                  <Info size={20} />
                  Consulta los parámetros del Gateway y la guía de conexión.
                </span>
                <div>
                  <button
                    className="boton secundario"
                    onClick={() => navegar("gateway")}
                  >
                    Ajustes de Gateway
                  </button>
                  <button
                    className="boton primario"
                    onClick={() => navegar("datasets")}
                  >
                    Explorar Datasets
                  </button>
                </div>
              </div>
            </section>
          </>
        ) : (
          <>
            <button className="volver" onClick={() => navegar("inicio")}>
              <ArrowLeft size={17} />
              Volver al inicio
            </button>
            <div className="encabezado-pagina">
              <p className="etiqueta">PANEL DE CONTROL · ESP32</p>
              <h1>
                {pagina === "captura"
                  ? "Recolección de Datos"
                  : pagina === "gateway"
                    ? "Ajustes del Gateway"
                    : pagina === "datasets"
                      ? "Datasets Recolectados"
                      : "Guía de Conexión"}
              </h1>
              <p>
                {pagina === "captura"
                  ? "Elige cómo quieres recorrer tu sesión de medición."
                  : pagina === "gateway"
                    ? "Parámetros de referencia del sistema actual."
                    : pagina === "datasets"
                      ? "Aquí podrás consultar tus archivos cuando se conecte la recolección."
                      : "Prepara tus dispositivos y conoce el orden de conexión."}
              </p>
            </div>
            <div className="aviso-demo">
              <Info size={19} />
              <span>
                <strong>Demostración: sin captura de datos.</strong> Los
                controles solo actualizan esta interfaz.
              </span>
            </div>
            {pagina === "captura" && (
              <>
                {fase === "configuracion" ? (
                  <div className="layout-captura">
                    <section className="tarjeta configuracion">
                      <h2>Configura tu demostración</h2>
                      <p className="texto-suave">
                        Selecciona el modo de trabajo para empezar.
                      </p>
                      <div
                        className="selector-modo"
                        role="group"
                        aria-label="Modo de recolección"
                      >
                        <button
                          className={modo === "guiado" ? "activo" : ""}
                          aria-pressed={modo === "guiado"}
                          onClick={() => setModo("guiado")}
                        >
                          <Grid3X3 size={19} />
                          Guiado
                        </button>
                        <button
                          className={modo === "manual" ? "activo" : ""}
                          aria-pressed={modo === "manual"}
                          onClick={() => setModo("manual")}
                        >
                          <Clock3 size={19} />
                          Manual
                        </button>
                      </div>
                      <p className="descripcion-modo">
                        {modo === "guiado"
                          ? `Recorre ${totalZonas === 1 ? "la zona" : `las ${totalZonas} zonas`} en orden y confirma tu posición antes de cada temporizador.`
                          : "Escribe un nombre, elige una duración y controla el temporizador."}
                      </p>
                      <form onSubmit={preparar} noValidate>
                        {modo === "guiado" && (
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
                                  value={filasEntrada}
                                  onChange={(evento) =>
                                    cambiarDimensiones(
                                      "filas",
                                      evento.target.value,
                                    )
                                  }
                                  aria-describedby="ayuda-dimensiones"
                                  aria-invalid={
                                    !dimensionValida(Number(filasEntrada))
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
                                  value={columnasEntrada}
                                  onChange={(evento) =>
                                    cambiarDimensiones(
                                      "columnas",
                                      evento.target.value,
                                    )
                                  }
                                  aria-describedby="ayuda-dimensiones"
                                  aria-invalid={
                                    !dimensionValida(Number(columnasEntrada))
                                  }
                                />
                              </div>
                            </div>
                            <small id="ayuda-dimensiones">
                              De 1 a {MAXIMO_DIMENSION} por lado. Cambiar el
                              tamaño restablece las posiciones.
                            </small>
                            {!dimensionesValidas && (
                              <p className="error" role="alert">
                                Introduce filas y columnas válidas para
                                actualizar la cuadrícula.
                              </p>
                            )}
                          </fieldset>
                        )}
                        <label htmlFor="nombre">Nombre del archivo</label>
                        <input
                          id="nombre"
                          value={nombre}
                          maxLength={84}
                          onChange={(evento) => setNombre(evento.target.value)}
                          placeholder="Ej. laboratorio_piso2"
                          aria-describedby={
                            error ? "error-formulario" : "ayuda-nombre"
                          }
                          aria-invalid={!!error}
                        />
                        <small id="ayuda-nombre">
                          Letras, números, espacios y guiones. No escribas una
                          ruta.
                        </small>
                        <label htmlFor="duracion">
                          {modo === "guiado" ? "Duración por zona" : "Duración"}
                        </label>
                        <div className="input-unidad">
                          <input
                            id="duracion"
                            type="number"
                            min="1"
                            max="86400"
                            step="1"
                            value={duracion}
                            onChange={(evento) =>
                              setDuracion(evento.target.value)
                            }
                            aria-describedby="ayuda-duracion"
                          />
                          <span>segundos</span>
                        </div>
                        <small id="ayuda-duracion">
                          De 1 a 86400 segundos. Valor inicial: 60 segundos.
                        </small>
                        <div className="vista-nombre">
                          <FileText size={18} />
                          <span>
                            {nombre.trim().replace(/\.csv$/i, "") || "nombre"}
                            {modo === "guiado"
                              ? "_zona_1_DD_MM_YY_HH_MM"
                              : "_DD_MM_YY_HH_MM"}
                            .csv
                          </span>
                          <small>Vista previa · no se crea un archivo</small>
                        </div>
                        {error && (
                          <p
                            className="error"
                            id="error-formulario"
                            role="alert"
                          >
                            {error}
                          </p>
                        )}
                        <button className="boton primario ancho" type="submit">
                          {modo === "guiado"
                            ? "Preparar recorrido"
                            : "Iniciar demostración"}
                          <ArrowRight size={18} />
                        </button>
                      </form>
                    </section>
                    <section className="tarjeta preview">
                      <div className="fila">
                        <h2>
                          {modo === "guiado"
                            ? `Tu recorrido ${dimensiones.filas}×${dimensiones.columnas}`
                            : "A tu propio ritmo"}
                        </h2>
                        <span className="badge">
                          {modo === "guiado"
                            ? `${totalZonas} ${totalZonas === 1 ? "ZONA" : "ZONAS"}`
                            : "MANUAL"}
                        </span>
                      </div>
                      {modo === "guiado" ? (
                        <>
                          <Cuadricula
                            filas={dimensiones.filas}
                            columnas={dimensiones.columnas}
                            zonas={zonasVisuales}
                            onReordenar={
                              dimensionesValidas ? setZonasVisuales : undefined
                            }
                            actual={1}
                            completas={[]}
                            ejecutando={false}
                          />
                          <p className="leyenda">
                            <ArrowRight size={17} />
                            Orden del recorrido: zonas 1 a {totalZonas}. Mover
                            los cuadrados solo cambia su posición visual.
                          </p>
                          <div className="nota">
                            <Info size={18} />
                            <span>
                              El temporizador espera tu confirmación en cada
                              zona. Puedes detener la demostración en cualquier
                              momento.
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
                            Una pantalla sencilla con el cronómetro y un botón
                            para detenerlo.
                          </p>
                          <span className="reloj-preview">
                            {formatoTiempo(
                              Number.isFinite(segundos) ? segundos : 0,
                            )}
                          </span>
                        </div>
                      )}
                    </section>
                  </div>
                ) : (
                  <div
                    className={`layout-captura ${modo === "manual" ? "solo-manual" : ""}`}
                  >
                    <section className="tarjeta consola">
                      <div className="fila">
                        <h2>
                          {modo === "guiado"
                            ? `Zona ${zona} de ${totalZonas}`
                            : "Demostración manual"}
                        </h2>
                        <span
                          className={`badge ${fase === "ejecutando" ? "badge-azul" : fase === "completada" ? "badge-verde" : ""}`}
                        >
                          {fase === "ejecutando"
                            ? "EN CURSO"
                            : fase === "esperando"
                              ? "EN ESPERA"
                              : fase === "completada"
                                ? "COMPLETADA"
                                : "DETENIDA"}
                        </span>
                      </div>
                      <p className="nombre-sesion">{nombre}</p>
                      <span className="icono-redondo">
                        <Clock3 />
                      </span>
                      <div
                        className="temporizador"
                        role="timer"
                        aria-label="Tiempo restante"
                      >
                        {formatoTiempo(
                          fase === "esperando" ? segundos : restante,
                        )}
                      </div>
                      <p className="texto-suave">
                        {fase === "esperando"
                          ? `Ubícate en la zona ${zona} para continuar.`
                          : fase === "ejecutando"
                            ? "Tiempo restante de la demostración"
                            : fase === "completada"
                              ? "Has completado la demostración."
                              : "La demostración se detuvo antes de finalizar."}
                      </p>
                      {fase === "ejecutando" && (
                        <progress
                          value={segundos - restante}
                          max={segundos}
                          aria-label="Progreso del temporizador"
                        />
                      )}
                      <div className="mensaje-estado" role="status">
                        {fase === "completada" || fase === "detenida"
                          ? "No se han recibido datos ni generado archivos."
                          : "Solo se está simulando el flujo visual."}
                      </div>
                      <div className="acciones-consola">
                        {fase === "esperando" && (
                          <button
                            className="boton primario ancho"
                            onClick={iniciarTiempo}
                          >
                            <Check size={18} />
                            Estoy en la zona {zona}, continuar
                          </button>
                        )}
                        {activa ? (
                          <button
                            className="boton peligro ancho"
                            onClick={() => setFase("detenida")}
                          >
                            <Square size={16} />
                            Detener
                          </button>
                        ) : (
                          <button
                            className="boton primario ancho"
                            onClick={nuevaDemostracion}
                          >
                            Nueva demostración
                            <ArrowRight size={18} />
                          </button>
                        )}
                      </div>
                    </section>
                    {modo === "guiado" && (
                      <section className="tarjeta preview">
                        <div className="fila">
                          <h2>Recorrido de la campaña</h2>
                          <span className="badge">
                            {zonasCompletadas.length} / {totalZonas}
                          </span>
                        </div>
                        <Cuadricula
                          filas={dimensiones.filas}
                          columnas={dimensiones.columnas}
                          zonas={zonasVisuales}
                          onReordenar={setZonasVisuales}
                          actual={zona}
                          completas={zonasCompletadas}
                          ejecutando={fase === "ejecutando"}
                        />
                        <div className="leyenda-zonas">
                          <span>
                            <i className="muestra actual" />
                            Zona actual
                          </span>
                          <span>
                            <i className="muestra completa" />
                            Completada
                          </span>
                          <span>
                            <i className="muestra" />
                            Pendiente
                          </span>
                        </div>
                        <div className="nota">
                          <Info size={18} />
                          <span>
                            Las zonas completadas representan el recorrido de
                            esta demostración, sin registros de telemetría.
                          </span>
                        </div>
                      </section>
                    )}
                  </div>
                )}
              </>
            )}
            {pagina === "datasets" && (
              <section className="tarjeta vacio">
                <span className="icono-redondo grande">
                  <Database size={36} />
                </span>
                <h2>Todavía no hay datasets</h2>
                <p>
                  Esta versión no recibe datos ni genera archivos CSV.
                  <br />
                  El listado y las descargas estarán disponibles cuando se
                  conecte el sistema.
                </p>
                <button
                  className="boton primario"
                  onClick={() => navegar("captura")}
                >
                  Explorar la interfaz de recolección
                  <ArrowRight size={18} />
                </button>
              </section>
            )}
            {pagina === "gateway" && (
              <div className="layout-captura">
                <section className="tarjeta configuracion">
                  <div className="fila">
                    <h2>Parámetros de referencia</h2>
                    <Settings2 size={22} />
                  </div>
                  <p className="texto-suave">
                    Valores actuales del receptor y del firmware. Solo lectura.
                  </p>
                  <dl className="parametros">
                    {[
                      ["Red Wi-Fi", "MapaCalor_MVP"],
                      ["Canal Wi-Fi", "6 · 2.4 GHz"],
                      ["Escucha HTTP del receptor", "0.0.0.0:8080"],
                      ["Endpoint de registros", "/v1/registros"],
                      ["Destino broadcast UDP", "192.168.4.255"],
                      ["Puerto UDP", "4210"],
                      ["Protocolo", "v3"],
                    ].map(([titulo, valor]) => (
                      <div key={titulo}>
                        <dt>{titulo}</dt>
                        <dd>{valor}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
                <section className="tarjeta configuracion">
                  <h2>Estado de conexión</h2>
                  <div className="desconectado">
                    <WifiOff size={32} />
                    <h3>Sin conectar</h3>
                    <p>
                      No hay comunicación con el Gateway ni con el servicio
                      Python en esta versión.
                    </p>
                  </div>
                  <div className="nota">
                    <Info size={18} />
                    <span>
                      El canal y la red se configuran en el firmware. Esta
                      pantalla no aplica cambios a los dispositivos.
                    </span>
                  </div>
                  <button
                    className="boton secundario ancho"
                    onClick={() => navegar("ayuda")}
                  >
                    Consultar guía de conexión
                    <ArrowRight size={18} />
                  </button>
                </section>
              </div>
            )}
            {pagina === "ayuda" && (
              <section className="tarjeta ayuda">
                <h2>Preparación del sistema</h2>
                <p className="texto-suave">
                  Pasos de referencia para cuando la recolección esté conectada.
                </p>
                <ol>
                  {[
                    [
                      "Enciende el Gateway",
                      "El Gateway crea la red Wi-Fi MapaCalor_MVP. Todas las ESP32 deben utilizar el mismo canal y la misma versión del protocolo.",
                    ],
                    [
                      "Conecta el PC al Wi-Fi del Gateway",
                      "Conecta el equipo receptor a MapaCalor_MVP. El receptor recibe los lotes HTTP en el puerto 8080.",
                    ],
                    [
                      "Prepara el receptor",
                      "En la integración futura, la interfaz permitirá iniciar la recepción. Esta demostración todavía no ejecuta Python ni recibe paquetes.",
                    ],
                    [
                      "Espera a que el Gateway descubra el PC",
                      "En la prueba física, confirma el mensaje «PC descubierta» antes de encender las torres y el jugador.",
                    ],
                    [
                      "Enciende las torres y el jugador",
                      "Mantén las cuatro torres en sus posiciones físicas. Sus IDs son dinámicos; la ubicación se identifica mediante la MAC.",
                    ],
                  ].map(([titulo, texto]) => (
                    <li key={titulo}>
                      <h3>{titulo}</h3>
                      <p>{texto}</p>
                    </li>
                  ))}
                </ol>
                <div className="nota">
                  <CircleHelp size={20} />
                  <span>
                    Si no llegan datos en una prueba real, revisa la red Wi-Fi,
                    el canal y que el firewall permita el puerto 8080 desde la
                    red del Gateway.
                  </span>
                </div>
              </section>
            )}
          </>
        )}
      </main>
      <footer>
        <span>
          <Grid3X3 size={15} />
          Mapa de Calor ESP32
        </span>
        <span>Interfaz de demostración · Sin servicios conectados</span>
      </footer>
    </>
  );
}

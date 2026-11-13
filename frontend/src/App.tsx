import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  CircleHelp,
  Database,
  FileText,
  Filter,
  Grid3X3,
  Info,
  Layers,
  Menu,
  Radio,
  Settings2,
  ShieldCheck,
  Thermometer,
  WifiOff,
  X,
} from "lucide-react";
import Lecturas from "./Lecturas";
import Datasets from "./Datasets";
import PreparacionDatos from "./PreparacionDatos";
import EntrenamientoModelos from "./EntrenamientoModelos";
import MapasCalor from "./MapasCalor";
import CarpetasAutorizadas from "./CarpetasAutorizadas";
import { useServidor } from "./useServidor";

type Pagina = "inicio" | "captura" | "datasets" | "preparacion" | "entrenamiento" | "mapas" | "carpetas" | "ayuda";
function paginaDesdeUrl(): Pagina {
  const nombre = window.location.hash.slice(1);
  return ["inicio", "captura", "datasets", "preparacion", "entrenamiento", "mapas", "carpetas", "ayuda"].includes(nombre)
    ? nombre as Pagina : "inicio";
}
const NAVEGACION: { pagina: Pagina; titulo: string; icono: typeof Grid3X3 }[] =
  [
    { pagina: "inicio", titulo: "Inicio", icono: Layers },
    { pagina: "captura", titulo: "Recolección", icono: Grid3X3 },
    { pagina: "preparacion", titulo: "Preparación", icono: Filter },
    { pagina: "entrenamiento", titulo: "Entrenamiento", icono: Activity },
    { pagina: "mapas", titulo: "Mapas", icono: Thermometer },
    { pagina: "datasets", titulo: "Datasets", icono: Database },
    { pagina: "carpetas", titulo: "Carpetas", icono: ShieldCheck },
    { pagina: "ayuda", titulo: "Ayuda", icono: CircleHelp },
  ];
const MODULOS = [
  {
    titulo: "Preparación de Datos",
    texto:
      "Agrupa las lecturas RSSI de tus CSV por zona y genera un dataset etiquetado para entrenar.",
    detalle: "Preparación por archivo:",
    etiquetas: ["CSV por zona", "Vectores RSSI"],
    icono: Filter,
  },
  {
    titulo: "Entrenamiento de Modelos",
    texto:
      "Generación de clasificadores de posición usando los datasets recolectados.",
    detalle: "Algoritmos disponibles:",
    etiquetas: ["k-NN Weighted", "Random Forest"],
    icono: Activity,
  },
  {
    titulo: "Mapas de Calor",
    texto:
      "Visualización 2D de cobertura de señal RSSI y estimación de ubicación sobre planos.",
    detalle: "Visualización disponible:",
    etiquetas: ["Mapas PNG", "Suavizado configurable"],
    icono: Thermometer,
  },
];

/** Panel local para controlar el receptor y consultar sus capturas. */
export default function App() {
  const [pagina, setPagina] = useState<Pagina>(paginaDesdeUrl);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const principalRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLElement>(null);
  const botonMenuRef = useRef<HTMLButtonElement>(null);
  const { estado: servidor, conectado } = useServidor();
  const actual = servidor?.actual;
  const activa = !!actual;
  const servicio = conectado ? "En línea" : "Sin conectar";
  const gateway =
    conectado &&
    actual?.ultimaRecepcionUtc &&
    Date.now() - Date.parse(actual.ultimaRecepcionUtc) < 10000
      ? "Recibiendo registros"
      : !conectado
        ? "Sin conectar"
        : servidor?.gateway?.error
          ? "Error de descubrimiento"
          : servidor?.gateway?.dispositivos.some((dispositivo) => dispositivo.conectado && dispositivo.pcConfirmada)
            ? "Comunicando con la PC"
            : servidor?.gateway?.dispositivos.some((dispositivo) => dispositivo.conectado)
              ? "Detectado; esperando confirmación"
              : "Sin conectar";

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

  useEffect(() => {
    const volver = () => {
      setPagina(paginaDesdeUrl());
      setMenuAbierto(false);
      requestAnimationFrame(() => {
        principalRef.current?.focus();
        window.scrollTo({ top: 0 });
      });
    };
    window.addEventListener("popstate", volver);
    window.addEventListener("hashchange", volver);
    return () => {
      window.removeEventListener("popstate", volver);
      window.removeEventListener("hashchange", volver);
    };
  }, []);

  /** Cambia de pantalla conservando la recolección activa. */
  function navegar(destino: Pagina) {
    if (destino === pagina) { setMenuAbierto(false); return; }
    const url = new URL(window.location.href);
    url.hash = destino === "inicio" ? "" : destino;
    window.history.pushState(null, "", url);
    setPagina(destino);
    setMenuAbierto(false);
    requestAnimationFrame(() => {
      principalRef.current?.focus();
      window.scrollTo({ top: 0 });
    });
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
      titulo: "Conserva tus archivos CSV",
      texto:
        "Cada captura guarda un CSV en esta PC. El receptor completa su tiempo aunque el navegador pierda conexión.",
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
          <span className="punto" /> Backend local: <strong>{servicio}</strong>
          <span className="separador">·</span> Gateway:{" "}
          <strong>{gateway}</strong>
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
            <div className="menu-nota">
              <Info size={18} />
              <span>
                Recolección local
                <br />
                Archivos CSV en esta PC
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
                <Radio size={17} /> PLATAFORMA PARA GRABACIÓN DE RSSI
              </p>
              <h1>Sistema de Posicionamiento ESP32</h1>
              <p>
                Gestiona la recolección de mediciones de señal para
                entrenamiento y calibración de cuadrículas.
                <br className="solo-escritorio" /> Diseñado para captura ágil.
              </p>
            </section>
            <section className="estado-sistema" aria-label="Estado del sistema">
              <h2>
                <Activity size={20} /> Estado del Sistema
              </h2>
              <div className="estados">
                <div className="estado">
                  <span className="punto" />
                  <div>
                    <small>Backend local</small>
                    <strong>{servicio}</strong>
                  </div>
                </div>
                <div className="estado">
                  <WifiOff size={19} />
                  <div>
                    <small>Gateway ESP32</small>
                    <strong>{gateway}</strong>
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
                    Módulo para gestionar capturas de RSSI. Acá se encuentran
                    las grabaciones guiadas, grabaciones manuales y modo juego.
                  </p>
                  <div className="detalle">
                    <strong>Tres modos de trabajo:</strong>
                    <div className="chips">
                      <span>Guiado por zonas</span>
                      <span>Manual</span>
                      <span>Juegos</span>
                    </div>
                  </div>
                  <button
                    className="boton primario"
                    onClick={() => navegar("captura")}
                  >
                    {activa ? "Ver captura activa" : "Empezar recolección"}
                    <ArrowRight size={18} />
                  </button>
                </article>
                {MODULOS.map(
                  ({ titulo, texto, detalle, etiquetas, icono: Icono }) => (
                    <article className="modulo modulo-activo" key={titulo}>
                      <div className="fila">
                        <span className="icono-modulo">
                          <Icono />
                        </span>
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
                      <button className="boton primario" onClick={() => navegar(Icono === Thermometer ? "mapas" : Icono === Activity ? "entrenamiento" : "preparacion")}>
                        <ArrowRight size={18} />
                        {Icono === Filter ? "Preparar datos" : Icono === Activity ? "Entrenar modelo" : "Generar mapas"}
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
                    <p>Configura, captura y descarga tus registros.</p>
                  </div>
                </div>
                <span className="etiqueta-formato">
                  <FileText size={16} /> Formato: CSV UTF-8
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
                {pagina === "mapas"
                  ? "Mapas de Calor"
                  : pagina === "entrenamiento"
                  ? "Entrenamiento de Modelos"
                  : pagina === "preparacion"
                  ? "Preparación de Datos"
                  : pagina === "captura"
                  ? "Recolección de Datos"
                  : pagina === "carpetas"
                  ? "Carpetas autorizadas"
                  : pagina === "datasets"
                    ? "Datasets Recolectados"
                    : "Guía de Conexión"}
              </h1>
              <p>
                {pagina === "mapas"
                  ? "Selecciona tus lecturas, el modelo entrenado y genera mapas de ubicación por zona."
                  : pagina === "entrenamiento"
                  ? "Selecciona tu CSV etiquetado y configura KNN o Random Forest para generar el modelo."
                  : pagina === "preparacion"
                  ? "Etiqueta lecturas por zona para entrenar o separa un CSV por jugador."
                  : pagina === "captura"
                  ? "Elige cómo quieres recorrer tu sesión de medición."
                  : pagina === "carpetas"
                  ? "Elige qué carpetas puede usar el sistema desde el hotspot."
                  : pagina === "datasets"
                    ? "Consulta los CSV guardados en esta PC."
                    : "Prepara tus dispositivos y conoce el orden de conexión."}
              </p>
            </div>
            {pagina === "datasets" && <Datasets />}
            {pagina === "carpetas" && <CarpetasAutorizadas />}
            {pagina === "ayuda" && (
              <section className="tarjeta ayuda">
                <h2>Preparación del sistema</h2>
                <p className="texto-suave">
                  Activa el hotspot de esta PC y enciende los dispositivos antes de iniciar
                  una captura.
                </p>
                <ol>
                  {[
                    [
                      "Activa el hotspot de la PC",
                      "Crea una red de 2.4 GHz. El hotspot, Gateway, torres y jugador deben compartir el canal (6 por defecto).",
                    ],
                    [
                      "Enciende el Gateway",
                      "El Gateway se conecta al hotspot con las credenciales de su config.h y anuncia su presencia por UDP. Inicia el backend y revisa el estado del Gateway en Inicio.",
                    ],
                    [
                      "Prepara el receptor",
                      "Abre Recolección y configura el archivo y su duración. Al iniciar, el backend responderá al Gateway con el puerto del receptor Python.",
                    ],
                    [
                      "Confirma la conexión con la PC",
                      "Antes de capturar, el Gateway muestra «PC confirmada; sin captura activa». Durante la captura muestra «PC descubierta» y el puerto HTTP.",
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
                    el canal y que el firewall permita HTTP 8080 y UDP 4210 desde
                    la red del hotspot de esta PC.
                  </span>
                </div>
              </section>
            )}
          </>
        )}
        <div hidden={pagina !== "mapas"}>
          <MapasCalor />
        </div>
        <div hidden={pagina !== "entrenamiento"}>
          <EntrenamientoModelos />
        </div>
        <div hidden={pagina !== "preparacion"}>
          <PreparacionDatos />
        </div>
        <div hidden={pagina !== "captura"}>
          <Lecturas servidor={servidor} conectado={conectado} />
        </div>
      </main>
      <footer>
        <span>
          <Grid3X3 size={15} />
          Mapa de Calor ESP32
        </span>
        <span>Recolección local · Archivos CSV en esta PC</span>
      </footer>
    </>
  );
}

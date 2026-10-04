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
  LockKeyhole,
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
import { useServidor } from "./useServidor";

type Pagina = "inicio" | "captura" | "gateway" | "datasets" | "ayuda";
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

/** Panel local para controlar el receptor y consultar sus capturas. */
export default function App() {
  const [pagina, setPagina] = useState<Pagina>("inicio");
  const [menuAbierto, setMenuAbierto] = useState(false);
  const principalRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLElement>(null);
  const botonMenuRef = useRef<HTMLButtonElement>(null);
  const { estado: servidor, conectado } = useServidor();
  const actual = servidor?.actual;
  const activa = !!actual;
  const servicio = conectado ? "En línea" : "Sin conectar";
  const receptor =
    conectado && actual?.estado === "grabando"
      ? "Escuchando"
      : "Sin captura activa";
  const gateway =
    conectado &&
    actual?.ultimaRecepcionUtc &&
    Date.now() - Date.parse(actual.ultimaRecepcionUtc) < 10000
      ? "Recibiendo registros"
      : "Sin datos recientes";

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

  /** Cambia de pantalla conservando la recolección activa. */
  function navegar(destino: Pagina) {
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
                <Radio size={17} /> PLATAFORMA TELEMÉTRICA EXPERIMENTAL
              </p>
              <h1>Sistema de Posicionamiento ESP32</h1>
              <p>
                Gestiona la recolección de mediciones de señal para
                entrenamiento y calibración de cuadrículas.
                <br className="solo-escritorio" /> Diseñado para captura ágil.
              </p>
              <span className="nota-demo">
                <Info size={15} /> CSV guardados en esta PC
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
                    Controla la captura de telemetría RSSI con un recorrido
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
                    {activa ? "Ver captura activa" : "Empezar recolección"}
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
                      ? "Consulta los CSV guardados en esta PC."
                      : "Prepara tus dispositivos y conoce el orden de conexión."}
              </p>
            </div>
            {pagina === "datasets" && <Datasets />}
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
                      [
                        "Escucha HTTP del receptor",
                        `${servidor?.receptor.host ?? "0.0.0.0"}:${servidor?.receptor.puertoHttp ?? 8080}`,
                      ],
                      ["Endpoint de registros", "/v1/registros"],
                      [
                        "Destino broadcast UDP",
                        servidor?.receptor.destinoUdp ?? "192.168.4.255",
                      ],
                      [
                        "Puerto UDP",
                        String(servidor?.receptor.puertoUdp ?? 4210),
                      ],
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
                    <h3>{gateway}</h3>
                    <p>
                      Backend: {servicio}. Receptor: {receptor}. La recepción se
                      indica únicamente cuando llegan registros reales.
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
                  Enciende los dispositivos y conecta esta PC antes de iniciar
                  una captura.
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
                      "Abre Recolección y configura el archivo y su duración. Inicia la primera captura para que Python anuncie el receptor al Gateway.",
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

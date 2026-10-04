import { useEffect, useState } from "react";
import { Database, Download, RefreshCw } from "lucide-react";
import { api, capturaActiva, type Captura } from "./api";

/** Lista los archivos creados por el backend y permite descargar los CSV cerrados. */
export default function Datasets() {
  const [capturas, setCapturas] = useState<Captura[]>([]);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  useEffect(() => {
    let vigente = true;
    let intervalo: ReturnType<typeof setTimeout>;
    const consultar = async () => {
      try {
        const datos = await api.listar();
        if (vigente) {
          setCapturas(datos);
          setError("");
        }
      } catch (error) {
        if (vigente) setError((error as Error).message);
      }
      if (vigente) {
        setCargando(false);
        intervalo = setTimeout(consultar, 2000);
      }
    };
    void consultar();
    return () => {
      vigente = false;
      clearTimeout(intervalo);
    };
  }, []);
  return (
    <section className="tarjeta">
      <div className="fila">
        <h2>Archivos de captura</h2>
        <span className="badge">{capturas.length} CSV</span>
      </div>
      <p className="texto-suave">
        Guardados en data/raw de esta PC. Las capturas detenidas o con errores
        pueden contener datos parciales.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {cargando ? (
        <p className="mensaje-estado">
          <RefreshCw size={18} /> Consultando archivos…
        </p>
      ) : capturas.length === 0 ? (
        <div className="vacio">
          <Database size={36} />
          <h3>Todavía no hay capturas</h3>
          <p>
            Los CSV aparecerán aquí al iniciar una recolección desde el
            formulario.
          </p>
        </div>
      ) : (
        <div className="lista-datasets">
          {capturas.map((captura) => (
            <article className="dataset" key={captura.id}>
              <div>
                <strong>{captura.archivo}</strong>
                <p>
                  {new Date(captura.creadaUtc).toLocaleString("es-CR", {
                    timeZone: "America/Costa_Rica",
                  })}{" "}
                  · {captura.filasEscritas} registros
                </p>
                {captura.error && (
                  <p className="error-dataset">{captura.error}</p>
                )}
              </div>
              <span
                className={`badge ${captura.estado === "completada" ? "badge-verde" : ""}`}
              >
                {captura.estado}
              </span>
              {!capturaActiva(captura) && captura.inicioUtc ? (
                <a
                  className="boton secundario"
                  href={`/api/lecturas/${captura.id}/archivo`}
                  download
                >
                  <Download size={17} />
                  Descargar CSV
                </a>
              ) : (
                <span className="texto-suave">
                  {capturaActiva(captura)
                    ? "Esperando cierre"
                    : "Sin CSV confirmado"}
                </span>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

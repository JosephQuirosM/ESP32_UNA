import type {
  Captura,
  EstadoServidor,
  SolicitudLectura,
} from "../../shared/lecturas";
export type {
  Captura,
  EstadoServidor,
  SolicitudLectura,
} from "../../shared/lecturas";
export { capturaActiva } from "../../shared/lecturas";

export class ErrorApi extends Error {
  constructor(
    public codigo: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}
/** Comunica la interfaz con el backend que corre en esta misma PC. */
async function pedir<T>(ruta: string, opciones?: RequestInit): Promise<T> {
  const controlador = new AbortController();
  const plazo = window.setTimeout(() => controlador.abort(), 5000);
  try {
    const respuesta = await fetch(`/api${ruta}`, {
      ...opciones,
      signal: controlador.signal,
    });
    const carga = await respuesta.json();
    if (!respuesta.ok)
      throw new ErrorApi(
        respuesta.status,
        carga.error ?? "La operación no pudo completarse.",
      );
    return carga as T;
  } catch (error) {
    if (error instanceof ErrorApi) throw error;
    throw new ErrorApi(
      0,
      "No se pudo conectar con el backend local. La captura en curso conserva su duración y su archivo.",
    );
  } finally {
    window.clearTimeout(plazo);
  }
}
export const api = {
  estado: () => pedir<EstadoServidor>("/estado"),
  listar: () => pedir<Captura[]>("/lecturas"),
  solicitud: (id: string) =>
    pedir<Captura>(`/lecturas/solicitud/${encodeURIComponent(id)}`),
  iniciar: (solicitud: SolicitudLectura) =>
    pedir<Captura>("/lecturas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(solicitud),
    }),
  detener: (id: string) =>
    pedir<Captura>(`/lecturas/${encodeURIComponent(id)}/detener`, {
      method: "POST",
    }),
};

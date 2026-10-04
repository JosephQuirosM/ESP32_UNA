export type EstadoCaptura =
  "iniciando" | "grabando" | "cerrando" | "completada" | "detenida" | "error";
export interface SolicitudLectura {
  solicitudId: string;
  nombreArchivo: string;
  duracionSegundos: number;
}
export interface Captura extends SolicitudLectura {
  id: string;
  archivo: string;
  estado: EstadoCaptura;
  creadaUtc: string;
  inicioUtc: string | null;
  finPrevistoUtc: string | null;
  finUtc: string | null;
  filasEscritas: number;
  ultimaRecepcionUtc: string | null;
  error: string | null;
  pid: number | null;
}
export interface EstadoServidor {
  actual: Captura | null;
  receptor: {
    host: string;
    puertoHttp: number;
    destinoUdp: string;
    puertoUdp: number;
  };
}
export function capturaActiva(captura: Captura | null): boolean {
  return (
    !!captura && ["iniciando", "grabando", "cerrando"].includes(captura.estado)
  );
}

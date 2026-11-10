import type { GeometriaCuadricula } from "./cuadricula.js";
export type EstadoCaptura =
  "iniciando" | "grabando" | "cerrando" | "completada" | "detenida" | "error";
export interface SolicitudLectura {
  solicitudId: string;
  nombreArchivo: string;
  duracionSegundos: number | null; // null: captura Juego hasta que el administrador la detenga.
  directorioSalida?: string;
  cuadricula?: GeometriaCuadricula;
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
  preparado?: boolean;
  falloControl?: string;
  gatewayConfirmado?: boolean;
}
export interface EstadoServidor {
  actual: Captura | null;
  gateway: EstadoGateway;
  receptor: {
    host: string;
    puertoHttp: number;
    destinoUdp: string;
    puertoUdp: number;
  };
}
export interface GatewayDetectado {
  mac: string;
  ip: string;
  sesion: number;
  canal: number;
  uptimeMs: number;
  registrosRecibidos: number;
  registrosEnviados: number;
  fallosHttp: number;
  pcConfirmada: boolean;
  ultimaVezUtc: string;
  conectado: boolean;
  controlCaptura?: boolean;
  revisionControl?: number;
  capturando?: boolean;
  descartesInactivos?: number;
  registrosPurgados?: number;
}
export interface EstadoGateway {
  escuchando: boolean;
  error: string | null;
  dispositivos: GatewayDetectado[];
}
export function capturaActiva(captura: Captura | null): boolean {
  return (
    !!captura && ["iniciando", "grabando", "cerrando"].includes(captura.estado)
  );
}

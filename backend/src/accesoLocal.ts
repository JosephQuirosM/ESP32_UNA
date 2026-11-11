import type { Request } from "express";

/** Sólo conexiones que entran y salen por loopback pueden abrir diálogos y administrar raíces. */
export function peticionLocal(peticion: Pick<Request, "socket">) {
  const remoto = peticion.socket.remoteAddress?.replace(/^::ffff:/, "");
  const local = peticion.socket.localAddress?.replace(/^::ffff:/, "");
  return (remoto === "127.0.0.1" || remoto === "::1") && (local === "127.0.0.1" || local === "::1");
}

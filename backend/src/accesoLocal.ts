import type { Request } from "express";
import type { RaicesAutorizadas } from "./raicesAutorizadas.js";

/** Sólo conexiones que entran y salen por loopback pueden abrir diálogos y administrar raíces. */
export function peticionLocal(peticion: Pick<Request, "socket">) {
  const remoto = peticion.socket.remoteAddress?.replace(/^::ffff:/, "");
  const local = peticion.socket.localAddress?.replace(/^::ffff:/, "");
  return (remoto === "127.0.0.1" || remoto === "::1") && (local === "127.0.0.1" || local === "::1");
}

/** Autoriza rutas del anfitrión sólo desde un panel abierto en loopback. */
export function puedeUsarRutasLocales(peticion: Pick<Request, "socket" | "headers">) {
  const { host, origin } = peticion.headers;
  return peticionLocal(peticion) && !!host &&
    /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host) &&
    (!origin || origin === `http://${host}`);
}

export function restriccionesDeRutas(peticion: Request, raices?: RaicesAutorizadas) {
  return puedeUsarRutasLocales(peticion) ? undefined : raices;
}

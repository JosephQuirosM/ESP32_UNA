import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { peticionLocal } from "./accesoLocal.js";

const VIDA_SESION_MS = 24 * 60 * 60 * 1000;
const VENTANA_INTENTOS_MS = 60 * 1000;
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function paginaAcceso(error = "") {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acceso al panel</title><style>body{font:16px system-ui,sans-serif;background:#f7f6fd;color:#17213b;min-height:100vh;display:grid;place-items:center;margin:0}main{background:white;padding:2rem;border-radius:16px;box-shadow:0 8px 30px #20204018;width:min(90vw,360px)}h1{font-size:1.4rem}input,button{box-sizing:border-box;width:100%;padding:.85rem;margin-top:.8rem;border-radius:8px;font:inherit}input{border:1px solid #aab0c6;text-transform:uppercase}button{border:0;background:#4b00dc;color:white;cursor:pointer}.error{color:#b00020}</style></head><body><main><h1>Entrar al panel</h1><p>Pide el código de acceso a quien administra esta PC.</p>${error ? `<p class="error" role="alert">${error}</p>` : ""}<p id="error-acceso" class="error" role="alert" hidden></p><form method="post" action="/api/acceso/entrar"><label for="codigo">Código de acceso</label><input id="codigo" name="codigo" autocomplete="one-time-code" maxlength="16" required autofocus><button type="submit">Entrar</button></form></main><script>
  document.querySelector("form").addEventListener("submit", async (evento) => {
    evento.preventDefault();
    const formulario = evento.currentTarget;
    const boton = formulario.querySelector("button");
    const mensaje = document.getElementById("error-acceso");
    boton.disabled = true;
    mensaje.hidden = true;
    try {
      const respuesta = await fetch(formulario.action, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Heatmap-Login": "fetch" },
        body: new URLSearchParams({ codigo: formulario.elements.codigo.value })
      });
      const datos = await respuesta.json();
      if (!respuesta.ok) throw new Error(datos.error || "No se pudo entrar al panel.");
      window.location.replace("/");
    } catch (error) {
      mensaje.textContent = error instanceof Error ? error.message : "No se pudo entrar al panel.";
      mensaje.hidden = false;
      boton.disabled = false;
    }
  });
</script></body></html>`;
}

/** Sesiones de navegador; el código sólo se entrega por la entrada local de administración. */
export class AccesoRemoto {
  readonly codigo = Array.from(randomBytes(10), b => ALFABETO[b % ALFABETO.length]).join("");
  private sesiones = new Map<string, number>();
  private intentos = new Map<string, { inicio: number; cantidad: number }>();
  private intentosTotales = { inicio: Date.now(), cantidad: 0 };

  private origenValido(req: Request) {
    const host = req.headers.host;
    const destino = req.socket.localAddress?.replace(/^::ffff:/, "");
    return !!host && !!destino && host === `${destino}:${req.socket.localPort}` &&
      req.headers.origin === `http://${host}`;
  }

  private sesionValida(req: Request) {
    const valor = /(?:^|;\s*)heatmap_sesion=([0-9a-f]{64})(?:;|$)/.exec(req.headers.cookie ?? "")?.[1];
    if (!valor) return false;
    const vence = this.sesiones.get(valor);
    if (!vence || vence <= Date.now()) { this.sesiones.delete(valor); return false; }
    return true;
  }

  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      if (peticionLocal(req)) return next();
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Frame-Options", "DENY");
      if (req.path === "/acceso" && req.method === "GET") return res.type("html").send(paginaAcceso());
      if (req.path === "/api/acceso/entrar" && req.method === "POST") return this.entrar(req, res);
      if (!this.sesionValida(req)) {
        if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Introduce el código de acceso en este dispositivo." });
        return res.redirect(303, "/acceso");
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !this.origenValido(req))
        return res.status(403).json({ error: "Origen de la petición inválido." });
      next();
    };
  }

  private entrar(req: Request, res: Response) {
    const accesoDesdePagina = req.headers["x-heatmap-login"] === "fetch";
    const fallar = (codigo: number, mensaje: string) => accesoDesdePagina
      ? res.status(codigo).json({ error: mensaje })
      : res.status(codigo).type("html").send(paginaAcceso(mensaje));
    if (!this.origenValido(req)) return fallar(403, "Petición no válida.");
    const ahora = Date.now();
    const ip = req.socket.remoteAddress ?? "desconocida";
    const previo = this.intentos.get(ip);
    const intento = previo && ahora - previo.inicio < VENTANA_INTENTOS_MS ? previo : { inicio: ahora, cantidad: 0 };
    if (ahora - this.intentosTotales.inicio >= VENTANA_INTENTOS_MS) this.intentosTotales = { inicio: ahora, cantidad: 0 };
    if (intento.cantidad >= 5 || this.intentosTotales.cantidad >= 20)
      return fallar(429, "Demasiados intentos. Espera un minuto.");
    intento.cantidad++; this.intentos.set(ip, intento); this.intentosTotales.cantidad++;
    const recibido = typeof req.body?.codigo === "string" ? req.body.codigo.trim().toUpperCase() : "";
    const a = Buffer.from(recibido), b = Buffer.from(this.codigo);
    if (a.length !== b.length || !timingSafeEqual(a, b))
      return fallar(401, "Código incorrecto.");
    const sesion = randomBytes(32).toString("hex");
    this.sesiones.set(sesion, ahora + VIDA_SESION_MS);
    if (this.sesiones.size > 100) for (const [clave, vence] of this.sesiones) if (vence <= ahora) this.sesiones.delete(clave);
    res.setHeader("Set-Cookie", `heatmap_sesion=${sesion}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);
    if (accesoDesdePagina) return res.json({ ok: true });
    res.redirect(303, "/");
  }
}

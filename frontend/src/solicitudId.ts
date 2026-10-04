/** UUID v4 también desde el móvil por HTTP, donde randomUUID no está disponible. */
export function crearSolicitudId(): string {
  const fuente = globalThis.crypto;
  if (typeof fuente?.randomUUID === "function") return fuente.randomUUID();
  // getRandomValues está disponible también fuera de un contexto HTTPS.
  if (typeof fuente?.getRandomValues !== "function")
    throw new Error("No se pudo generar la solicitud. Usa un navegador actualizado.");
  const bytes = fuente.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

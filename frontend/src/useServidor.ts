import { useEffect, useState } from "react";
import { api, type EstadoServidor } from "./api";

/** Actualiza la disponibilidad del backend y el estado real del receptor. */
export function useServidor() {
  const [estado, setEstado] = useState<EstadoServidor | null>(null);
  const [conectado, setConectado] = useState(false);
  useEffect(() => {
    let vigente = true;
    let intervalo: ReturnType<typeof setTimeout>;
    const consultar = async () => {
      try {
        const respuesta = await api.estado();
        if (vigente) {
          setEstado(respuesta);
          setConectado(true);
        }
      } catch {
        if (vigente) setConectado(false);
      }
      if (vigente) intervalo = setTimeout(consultar, 1000);
    };
    void consultar();
    return () => {
      vigente = false;
      clearTimeout(intervalo);
    };
  }, []);
  return { estado, conectado };
}

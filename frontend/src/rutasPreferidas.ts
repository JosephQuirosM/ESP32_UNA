export type RutasPreferidas = {
  selectorLocal?: boolean;
  recoleccionSalida?: string;
  preparacionSalida?: string;
  entrenamientoEntrada?: string;
  entrenamientoSalida?: string;
  mapasEntradas?: string[];
  mapasModelo?: string;
  mapasSalida?: string;
  jugadoresEntrada?: string;
  jugadoresSalida?: string;
};

export async function cargarRutasPreferidas(): Promise<RutasPreferidas> {
  const respuesta = await fetch("/api/rutas-preferidas");
  if (!respuesta.ok) throw new Error("No se pudieron recuperar las rutas guardadas.");
  return respuesta.json() as Promise<RutasPreferidas>;
}

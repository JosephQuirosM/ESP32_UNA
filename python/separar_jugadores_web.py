#!/usr/bin/env python3
"""Exporta un CSV por jugador usando el mismo agrupado y resumen de Mapas."""
import json
import sys
from pathlib import Path

from jugadores_mapas import estadisticas, exportar, guardar_lecturas, leer_grupos


def escribir_json(ruta, datos):
    temporal = ruta.with_suffix(".tmp")
    temporal.write_text(json.dumps(datos, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporal.replace(ruta)


def separar(solicitud, carpeta):
    estado = carpeta / "estado.json"
    resultados = []
    base = {"total": 1, "procesados": 0, "jugadoresProcesados": 0, "jugadores": resultados}
    escribir_json(estado, {"estado": "procesando", **base})
    try:
        entrada = Path(solicitud["entrada"])
        salida = Path(solicitud["directorioSalida"])
        columnas, crudo, grupos = leer_grupos(entrada)
        for indice, ((gateway, jugador), filas) in enumerate(grupos.items()):
            temporal = carpeta / f"jugador_{indice}.csv"
            guardar_lecturas(temporal, columnas, filas)
            metricas = estadisticas(filas, crudo)
            sufijo = f"gateway_{gateway}_jugador_{jugador}" if jugador is not None else "sin_identificar"
            nombre = f"{solicitud['nombre']}_{sufijo}"
            (destino,) = exportar([temporal], salida, nombre, [".csv"])
            resultados.append({"indice": indice, "entrada": str(entrada),
                               "sesionGateway": gateway, "jugadorId": jugador,
                               "rutaLecturas": str(destino), "estadisticas": metricas})
            base["jugadoresProcesados"] = len(resultados)
            escribir_json(estado, {"estado": "procesando", **base})
        resumen = [{"entrada": item["entrada"], "sesion_gateway": item["sesionGateway"],
                    "jugador_id": item["jugadorId"], **item["estadisticas"]} for item in resultados]
        csv_resumen = carpeta / "resumen_general.csv"
        json_resumen = carpeta / "resumen_general.json"
        guardar_lecturas(csv_resumen, list(resumen[0]), resumen)
        escribir_json(json_resumen, {"jugadores": resumen,
                     "criterio": "Rangos observados por sesión; cuatro torres por secuencia. null indica métrica no disponible."})
        destinos = exportar([csv_resumen, json_resumen], salida,
                            solicitud["nombre"] + "_resumen_general", [".csv", ".json"])
        base.update(procesados=1, rutaResumenGeneralCsv=str(destinos[0]),
                    rutaResumenGeneralJson=str(destinos[1]))
        escribir_json(estado, {"estado": "completado", **base})
    except Exception as error:
        escribir_json(estado, {"estado": "error", "error": str(error), **base})
        raise


if __name__ == "__main__":
    try:
        solicitud_ruta = Path(sys.argv[1])
        separar(json.loads(solicitud_ruta.read_text(encoding="utf-8")), solicitud_ruta.parent)
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

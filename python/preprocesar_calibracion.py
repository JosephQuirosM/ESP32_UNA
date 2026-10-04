#!/usr/bin/env python3
"""Convierte una captura RSSI v3 en vectores etiquetados para el MVP KNN."""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Iterable

from mvp_config import (
    COLUMNAS_CARACTERISTICAS,
    DURACION_ZONA_SEGUNDOS,
    EXCLUSION_TRANSICION_SEGUNDOS,
    MAC_A_CARACTERISTICA,
    ZONAS_EN_ORDEN,
    normalizar_mac,
    zona_por_tiempo,
)

COLUMNAS_REQUERIDAS = {
    "timestamp_utc_pc", "sesion_gateway", "jugador_id", "sesion_jugador",
    "secuencia", "mac_torre", "rssi",
}
COLUMNAS_SALIDA = (
    "sesion_gateway", "jugador_id", "sesion_jugador", "secuencia", "elapsed_s",
    "zona", *COLUMNAS_CARACTERISTICAS,
    "faltantes", "completo",
)


def parsear_timestamp(texto: str) -> datetime:
    return datetime.fromisoformat(texto.replace("Z", "+00:00"))


def _clave_sesion(fila: dict[str, str]) -> tuple[int, int, int]:
    return (int(fila["sesion_gateway"]), int(fila["jugador_id"]), int(fila["sesion_jugador"]))


def construir_muestras(filas: Iterable[dict[str, str]]) -> tuple[list[dict[str, object]], dict[str, int]]:
    """Agrupa las cuatro RSSI de cada secuencia y aplica el plan de recorrido.

    Se elimina la transición inicial de seis segundos de *cada* zona. Las
    muestras incompletas permanecen en el CSV procesado para auditoría, pero
    quedan marcadas y el entrenamiento sólo usa ``completo=1``.
    """
    filas_parseadas: list[tuple[datetime, dict[str, str]]] = []
    for numero, fila in enumerate(filas, start=2):
        try:
            timestamp = parsear_timestamp(fila["timestamp_utc_pc"])
            _clave_sesion(fila)
            int(fila["secuencia"])
            int(fila["rssi"])
        except (KeyError, ValueError) as error:
            raise ValueError(f"fila {numero}: dato v3 inválido") from error
        mac = normalizar_mac(fila["mac_torre"])
        if mac not in MAC_A_CARACTERISTICA:
            raise ValueError(f"fila {numero}: MAC de torre no registrada: {mac}")
        filas_parseadas.append((timestamp, fila))

    inicio_por_sesion: dict[tuple[int, int, int], datetime] = {}
    for timestamp, fila in filas_parseadas:
        clave = _clave_sesion(fila)
        inicio_por_sesion[clave] = min(inicio_por_sesion.get(clave, timestamp), timestamp)

    vectores: dict[tuple[int, int, int, int], dict[str, object]] = {}
    duplicados = 0
    excluidas_transicion = 0
    fuera_recorrido = 0
    for timestamp, fila in filas_parseadas:
        clave_sesion = _clave_sesion(fila)
        elapsed_s = (timestamp - inicio_por_sesion[clave_sesion]).total_seconds()
        indice_zona = int(elapsed_s // DURACION_ZONA_SEGUNDOS)
        dentro_zona = elapsed_s - indice_zona * DURACION_ZONA_SEGUNDOS
        if indice_zona >= len(ZONAS_EN_ORDEN):
            fuera_recorrido += 1
            continue
        if dentro_zona < EXCLUSION_TRANSICION_SEGUNDOS:
            excluidas_transicion += 1
            continue

        zona = zona_por_tiempo(elapsed_s)
        clave = (*clave_sesion, int(fila["secuencia"]))
        muestra = vectores.setdefault(
            clave,
            {
                "sesion_gateway": clave_sesion[0], "jugador_id": clave_sesion[1],
                "sesion_jugador": clave_sesion[2], "secuencia": clave[-1],
                "elapsed_s": elapsed_s, "zona": zona,
            },
        )
        columna = MAC_A_CARACTERISTICA[normalizar_mac(fila["mac_torre"])]
        valor = int(fila["rssi"])
        if columna in muestra:
            duplicados += 1
            # Conserva la primera lectura: evita que una retransmisión altere el vector.
            continue
        muestra[columna] = valor

    muestras: list[dict[str, object]] = []
    for muestra in sorted(
        vectores.values(),
        key=lambda item: (
            item["sesion_gateway"], item["jugador_id"], item["sesion_jugador"],
            item["elapsed_s"], item["secuencia"],
        ),
    ):
        faltantes = [columna for columna in COLUMNAS_CARACTERISTICAS if columna not in muestra]
        muestra["faltantes"] = ";".join(faltantes)
        muestra["completo"] = 0 if faltantes else 1
        muestras.append(muestra)

    resumen = {
        "filas_entrada": len(filas_parseadas), "filas_excluidas_transicion": excluidas_transicion,
        "filas_fuera_recorrido": fuera_recorrido, "duplicados_en_vector": duplicados,
        "vectores_estables": len(muestras),
        "vectores_completos": sum(int(muestra["completo"]) for muestra in muestras),
    }
    return muestras, resumen


def leer_y_preprocesar(entradas: Iterable[Path]) -> tuple[list[dict[str, object]], dict[str, int]]:
    """Lee una o más sesiones v3 y conserva su separación en las muestras."""
    filas: list[dict[str, str]] = []
    for entrada in entradas:
        with entrada.open(newline="", encoding="utf-8") as flujo:
            lector = csv.DictReader(flujo)
            faltantes = COLUMNAS_REQUERIDAS - set(lector.fieldnames or [])
            if faltantes:
                raise ValueError(f"{entrada}: faltan columnas: {', '.join(sorted(faltantes))}")
            filas.extend(lector)
    return construir_muestras(filas)


def guardar_muestras(salida: Path, muestras: list[dict[str, object]]) -> None:
    salida.parent.mkdir(parents=True, exist_ok=True)
    with salida.open("w", newline="", encoding="utf-8") as flujo:
        escritor = csv.DictWriter(flujo, fieldnames=COLUMNAS_SALIDA)
        escritor.writeheader()
        for muestra in muestras:
            escritor.writerow({columna: muestra.get(columna, "") for columna in COLUMNAS_SALIDA})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("entradas", nargs="+", type=Path, help="Uno o más CSV v3 de calibración")
    parser.add_argument("--salida", type=Path, required=True, help="CSV de vectores procesados")
    parser.add_argument("--resumen", type=Path, help="JSON de trazabilidad del preprocesamiento")
    args = parser.parse_args()
    muestras, resumen = leer_y_preprocesar(args.entradas)
    guardar_muestras(args.salida, muestras)
    if args.resumen:
        args.resumen.parent.mkdir(parents=True, exist_ok=True)
        args.resumen.write_text(json.dumps(resumen, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(resumen, ensure_ascii=False))


if __name__ == "__main__":
    main()

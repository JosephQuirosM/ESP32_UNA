#!/usr/bin/env python3
"""Convierte capturas RSSI en vectores etiquetados para entrenamiento."""

from __future__ import annotations

import argparse
import csv
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Iterable

from cuadricula import cuadricula_de_filas, comprobar_zonas, agregar_argumentos, desde_argumentos

from config_rssi import (
    COLUMNAS_CARACTERISTICAS,
    MAC_A_CARACTERISTICA,
    normalizar_mac,
)

COLUMNAS_REQUERIDAS = {
    "timestamp_utc_pc", "sesion_gateway", "jugador_id", "sesion_jugador",
    "secuencia", "mac_torre", "rssi",
}
COLUMNAS_SALIDA = (
    "sesion_gateway", "jugador_id", "sesion_jugador", "secuencia", "elapsed_s",
    "zona", "dataset", "archivo_origen", *COLUMNAS_CARACTERISTICAS,
    "faltantes", "completo", "cuadricula",
)


def parsear_timestamp(texto: str) -> datetime:
    return datetime.fromisoformat(texto.replace("Z", "+00:00"))


def _clave_sesion(fila: dict[str, str]) -> tuple[int, int, int]:
    return (int(fila["sesion_gateway"]), int(fila["jugador_id"]), int(fila["sesion_jugador"]))


def construir_muestras(filas: Iterable[dict[str, str]], zona: int | None, dataset: str = "", archivo_origen: str = "", cuadricula: dict | None = None) -> tuple[list[dict[str, object]], dict[str, int]]:
    """Agrupa RSSI por secuencia en una zona explícita, sin recortes temporales."""
    if zona is not None and (not isinstance(zona, int) or isinstance(zona, bool) or zona < 1):
        raise ValueError("zona debe ser un entero positivo")
    filas = list(filas)
    cuadricula = cuadricula_de_filas(filas, cuadricula)
    if zona is not None:
        comprobar_zonas([zona], cuadricula)
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
        clave = (*clave_sesion, int(fila["secuencia"]))
        muestra = vectores.setdefault(
            clave,
            {
                "sesion_gateway": clave_sesion[0], "jugador_id": clave_sesion[1],
                "sesion_jugador": clave_sesion[2], "secuencia": clave[-1],
                "elapsed_s": elapsed_s, "zona": zona,
                "dataset": dataset, "archivo_origen": archivo_origen,
                "cuadricula": json.dumps(cuadricula, separators=(",", ":")) if cuadricula else "",
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


def leer_y_preprocesar(entradas: Iterable[Path], zona: int | None = None) -> tuple[list[dict[str, object]], dict[str, int]]:
    """Procesa cada CSV por separado y reúne los vectores de todos los datasets.

    Acepta archivos o carpetas (sin búsqueda recursiva). La zona se toma de zona_N
    o del argumento explícito; el nombre o número de dataset no es obligatorio.
    """
    archivos = []
    for entrada in entradas:
        candidatos = sorted(entrada.glob("*.csv")) if entrada.is_dir() else [entrada]
        if not candidatos:
            raise ValueError(f"{entrada}: no contiene CSV")
        archivos.extend(candidatos)
    muestras = []
    resumen: dict[str, int] = {}
    vistos = set()
    for entrada in archivos:
        if entrada.resolve() in vistos:
            raise ValueError(f"archivo de entrada repetido: {entrada}")
        vistos.add(entrada.resolve())
        etiqueta_zona = re.search(r"zona[_ -]?(\d+)(?:_|$)", entrada.stem, re.IGNORECASE)
        if zona is None and not etiqueta_zona:
            raise ValueError(f"{entrada}: indica la zona con --zona o utiliza un nombre con zona_N")
        zona_archivo = zona if zona is not None else int(etiqueta_zona[1])
        etiqueta_dataset = re.search(r"dataset[_ -]?(\d+)", entrada.stem, re.IGNORECASE)
        dataset = f"dataset {int(etiqueta_dataset[1])}" if etiqueta_dataset else ""
        with entrada.open(newline="", encoding="utf-8-sig") as flujo:
            lector = csv.DictReader(flujo)
            faltantes = COLUMNAS_REQUERIDAS - set(lector.fieldnames or [])
            if faltantes:
                raise ValueError(f"{entrada}: faltan columnas: {', '.join(sorted(faltantes))}")
            nuevas, conteos = construir_muestras(lector, zona_archivo, dataset, str(entrada))
        muestras.extend(nuevas)
        for nombre, cantidad in conteos.items():
            resumen[nombre] = resumen.get(nombre, 0) + cantidad
    resumen["archivos_entrada"] = len(archivos)
    return muestras, resumen


def guardar_muestras(salida: Path, muestras: list[dict[str, object]]) -> None:
    salida.parent.mkdir(parents=True, exist_ok=True)
    with salida.open("w", newline="", encoding="utf-8") as flujo:
        escritor = csv.DictWriter(flujo, fieldnames=COLUMNAS_SALIDA)
        escritor.writeheader()
        for muestra in muestras:
            escritor.writerow({columna: muestra.get(columna, "") for columna in COLUMNAS_SALIDA})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    agregar_argumentos(parser)
    parser.add_argument("entradas", nargs="+", type=Path, help="CSV por zona o carpetas Cleaned (sin búsqueda recursiva)")
    parser.add_argument("--zona", type=int, help="Zona de todos los CSV de entrada, si no está en sus nombres")
    parser.add_argument("--salida", type=Path, required=True, help="CSV de vectores procesados")
    parser.add_argument("--resumen", type=Path, help="JSON de trazabilidad del preprocesamiento")
    args = parser.parse_args()
    muestras, resumen = leer_y_preprocesar(args.entradas, zona=args.zona)
    geometria = cuadricula_de_filas(muestras, desde_argumentos(args))
    comprobar_zonas([int(m["zona"]) for m in muestras], geometria)
    if geometria:
        for muestra in muestras:
            muestra["cuadricula"] = json.dumps(geometria, separators=(",", ":"))
    guardar_muestras(args.salida, muestras)
    if args.resumen:
        args.resumen.parent.mkdir(parents=True, exist_ok=True)
        args.resumen.write_text(json.dumps(resumen, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(resumen, ensure_ascii=False))


if __name__ == "__main__":
    main()

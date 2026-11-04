#!/usr/bin/env python3
"""Prepara CSV subidos desde la web, con etiquetas explícitas por archivo."""
from __future__ import annotations

import csv
import io
import json
import sys
from pathlib import Path

from cuadricula import cuadricula_de_filas, comprobar_zonas
from preprocesar_calibracion import COLUMNAS_REQUERIDAS, construir_muestras, guardar_muestras


def preparar(archivos: list[dict], salida: Path, cuadricula=None) -> dict:
    if not archivos:
        raise ValueError("Selecciona al menos un CSV")
    muestras = []
    resumen: dict[str, int] = {}
    detalle = []
    for archivo in archivos:
        nombre = archivo["nombre"]
        zona = archivo["zona"]
        dataset = archivo.get("dataset", "")
        if not isinstance(zona, int) or isinstance(zona, bool) or zona < 1:
            raise ValueError(f"{nombre}: indica una zona entera positiva")
        if not isinstance(dataset, str):
            raise ValueError(f"{nombre}: dataset inválido")
        lector = csv.DictReader(io.StringIO(archivo["contenido"].lstrip("\ufeff")))
        faltantes = COLUMNAS_REQUERIDAS - set(lector.fieldnames or [])
        if faltantes:
            raise ValueError(f"{nombre}: faltan columnas: {', '.join(sorted(faltantes))}")
        try:
            nuevas, conteos = construir_muestras(lector, zona, dataset.strip(), nombre)
        except (ValueError, TypeError, KeyError) as error:
            raise ValueError(f"{nombre}: {error}") from error
        if not conteos["filas_entrada"]:
            raise ValueError(f"{nombre}: el CSV no contiene lecturas")
        muestras.extend(nuevas)
        detalle.append({"archivo": nombre, "zona": zona, "dataset": dataset.strip(), **conteos})
        for clave, valor in conteos.items():
            resumen[clave] = resumen.get(clave, 0) + valor
    if not resumen.get("vectores_completos"):
        raise ValueError("No hay vectores completos de las cuatro torres en los archivos seleccionados")
    cuadricula = cuadricula_de_filas(muestras, cuadricula)
    comprobar_zonas([a["zona"] for a in archivos], cuadricula)
    if cuadricula:
        for muestra in muestras:
            muestra["cuadricula"] = json.dumps(cuadricula, separators=(",", ":"))
    guardar_muestras(salida, muestras)
    resultado = {"resumen": {"archivos_entrada": len(archivos), **resumen}, "archivos": detalle,
                 "zonas": sorted({a["zona"] for a in archivos}), "cuadricula": cuadricula}
    salida.with_suffix(".json").write_text(json.dumps(resultado, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return resultado


if __name__ == "__main__":
    try:
        carga = json.load(sys.stdin)
        print(json.dumps(preparar(carga["archivos"], Path(sys.argv[1]), carga.get("cuadricula")), ensure_ascii=False))
    except (ValueError, KeyError, TypeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

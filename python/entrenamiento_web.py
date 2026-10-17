#!/usr/bin/env python3
"""Inspecciona CSV etiquetados y entrena modelos configurados desde la web."""
from __future__ import annotations

import argparse
import csv
import json
import math
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import joblib
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from mvp_config import COLUMNAS_CARACTERISTICAS


def leer_csv(ruta: Path):
    X, y = [], []
    total = 0
    with ruta.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        faltantes = {"zona", "completo", *COLUMNAS_CARACTERISTICAS} - set(reader.fieldnames or [])
        if faltantes:
            raise ValueError("Elige un CSV etiquetado de Preparación de Datos. Faltan columnas: " + ", ".join(sorted(faltantes)))
        for numero, fila in enumerate(reader, 2):
            total += 1
            if fila["completo"] == "0":
                continue
            if fila["completo"] != "1":
                raise ValueError(f"Fila {numero}: completo debe ser 0 o 1")
            try:
                vector = [float(fila[c]) for c in COLUMNAS_CARACTERISTICAS]
                zona = int(fila["zona"])
                if zona < 1 or not all(math.isfinite(v) for v in vector):
                    raise ValueError()
            except (ValueError, TypeError):
                raise ValueError(f"Fila {numero}: zona o RSSI inválidos") from None
            X.append(vector); y.append(zona)
    if not X:
        raise ValueError("El CSV no contiene vectores completos para entrenar")
    return X, y, {"filas": total, "vectores_completos": len(y), "vectores_incompletos": total-len(y),
                  "zonas": sorted(set(y)), "por_zona": dict(sorted(Counter(y).items()))}


def entero(parametros, clave, defecto, minimo, maximo):
    valor = parametros.get(clave, defecto)
    if isinstance(valor, bool) or not isinstance(valor, int) or not minimo <= valor <= maximo:
        raise ValueError(f"{clave} debe ser un entero entre {minimo} y {maximo}")
    return valor


def crear_modelo(algoritmo, parametros, cantidad):
    if algoritmo == "knn":
        k = entero(parametros, "k", 5, 1, cantidad)
        pesos = parametros.get("pesos", "distance")
        distancia = parametros.get("distancia", "euclidean")
        normalizar = parametros.get("normalizar", True)
        if pesos not in ("distance", "uniform") or distancia not in ("euclidean", "manhattan") or not isinstance(normalizar, bool):
            raise ValueError("Configuración KNN inválida")
        knn = KNeighborsClassifier(n_neighbors=k, weights=pesos, metric=distancia)
        return Pipeline([("normalizar", StandardScaler() if normalizar else "passthrough"), ("knn", knn)])
    if algoritmo == "random_forest":
        arboles = entero(parametros, "arboles", 300, 1, 2000)
        profundidad = parametros.get("profundidad")
        if profundidad is not None:
            profundidad = entero(parametros, "profundidad", None, 1, 100)
        return RandomForestClassifier(n_estimators=arboles, max_depth=profundidad,
            min_samples_split=entero(parametros, "min_division", 2, 2, 1000),
            min_samples_leaf=entero(parametros, "min_hoja", 1, 1, 1000),
            random_state=entero(parametros, "semilla", 42, 0, 2147483647), n_jobs=-1)
    raise ValueError("Elige KNN o Random Forest")


def escribir_json(ruta, datos):
    temporal = ruta.with_suffix(".tmp")
    temporal.write_text(json.dumps(datos, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporal.replace(ruta)


def exportar(modelo, metadata, carpeta, nombre):
    """Reserva ambos archivos sin sobrescribir modelos existentes."""
    for indice in range(1, 10000):
        base = nombre if indice == 1 else f"{nombre}_{indice}"
        destino = carpeta / f"{base}.joblib"
        resumen = carpeta / f"{base}.json"
        try:
            f = destino.open("xb")
        except FileExistsError:
            continue
        try:
            j = resumen.open("x", encoding="utf-8")
        except FileExistsError:
            f.close(); destino.unlink(); continue
        except Exception:
            f.close(); destino.unlink(); raise
        try:
            with f, j:
                joblib.dump(modelo, f)
                json.dump(metadata, j, ensure_ascii=False, indent=2)
            return destino, resumen
        except Exception:
            destino.unlink(missing_ok=True); resumen.unlink(missing_ok=True); raise
    raise ValueError("No se pudo reservar un nombre de modelo disponible")


def entrenar(solicitud, carpeta):
    estado = carpeta / "estado.json"
    inicio = time.monotonic()
    escribir_json(estado, {"estado": "entrenando"})
    try:
        X, y, resumen = leer_csv(Path(solicitud["entrada"]))
        parametros = solicitud.get("parametros", {})
        modelo = crear_modelo(solicitud["algoritmo"], parametros, len(y))
        modelo.fit(X, y)
        metadata = {"algoritmo": solicitud["algoritmo"], "parametros": parametros,
            "entrada": solicitud["entrada"], "caracteristicas": list(COLUMNAS_CARACTERISTICAS),
            "resumen": resumen, "fechaUtc": datetime.now(timezone.utc).isoformat(),
            "sklearn": sklearn.__version__, "duracion_segundos": time.monotonic()-inicio,
            "evaluacion": None}
        joblib.dump(modelo, carpeta / "modelo.joblib")
        escribir_json(carpeta / "modelo.json", metadata)
        if solicitud.get("directorioSalida"):
            modelo_salida, json_salida = exportar(modelo, metadata, Path(solicitud["directorioSalida"]), solicitud["nombre"])
        else:
            modelo_salida, json_salida = carpeta / "modelo.joblib", carpeta / "modelo.json"
        escribir_json(estado, {"estado": "completado", "rutaModelo": str(modelo_salida), "rutaResumen": str(json_salida), **metadata})
    except Exception as error:
        escribir_json(estado, {"estado": "error", "error": str(error)})
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="accion", required=True)
    inspeccion = sub.add_parser("inspeccionar"); inspeccion.add_argument("ruta", type=Path)
    trabajo = sub.add_parser("entrenar"); trabajo.add_argument("solicitud", type=Path)
    args = parser.parse_args()
    if args.accion == "inspeccionar":
        print(json.dumps(leer_csv(args.ruta)[2], ensure_ascii=False))
    else:
        entrenar(json.loads(args.solicitud.read_text(encoding="utf-8")), args.solicitud.parent)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        import sys
        print(str(error), file=sys.stderr)
        sys.exit(1)

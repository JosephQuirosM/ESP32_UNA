#!/usr/bin/env python3
"""Reproduce predicciones del CSV de calibración y genera un mapa 3×3."""

from __future__ import annotations

import argparse
import csv
import os
import tempfile
from collections import Counter, deque
from pathlib import Path

import joblib
# El entorno de desarrollo puede tener HOME de sólo lectura; no persiste cache en él.
os.environ.setdefault("MPLCONFIGDIR", str(Path(tempfile.gettempdir()) / "esp32_una_matplotlib"))
import matplotlib.pyplot as plt
import numpy as np

from mvp_config import COLUMNAS_CARACTERISTICAS, COORDENADAS_ZONA


def cargar_completas(ruta: Path) -> list[dict[str, str]]:
    with ruta.open(newline="", encoding="utf-8") as flujo:
        return [fila for fila in csv.DictReader(flujo) if fila["completo"] == "1"]


def suavizar(predicciones: list[int], ventana: int) -> list[int]:
    """Mayoría móvil causal; los empates favorecen la predicción más reciente."""
    historial: deque[int] = deque(maxlen=ventana)
    resultado: list[int] = []
    for prediccion in predicciones:
        historial.append(prediccion)
        frecuencias = Counter(historial)
        mejor = max(reversed(historial), key=lambda zona: (frecuencias[zona], zona == prediccion))
        resultado.append(mejor)
    return resultado


def escribir_predicciones(ruta: Path, filas: list[dict[str, str]], predichas: list[int], suaves: list[int], confianza: list[float]) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    columnas = [*filas[0].keys(), "zona_predicha", "zona_predicha_suavizada", "confianza"]
    with ruta.open("w", newline="", encoding="utf-8") as flujo:
        escritor = csv.DictWriter(flujo, fieldnames=columnas)
        escritor.writeheader()
        for fila, predicha, suave, valor_confianza in zip(filas, predichas, suaves, confianza):
            escritor.writerow({
                **fila, "zona_predicha": predicha, "zona_predicha_suavizada": suave,
                "confianza": f"{valor_confianza:.6f}",
            })


def generar_mapa(ruta: Path, conteos: Counter[int], total: int) -> None:
    matriz = np.zeros((3, 3), dtype=float)
    for zona, (columna, fila) in COORDENADAS_ZONA.items():
        matriz[fila, columna] = conteos[zona]
    figura, eje = plt.subplots(figsize=(7, 4.5), constrained_layout=True)
    imagen = eje.imshow(matriz, cmap="YlOrRd")
    for zona, (columna, fila) in COORDENADAS_ZONA.items():
        conteo = conteos[zona]
        porcentaje = 0.0 if total == 0 else 100.0 * conteo / total
        eje.text(columna, fila, f"Zona {zona}\n{conteo} ({porcentaje:.1f}%)", ha="center", va="center")
    eje.set_title("Mapa de calor MVP: predicciones KNN suavizadas")
    eje.set_xticks(range(3), ["Oeste", "Centro", "Este"])
    eje.set_yticks(range(3), ["Norte", "Centro", "Sur"])
    figura.colorbar(imagen, ax=eje, label="Vectores predichos")
    ruta.parent.mkdir(parents=True, exist_ok=True)
    figura.savefig(ruta, dpi=160)
    plt.close(figura)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("entrada", type=Path, help="CSV procesado")
    parser.add_argument("--modelo", type=Path, required=True, help="Modelo .joblib entrenado")
    parser.add_argument("--predicciones", type=Path, required=True, help="CSV de reproducción")
    parser.add_argument("--mapa", type=Path, required=True, help="PNG de mapa de calor")
    parser.add_argument("--ventana", type=int, default=5, help="Ventana causal de mayoría (>=1)")
    args = parser.parse_args()
    if args.ventana < 1:
        parser.error("--ventana debe ser >= 1")
    filas = cargar_completas(args.entrada)
    if not filas:
        raise ValueError("no hay vectores completos para reproducir")
    X = [[float(fila[columna]) for columna in COLUMNAS_CARACTERISTICAS] for fila in filas]
    modelo = joblib.load(args.modelo)
    predichas = [int(valor) for valor in modelo.predict(X).tolist()]
    probabilidades = modelo.predict_proba(X)
    confianza = [float(max(fila)) for fila in probabilidades]
    suaves = suavizar(predichas, args.ventana)
    escribir_predicciones(args.predicciones, filas, predichas, suaves, confianza)
    conteos = Counter(suaves)
    generar_mapa(args.mapa, conteos, len(suaves))
    print(f"vectores={len(suaves)}; conteos_zona={dict(sorted(conteos.items()))}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Reproduce predicciones del CSV de calibración y genera un mapa con cuadrícula configurable."""

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

from mvp_config import COLUMNAS_CARACTERISTICAS
from cuadricula import (crear_cuadricula, validar_cuadricula, coordenadas, comprobar_zonas,
                        resolver_cuadricula, agregar_argumentos, desde_argumentos)


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


def generar_mapa(ruta: Path, conteos: Counter[int], total: int,
                 titulo: str = "Mapa de calor: predicciones suavizadas", cuadricula=None) -> None:
    """Dibuja cada zona en su celda, incluyendo zonas sin predicciones."""
    cuadricula = validar_cuadricula(cuadricula) if cuadricula is not None else crear_cuadricula()
    comprobar_zonas(list(conteos), cuadricula)
    filas, columnas = cuadricula["filas"], cuadricula["columnas"]
    posiciones = coordenadas(cuadricula)
    matriz = np.zeros((filas, columnas), dtype=float)
    for zona, (columna, fila) in posiciones.items():
        matriz[fila, columna] = conteos[zona]
    figura, eje = plt.subplots(figsize=(max(5, columnas * 1.5 + 1), max(3.5, filas * 1.1 + 1)), constrained_layout=True)
    try:
        imagen = eje.imshow(matriz, cmap="YlOrRd", vmin=0, vmax=max(1, float(matriz.max())))
        for zona, (columna, fila) in posiciones.items():
            conteo = conteos[zona]
            porcentaje = 0.0 if total == 0 else 100.0 * conteo / total
            eje.text(columna, fila, f"Zona {zona}\n{conteo} ({porcentaje:.1f}%)", ha="center", va="center",
                     color="white" if conteo > 0 and conteo >= 0.65 * matriz.max() else "#0f1c2d")
        eje.set_title(titulo)
        eje.set_xticks(range(columnas), [str(i + 1) for i in range(columnas)])
        eje.set_yticks(range(filas), [str(i + 1) for i in range(filas)])
        eje.set_xlabel("Columna"); eje.set_ylabel("Fila")
        figura.colorbar(imagen, ax=eje, label="Vectores predichos")
        ruta.parent.mkdir(parents=True, exist_ok=True)
        figura.savefig(ruta, dpi=160)
    finally:
        plt.close(figura)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    agregar_argumentos(parser)
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
    cuadricula = resolver_cuadricula(modelo, desde_argumentos(args), filas)
    predichas = [int(valor) for valor in modelo.predict(X).tolist()]
    comprobar_zonas(predichas, cuadricula)
    probabilidades = modelo.predict_proba(X)
    confianza = [float(max(fila)) for fila in probabilidades]
    suaves = suavizar(predichas, args.ventana)
    escribir_predicciones(args.predicciones, filas, predichas, suaves, confianza)
    conteos = Counter(suaves)
    generar_mapa(args.mapa, conteos, len(suaves), cuadricula=cuadricula)
    print(f"vectores={len(suaves)}; conteos_zona={dict(sorted(conteos.items()))}")


if __name__ == "__main__":
    main()

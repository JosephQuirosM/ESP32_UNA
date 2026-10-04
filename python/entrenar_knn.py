#!/usr/bin/env python3
"""Entrena y evalúa el KNN MVP sin dividir filas temporalmente correlacionadas."""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path
from typing import Any

import joblib
from sklearn.metrics import accuracy_score, confusion_matrix
from sklearn.model_selection import LeaveOneGroupOut
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from mvp_config import COLUMNAS_CARACTERISTICAS, COORDENADAS_ZONA, son_zonas_vecinas

CANDIDATOS_K = (1, 3, 5, 7, 9, 11, 15)


def cargar_dataset(ruta: Path) -> tuple[list[list[float]], list[int], list[str], list[dict[str, str]]]:
    """Lee vectores completos y agrupa estrictamente por sesión física."""
    X: list[list[float]] = []
    y: list[int] = []
    grupos: list[str] = []
    filas: list[dict[str, str]] = []
    with ruta.open(newline="", encoding="utf-8") as flujo:
        lector = csv.DictReader(flujo)
        requeridas = {"sesion_gateway", "jugador_id", "sesion_jugador", "zona", "completo", *COLUMNAS_CARACTERISTICAS}
        faltantes = requeridas - set(lector.fieldnames or [])
        if faltantes:
            raise ValueError(f"faltan columnas procesadas: {', '.join(sorted(faltantes))}")
        for numero, fila in enumerate(lector, start=2):
            if fila["completo"] != "1":
                continue
            try:
                vector = [float(fila[columna]) for columna in COLUMNAS_CARACTERISTICAS]
                zona = int(fila["zona"])
            except ValueError as error:
                raise ValueError(f"fila {numero}: RSSI o zona inválidos") from error
            if zona not in COORDENADAS_ZONA:
                raise ValueError(f"fila {numero}: zona fuera de 1..9")
            X.append(vector)
            y.append(zona)
            grupos.append(
                f"gateway={fila['sesion_gateway']};jugador={fila['jugador_id']};arranque={fila['sesion_jugador']}"
            )
            filas.append(fila)
    if not X:
        raise ValueError("no hay vectores completos para entrenar")
    if len(set(grupos)) < 2:
        raise ValueError("se requieren al menos dos sesiones para evaluar")
    return X, y, grupos, filas


def crear_modelo(k: int) -> Pipeline:
    return Pipeline([
        ("normalizar", StandardScaler()),
        ("knn", KNeighborsClassifier(n_neighbors=k, weights="distance", p=2)),
    ])


def _metricas(y_real: list[int], y_pred: list[int]) -> dict[str, float]:
    exactitud = accuracy_score(y_real, y_pred)
    vecinas = sum(
        real == predicha or son_zonas_vecinas(real, predicha)
        for real, predicha in zip(y_real, y_pred)
    ) / len(y_real)
    distancia_media = sum(
        abs(COORDENADAS_ZONA[real][0] - COORDENADAS_ZONA[predicha][0])
        + abs(COORDENADAS_ZONA[real][1] - COORDENADAS_ZONA[predicha][1])
        for real, predicha in zip(y_real, y_pred)
    ) / len(y_real)
    return {"exactitud": exactitud, "exactitud_vecina": vecinas, "distancia_manhattan_media": distancia_media}


def validar_por_sesion(X: list[list[float]], y: list[int], grupos: list[str], k: int) -> tuple[dict[str, float], list[dict[str, Any]]]:
    """Leave-one-session-out: no mezcla una misma sesión entre train y prueba."""
    logo = LeaveOneGroupOut()
    predicciones = [0] * len(y)
    detalles: list[dict[str, Any]] = []
    for indices_entrenamiento, indices_prueba in logo.split(X, y, grupos):
        modelo = crear_modelo(k)
        modelo.fit([X[i] for i in indices_entrenamiento], [y[i] for i in indices_entrenamiento])
        predichas = modelo.predict([X[i] for i in indices_prueba]).tolist()
        for indice, predicha in zip(indices_prueba, predichas):
            predicciones[indice] = int(predicha)
        grupo = grupos[indices_prueba[0]]
        detalles.append({"sesion_retenida": grupo, "muestras": len(indices_prueba), **_metricas([y[i] for i in indices_prueba], predichas)})
    return _metricas(y, predicciones), detalles


def seleccionar_k(X: list[list[float]], y: list[int], grupos: list[str]) -> tuple[int, dict[str, Any]]:
    resultados: dict[str, Any] = {}
    for k in CANDIDATOS_K:
        metricas, detalles = validar_por_sesion(X, y, grupos, k)
        resultados[str(k)] = {"global": metricas, "sesiones": detalles}
    mejor = max(CANDIDATOS_K, key=lambda k: (resultados[str(k)]["global"]["exactitud"], -k))
    return mejor, resultados


def generar_informe(
    ruta: Path, entrada: Path, k: int, resultados: dict[str, Any], y: list[int], predicciones: list[int]
) -> None:
    matriz = confusion_matrix(y, predicciones, labels=range(1, 10))
    global_mejor = resultados[str(k)]["global"]
    lineas = [
        "# Evaluación KNN del MVP RSSI", "", f"Entrada procesada: `{entrada}`", "",
        "## Protocolo de evaluación", "",
        "La validación usa *leave-one-session-out*: se retiene por completo una sesión de captura "
        "(incluida su orientación fija) y nunca se mezclan filas de esa sesión entre entrenamiento y prueba. "
        "Es una evaluación de MVP; no representa precisión de producción.", "",
        f"Muestras completas: {len(y)}", f"Distribución por zona: {dict(sorted(Counter(y).items()))}",
        f"K seleccionado: {k} (ponderación por distancia y normalización estándar).", "",
        "## Métricas reteniendo sesiones", "",
        f"- Exactitud de zona: {global_mejor['exactitud']:.2%}",
        f"- Exactitud exacta o zona vecina: {global_mejor['exactitud_vecina']:.2%}",
        f"- Distancia Manhattan media: {global_mejor['distancia_manhattan_media']:.3f} celdas", "",
        "## Comparación de K", "", "| K | Exactitud | Exacta o vecina | Distancia media |", "|---:|---:|---:|---:|",
    ]
    for candidato in CANDIDATOS_K:
        metricas = resultados[str(candidato)]["global"]
        lineas.append(
            f"| {candidato} | {metricas['exactitud']:.2%} | {metricas['exactitud_vecina']:.2%} | "
            f"{metricas['distancia_manhattan_media']:.3f} |"
        )
    lineas += ["", "## Matriz de confusión", "", "Filas: zona real. Columnas: zona predicha.", "", "| Real \\ Pred. | " + " | ".join(map(str, range(1, 10))) + " |", "|---:|" + "---:|" * 9]
    for zona, fila in enumerate(matriz, start=1):
        lineas.append(f"| {zona} | " + " | ".join(map(str, fila)) + " |")
    lineas += ["", "Las predicciones detalladas y el mapa reproducible se generan con `reproducir_mapa_calor.py`."]
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text("\n".join(lineas) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("entrada", type=Path, help="CSV generado por preprocesar_calibracion.py")
    parser.add_argument("--modelo", type=Path, required=True, help="Destino .joblib")
    parser.add_argument("--metricas", type=Path, required=True, help="Informe Markdown de evaluación")
    parser.add_argument("--metadata", type=Path, required=True, help="JSON con el contrato del modelo")
    args = parser.parse_args()
    X, y, grupos, _ = cargar_dataset(args.entrada)
    k, resultados = seleccionar_k(X, y, grupos)
    metricas, _ = validar_por_sesion(X, y, grupos, k)

    # Predicciones OOF para la matriz de confusión del K finalmente elegido.
    logo = LeaveOneGroupOut()
    predicciones = [0] * len(y)
    for train, test in logo.split(X, y, grupos):
        modelo_cv = crear_modelo(k).fit([X[i] for i in train], [y[i] for i in train])
        for indice, predicha in zip(test, modelo_cv.predict([X[i] for i in test]).tolist()):
            predicciones[indice] = int(predicha)

    modelo_final = crear_modelo(k).fit(X, y)
    args.modelo.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(modelo_final, args.modelo)
    generar_informe(args.metricas, args.entrada, k, resultados, y, predicciones)
    metadata = {
        "version": 1, "modelo": "KNeighborsClassifier", "k": k,
        "caracteristicas": list(COLUMNAS_CARACTERISTICAS),
        "evaluacion": "leave-one-session-out (sesiones completas con orientación fija)",
        "muestras_completas": len(y), "metricas_oof": metricas,
        "resultados_por_k": resultados,
    }
    args.metadata.parent.mkdir(parents=True, exist_ok=True)
    args.metadata.write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"k": k, **metricas}, ensure_ascii=False))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Entrena y evalúa el KNN MVP sin dividir filas temporalmente correlacionadas."""

from __future__ import annotations

import argparse
import csv
import json
import tempfile
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
    """Lee vectores completos; dataset y sesiones son metadatos opcionales."""
    X: list[list[float]] = []
    y: list[int] = []
    grupos: list[str] = []
    filas: list[dict[str, str]] = []
    with ruta.open(newline="", encoding="utf-8-sig") as flujo:
        lector = csv.DictReader(flujo)
        requeridas = {"zona", "completo", *COLUMNAS_CARACTERISTICAS}
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
                fila.get("dataset") or
                f"gateway={fila.get('sesion_gateway', '')};jugador={fila.get('jugador_id', '')};arranque={fila.get('sesion_jugador', '')}"
            )
            filas.append(fila)
    if not X:
        raise ValueError("no hay vectores completos para entrenar")
    return X, y, grupos, filas


def cargar_entradas(entradas: list[Path], zona: int | None = None):
    """Combina CSV preparados o crudos, sin exigir datasets o zonas completos."""
    from preprocesar_calibracion import leer_y_preprocesar, guardar_muestras
    archivos = []
    for entrada in entradas:
        encontrados = sorted(entrada.glob("*.csv")) if entrada.is_dir() else [entrada]
        if not encontrados:
            raise ValueError(f"{entrada}: no contiene CSV")
        archivos.extend(encontrados)
    X, y, grupos, filas = [], [], [], []
    with tempfile.TemporaryDirectory() as carpeta:
        temporal = Path(carpeta) / "vectores.csv"
        for archivo in archivos:
            with archivo.open(newline="", encoding="utf-8-sig") as flujo:
                preparado = "completo" in (csv.DictReader(flujo).fieldnames or [])
            if preparado:
                nuevos = cargar_dataset(archivo)
            else:
                muestras, _ = leer_y_preprocesar([archivo], zona=zona)
                guardar_muestras(temporal, muestras)
                nuevos = cargar_dataset(temporal)
            X.extend(nuevos[0]); y.extend(nuevos[1]); grupos.extend(nuevos[2]); filas.extend(nuevos[3])
    if not X:
        raise ValueError("no hay vectores completos para entrenar")
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
        if k > len(y) - max(Counter(grupos).values()):
            continue
        metricas, detalles = validar_por_sesion(X, y, grupos, k)
        resultados[str(k)] = {"global": metricas, "sesiones": detalles}
    mejor = max((int(k) for k in resultados), key=lambda k: (resultados[str(k)]["global"]["exactitud"], -k))
    return mejor, resultados


def generar_informe(
    ruta: Path, entrada: Path, k: int, resultados: dict[str, Any], y: list[int], predicciones: list[int]
) -> None:
    matriz = confusion_matrix(y, predicciones, labels=range(1, 10))
    global_mejor = resultados[str(k)]["global"]
    lineas = [
        "# Evaluación KNN del MVP RSSI", "", f"Entrada procesada: `{entrada}`", "",
        "## Protocolo de evaluación", "",
        "La validación usa *leave-one-session-out*: se retiene por completo un dataset completo "
        "(sus nueve zonas cuando están presentes) y nunca se mezclan filas de esa sesión entre entrenamiento y prueba. "
        "Es una evaluación de MVP; no representa precisión de producción.", "",
        f"Muestras completas: {len(y)}", f"Distribución por zona: {dict(sorted(Counter(y).items()))}",
        f"K seleccionado: {k} (ponderación por distancia y normalización estándar).", "",
        "## Métricas reteniendo sesiones", "",
        f"- Exactitud de zona: {global_mejor['exactitud']:.2%}",
        f"- Exactitud exacta o zona vecina: {global_mejor['exactitud_vecina']:.2%}",
        f"- Distancia Manhattan media: {global_mejor['distancia_manhattan_media']:.3f} celdas", "",
        "## Comparación de K", "", "| K | Exactitud | Exacta o vecina | Distancia media |", "|---:|---:|---:|---:|",
    ]
    for candidato in map(int, resultados):
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
    parser.add_argument("entrada", nargs="+", type=Path, help="CSV crudos por zona, carpetas o uno o más CSV preparados")
    parser.add_argument("--zona", type=int, help="Zona explícita para CSV crudos sin zona en el nombre")
    parser.add_argument("--validar-por-grupo", action="store_true", help="Evaluación opcional por dataset o sesión; no restringe las entradas del entrenamiento")
    parser.add_argument("--k", type=int, default=5, help="Número de vecinos al entrenar sin validación por grupos (por defecto 5)")
    parser.add_argument("--modelo", type=Path, required=True, help="Destino .joblib")
    parser.add_argument("--metricas", type=Path, required=True, help="Informe Markdown de evaluación")
    parser.add_argument("--metadata", type=Path, required=True, help="JSON con el contrato del modelo")
    args = parser.parse_args()
    X, y, grupos, _ = cargar_entradas(args.entrada, zona=args.zona)
    if args.k < 1 or args.k > len(X):
        parser.error("--k debe estar entre 1 y la cantidad de vectores completos")
    if not args.validar_por_grupo or len(set(grupos)) < 2:
        modelo = crear_modelo(args.k).fit(X, y)
        args.modelo.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(modelo, args.modelo)
        args.metricas.parent.mkdir(parents=True, exist_ok=True)
        args.metricas.write_text(
            f"# Entrenamiento KNN\n\nMuestras completas: {len(y)}. K: {args.k}.\n"
            "\nEntrenamiento con todas las entradas seleccionadas, sin evaluación por grupos. "
            "La elección de datos de entrenamiento y prueba corresponde al usuario.\n", encoding="utf-8")
        args.metadata.parent.mkdir(parents=True, exist_ok=True)
        args.metadata.write_text(json.dumps({
            "version": 1, "modelo": "KNeighborsClassifier", "k": args.k,
            "caracteristicas": list(COLUMNAS_CARACTERISTICAS),
            "entradas": [str(p) for p in args.entrada],
            "muestras_completas": len(y), "evaluacion": None,
        }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(json.dumps({"k": args.k, "muestras": len(y), "evaluacion": None}))
        return
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
        "evaluacion": "leave-one-group-out (dataset completo; sesión en CSV antiguos)",
        "muestras_completas": len(y), "metricas_oof": metricas,
        "resultados_por_k": resultados,
    }
    args.metadata.parent.mkdir(parents=True, exist_ok=True)
    args.metadata.write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"k": k, **metricas}, ensure_ascii=False))


if __name__ == "__main__":
    main()

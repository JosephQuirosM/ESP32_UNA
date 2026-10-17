#!/usr/bin/env python3
"""Entrena Random Forest con los CSV seleccionados y evalúa los CSV de prueba."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, confusion_matrix

from entrenar_knn import cargar_entradas
from mvp_config import COLUMNAS_CARACTERISTICAS


def crear_modelo() -> RandomForestClassifier:
    """Configuración fija reproducible; no se ajusta con los datos de prueba."""
    return RandomForestClassifier(n_estimators=300, random_state=42, n_jobs=-1)


def entrenar_y_evaluar(entradas: list[Path], prueba: list[Path], modelo: Path, informe: Path, zona: int | None = None) -> dict:
    X, y, _, _ = cargar_entradas(entradas, zona=zona)
    Xt, yt, _, _ = cargar_entradas(prueba, zona=zona)
    clasificador = crear_modelo().fit(X, y)
    predicciones = [int(z) for z in clasificador.predict(Xt)]
    resultado = {
        "modelo": "RandomForestClassifier", "parametros": clasificador.get_params(),
        "entrenamiento": [str(p) for p in entradas], "prueba": [str(p) for p in prueba],
        "caracteristicas": list(COLUMNAS_CARACTERISTICAS),
        "vectores_entrenamiento": len(y), "vectores_prueba": len(yt),
        "aciertos": sum(a == b for a, b in zip(yt, predicciones)),
        "exactitud": float(accuracy_score(yt, predicciones)),
        "matriz_confusion": confusion_matrix(yt, predicciones, labels=list(range(1, 10))).tolist(),
        "por_zona": {
            str(z): {"total": sum(a == z for a in yt),
                     "aciertos": sum(a == z and a == b for a, b in zip(yt, predicciones))}
            for z in range(1, 10)
        },
        "importancia_caracteristicas": dict(zip(COLUMNAS_CARACTERISTICAS, clasificador.feature_importances_.tolist())),
    }
    modelo.parent.mkdir(parents=True, exist_ok=True)
    informe.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(clasificador, modelo)
    informe.write_text(json.dumps(resultado, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return resultado


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("entradas", nargs="+", type=Path, help="CSV preparados, CSV crudos por zona o carpetas de entrenamiento")
    parser.add_argument("--prueba", nargs="+", type=Path, required=True, help="CSV o carpetas elegidos por el usuario para evaluar")
    parser.add_argument("--zona", type=int, help="Zona explícita para CSV crudos sin zona en el nombre")
    parser.add_argument("--modelo", type=Path, required=True)
    parser.add_argument("--informe", type=Path, required=True)
    args = parser.parse_args()
    resultado = entrenar_y_evaluar(args.entradas, args.prueba, args.modelo, args.informe, zona=args.zona)
    print(json.dumps({k: resultado[k] for k in ("aciertos", "vectores_prueba", "exactitud")}))


if __name__ == "__main__":
    main()

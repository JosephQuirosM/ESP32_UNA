#!/usr/bin/env python3
"""Genera mapas y estadísticas independientes por jugador."""
from __future__ import annotations

import csv
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

os.environ.setdefault("MPLBACKEND", "Agg")
import joblib

from entrenamiento_web import escribir_json
from mvp_config import COLUMNAS_CARACTERISTICAS
from cuadricula import resolver_cuadricula, comprobar_zonas
from preprocesar_calibracion import construir_muestras, COLUMNAS_REQUERIDAS
from reproducir_mapa_calor import suavizar, generar_mapa
from jugadores_mapas import leer_grupos, guardar_lecturas, estadisticas


def cargar_vectores(ruta, permitir_vacio=False):
    with ruta.open(newline="", encoding="utf-8-sig") as f:
        lector = csv.DictReader(f)
        columnas = set(lector.fieldnames or [])
        filas = list(lector)
    if {*COLUMNAS_CARACTERISTICAS, "completo"} <= columnas:
        completas = []
        for numero, fila in enumerate(filas, 2):
            if fila["completo"] == "0": continue
            if fila["completo"] != "1": raise ValueError(f"Fila {numero}: completo debe ser 0 o 1")
            completas.append(fila)
        resumen = {"filas_entrada": len(filas), "vectores_incompletos": len(filas)-len(completas)}
    elif COLUMNAS_REQUERIDAS <= columnas:
        muestras, resumen = construir_muestras(filas, zona=None, archivo_origen=str(ruta))
        completas = [m for m in muestras if m["completo"] == 1]
        claves = ("sesion_gateway", "jugador_id", "sesion_jugador", "secuencia")
        primeras = {}
        for fila in filas:
            clave = tuple(int(fila[k]) for k in claves)
            tiempo = fila["timestamp_utc_pc"]
            primeras[clave] = min(primeras.get(clave, tiempo), tiempo)
        completas.sort(key=lambda f: primeras[tuple(f[k] for k in claves)])
        resumen["vectores_incompletos"] = len(muestras)-len(completas)
    else:
        raise ValueError("El archivo no es un CSV de lecturas RSSI ni un CSV preparado válido")
    if not completas and not permitir_vacio: raise ValueError("El CSV no contiene vectores completos de las cuatro torres")
    X = []
    for numero, fila in enumerate(completas, 1):
        try:
            vector = [float(fila[c]) for c in COLUMNAS_CARACTERISTICAS]
            if not all(math.isfinite(v) for v in vector): raise ValueError()
        except (ValueError, TypeError): raise ValueError(f"Vector {numero}: RSSI inválidos") from None
        X.append(vector)
    return completas, X, resumen


def suavizar_series(filas, predicciones, ventana):
    indices = defaultdict(list)
    for i, fila in enumerate(filas):
        clave = tuple(str(fila.get(k, "")) for k in ("sesion_gateway", "jugador_id", "sesion_jugador"))
        indices[clave].append(i)
    resultado = list(predicciones)
    for grupo in indices.values():
        for i, valor in zip(grupo, suavizar([predicciones[j] for j in grupo], ventana)):
            resultado[i] = valor
    return resultado


def exportar(origenes, carpeta, nombre, sufijos=(".png", "_predicciones.csv", "_resumen.json")):
    for indice in range(1, 10000):
        base = nombre if indice == 1 else f"{nombre}_{indice}"
        destinos = [carpeta/f"{base}{sufijo}" for sufijo in sufijos]
        abiertos = []
        try:
            for destino in destinos: abiertos.append(destino.open("xb"))
        except FileExistsError:
            for f in abiertos: f.close(); Path(f.name).unlink()
            continue
        except Exception:
            for f in abiertos: f.close(); Path(f.name).unlink()
            raise
        try:
            for origen, f in zip(origenes, abiertos):
                with f, origen.open("rb") as lectura:
                    import shutil
                    shutil.copyfileobj(lectura, f)
            return destinos
        except Exception:
            for f in abiertos: f.close(); Path(f.name).unlink(missing_ok=True)
            raise
    raise ValueError("No se pudo reservar un nombre libre para la imagen")


def generar(solicitud, carpeta):
    """Exporta lecturas intactas, mapas aislados y un resumen conjunto."""
    estado = carpeta/"estado.json"
    mapas = []
    base_estado = {"mapas": mapas, "total": len(solicitud["entradas"]), "procesados": 0,
                   "mapasGenerados": 0, "jugadoresProcesados": 0}
    escribir_json(estado, {"estado": "generando", **base_estado})
    try:
        ventana = solicitud["ventana"]
        if isinstance(ventana, bool) or not isinstance(ventana, int) or not 1 <= ventana <= 1000:
            raise ValueError("La ventana debe ser un entero entre 1 y 1000; 1 desactiva el suavizado")
        modelo = joblib.load(solicitud["modelo"])
        if not callable(getattr(modelo, "predict", None)):
            raise ValueError("El archivo seleccionado no contiene un modelo con predict")
        salida = Path(solicitud["directorioSalida"])
        for numero, entrada in enumerate(solicitud["entradas"]):
            ruta = Path(entrada)
            try:
                columnas, crudo, grupos = leer_grupos(ruta)
                for (gateway, jugador), originales in grupos.items():
                    i = len(mapas)
                    lecturas = carpeta/f"mapa_{i}_lecturas.csv"
                    guardar_lecturas(lecturas, columnas, originales)
                    metricas = estadisticas(originales, crudo)
                    filas, X, resumen = cargar_vectores(lecturas, permitir_vacio=True)
                    cuadricula = resolver_cuadricula(modelo, solicitud.get("cuadricula"), originales)
                    try:
                        comprobar_zonas([int(z) for z in getattr(modelo, "classes_", [])], cuadricula)
                    except ValueError as error:
                        raise ValueError("El modelo contiene zonas fuera de la cuadrícula actual; configura filas y columnas para modelos sin geometría") from error
                    valores = modelo.predict(X).tolist() if X else []
                    predichas = [int(v) for v in valores]
                    if any(float(v) != p or p not in cuadricula["zonas"] for v, p in zip(valores, predichas)):
                        raise ValueError("El modelo predice etiquetas fuera de la cuadrícula actual; configura las filas y columnas del modelo")
                    suaves = suavizar_series(filas, predichas, ventana)
                    conteos = Counter(suaves)
                    slug = re.sub(r"[^a-zA-Z0-9_-]", "_", ruta.stem)[:60] or "archivo"
                    base_nombre = solicitud["nombre"] if base_estado["total"] == 1 else f"{solicitud['nombre']}_{numero+1}_{slug}"
                    nombre = f"{base_nombre}_gateway_{gateway}_jugador_{jugador}" if jugador is not None else base_nombre
                    cache = [carpeta/f"mapa_{i}{ext}" for ext in (".png", ".csv", ".json")]
                    titulo_jugador = f"Jugador {jugador} · " if jugador is not None else ""
                    titulo = f"{solicitud['nombre']} · {titulo_jugador}{ruta.name[:65]}\n" + ("Sin suavizado" if ventana == 1 else f"Mayoría móvil de {ventana} predicciones")
                    if X:
                        generar_mapa(cache[0], conteos, len(suaves), titulo, cuadricula)
                    with cache[1].open("w", newline="", encoding="utf-8") as f:
                        identidad = ["sesion_gateway", "jugador_id", "sesion_jugador", "secuencia", "elapsed_s"]
                        columnas_pred = [*identidad, *COLUMNAS_CARACTERISTICAS, "zona_predicha", "zona_predicha_suavizada", "archivo_origen"]
                        w = csv.DictWriter(f, fieldnames=columnas_pred); w.writeheader()
                        for fila, pred, suave in zip(filas, predichas, suaves):
                            w.writerow({**{c: fila.get(c, "") for c in [*identidad, *COLUMNAS_CARACTERISTICAS]},
                                        "zona_predicha":pred, "zona_predicha_suavizada":suave, "archivo_origen":str(ruta)})
                    resultado = {"indice":i, "entrada":str(ruta), "nombre":nombre, "vectores":len(suaves), "ventana":ventana,
                        "jugadorId":jugador, "sesionGateway":gateway, "tieneMapa":bool(X), "estadisticas":metricas,
                        "modelo":solicitud["modelo"], "conteos_sin_suavizar":dict(sorted(Counter(predichas).items())),
                        "cuadricula":cuadricula, "conteos":{str(z):conteos[z] for z in cuadricula["zonas"]}, "preprocesamiento":resumen}
                    escribir_json(cache[2], resultado)
                    origenes = [lecturas, cache[1], cache[2]]
                    sufijos = ["_lecturas.csv", "_predicciones.csv", "_resumen.json"]
                    if X:
                        origenes.append(cache[0]); sufijos.append(".png")
                    exportados = exportar(origenes, salida, nombre, sufijos)
                    mapas.append({**resultado, "rutaLecturas":str(exportados[0]), "rutaPredicciones":str(exportados[1]),
                                  "rutaResumen":str(exportados[2]), "rutaImagen":str(exportados[3]) if X else None})
                    base_estado["mapasGenerados"] += int(bool(X))
                    base_estado["jugadoresProcesados"] = len(mapas)
                    escribir_json(estado, {"estado":"generando", **base_estado})
                base_estado["procesados"] = numero + 1
                escribir_json(estado, {"estado":"generando", **base_estado})
            except Exception as error:
                raise ValueError(f"{ruta.name}: {error}") from error
        resumen_general = [{"entrada":m["entrada"], "sesion_gateway":m["sesionGateway"], "jugador_id":m["jugadorId"],
                            **m["estadisticas"]} for m in mapas]
        json_general = carpeta/"resumen_general.json"
        escribir_json(json_general, {"jugadores":resumen_general, "criterio":"Rangos observados por sesión; cuatro torres por secuencia. null indica métrica no disponible."})
        csv_general = carpeta/"resumen_general.csv"
        guardar_lecturas(csv_general, list(resumen_general[0]), resumen_general)
        destinos = exportar([csv_general, json_general], salida, solicitud["nombre"]+"_resumen_general", [".csv", ".json"])
        base_estado.update(rutaResumenGeneralCsv=str(destinos[0]), rutaResumenGeneralJson=str(destinos[1]))
        escribir_json(estado, {"estado":"completado", **base_estado})
    except Exception as error:
        escribir_json(estado, {"estado":"error", "error":str(error), **base_estado})
        raise


if __name__ == "__main__":
    try:
        ruta = Path(sys.argv[1])
        generar(json.loads(ruta.read_text(encoding="utf-8")), ruta.parent)
    except Exception as error:
        print(str(error), file=sys.stderr); sys.exit(1)

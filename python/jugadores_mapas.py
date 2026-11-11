"""Separa capturas sin alterar sus valores y calcula recepción por jugador."""
from collections import defaultdict
import csv
from pathlib import Path
import shutil

from config_rssi import MAC_A_CARACTERISTICA, normalizar_mac, COLUMNAS_CARACTERISTICAS
from preprocesar_calibracion import COLUMNAS_REQUERIDAS


def leer_grupos(ruta):
    """Valida la entrada y agrupa identidades dentro de cada arranque del Gateway."""
    with Path(ruta).open(newline="", encoding="utf-8-sig") as f:
        lector = csv.DictReader(f)
        columnas = list(lector.fieldnames or [])
        filas = list(lector)
    if len(columnas) != len(set(columnas)):
        raise ValueError("El CSV contiene nombres de columnas repetidos")
    crudo = COLUMNAS_REQUERIDAS <= set(columnas)
    preparado = {*COLUMNAS_CARACTERISTICAS, "completo"} <= set(columnas)
    if not crudo and not preparado:
        raise ValueError("El archivo no es un CSV de lecturas RSSI ni un CSV preparado válido")
    if not filas:
        raise ValueError("El CSV no contiene lecturas")
    grupos = defaultdict(list)
    for numero, fila in enumerate(filas, 2):
        if None in fila or any(v is None for v in fila.values()):
            raise ValueError(f"Fila {numero}: número de columnas inválido")
        try:
            gateway = int(fila["sesion_gateway"]) if "sesion_gateway" in columnas else None
            jugador = int(fila["jugador_id"]) if "jugador_id" in columnas else None
            for clave in ("sesion_jugador", "secuencia", "torre_id"):
                if clave in columnas and int(fila[clave]) < 0:
                    raise ValueError()
            if (gateway is not None and gateway <= 0) or (jugador is not None and jugador <= 0):
                raise ValueError()
        except ValueError:
            raise ValueError(f"Fila {numero}: identidad, sesión o secuencia inválida") from None
        grupos[(gateway, jugador)].append(fila)
    por_gateway = defaultdict(set)
    for gateway, jugador in grupos:
        por_gateway[gateway].add(jugador)
    if any(len(jugadores) > 10 for jugadores in por_gateway.values()):
        raise ValueError("Se admiten como máximo 10 jugadores por sesión del Gateway")
    for filas_grupo in grupos.values():
        filas_grupo.sort(key=lambda f: tuple(int(f.get(c, "0")) for c in ("sesion_jugador", "secuencia", "torre_id")))
    return columnas, crudo, grupos


def guardar_lecturas(ruta, columnas, filas):
    """Conserva todas las columnas y valores, incluidos duplicados."""
    with ruta.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=columnas)
        w.writeheader()
        w.writerows(filas)


def exportar(origenes, carpeta, nombre, sufijos):
    """Copia un conjunto de resultados con un nombre libre, sin sobrescribir."""
    for indice in range(1, 10000):
        base = nombre if indice == 1 else f"{nombre}_{indice}"
        destinos = [carpeta / f"{base}{sufijo}" for sufijo in sufijos]
        abiertos = []
        try:
            for destino in destinos:
                abiertos.append(destino.open("xb"))
        except FileExistsError:
            for archivo in abiertos:
                archivo.close()
                Path(archivo.name).unlink()
            continue
        except Exception:
            for archivo in abiertos:
                archivo.close()
                Path(archivo.name).unlink()
            raise
        try:
            for origen, archivo in zip(origenes, abiertos):
                with archivo, origen.open("rb") as lectura:
                    shutil.copyfileobj(lectura, archivo)
            return destinos
        except Exception:
            for archivo in abiertos:
                archivo.close()
                Path(archivo.name).unlink(missing_ok=True)
            raise
    raise ValueError("No se pudo reservar un nombre de salida disponible")


def estadisticas(filas, crudo):
    """Estima recepción sólo dentro del rango observado de cada sesión."""
    resultado = dict(total_recibido=len(filas), paquetes_esperados=None,
        paquetes_unicos_recibidos=None, recepcion_porcentaje=None,
        secuencias_esperadas=None, secuencias_observadas=None,
        vectores_completos=None, vectores_completos_porcentaje=None,
        duplicados=None, secuencias_ausentes=None, vectores_incompletos=None)
    if not crudo:
        completos = sum(f["completo"] == "1" for f in filas)
        resultado.update(vectores_completos=completos, vectores_incompletos=len(filas)-completos)
        return resultado
    sesiones = defaultdict(dict)
    unicos = set()
    for fila in filas:
        mac = normalizar_mac(fila["mac_torre"])
        if mac not in MAC_A_CARACTERISTICA:
            raise ValueError(f"MAC de torre no registrada: {mac}")
        sesion, secuencia = int(fila["sesion_jugador"]), int(fila["secuencia"])
        sesiones[sesion].setdefault(secuencia, set()).add(mac)
        unicos.add((sesion, secuencia, mac))
    esperadas = sum(max(s)-min(s)+1 for s in sesiones.values())
    observadas = sum(len(s) for s in sesiones.values())
    completos = sum(len(torres) == 4 for s in sesiones.values() for torres in s.values())
    resultado.update(paquetes_esperados=esperadas*4, paquetes_unicos_recibidos=len(unicos),
        recepcion_porcentaje=100*len(unicos)/(esperadas*4), secuencias_esperadas=esperadas,
        secuencias_observadas=observadas, vectores_completos=completos,
        vectores_completos_porcentaje=100*completos/esperadas,
        duplicados=len(filas)-len(unicos), secuencias_ausentes=esperadas-observadas,
        vectores_incompletos=observadas-completos)
    return resultado

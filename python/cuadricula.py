"""Geometría rectangular compartida por preparación, modelos y mapas."""
from __future__ import annotations

import json
from pathlib import Path

MAXIMO_DIMENSION = 20


def crear_cuadricula(filas=3, columnas=3, zonas=None):
    """Crea una matriz serpentina o valida un acomodo explícito de 1..N."""
    if any(type(v) is not int or not 1 <= v <= MAXIMO_DIMENSION for v in (filas, columnas)):
        raise ValueError("La cuadrícula requiere de 1 a 20 filas y columnas")
    if zonas is None:
        zonas = []
        for fila in range(filas):
            valores = list(range(fila * columnas + 1, (fila + 1) * columnas + 1))
            zonas.extend(valores[::-1] if fila % 2 else valores)
    if (not isinstance(zonas, list) or len(zonas) != filas * columnas or
            any(type(z) is not int for z in zonas) or sorted(zonas) != list(range(1, filas * columnas + 1))):
        raise ValueError("La cuadrícula debe contener cada zona 1..N una sola vez")
    return {"filas": filas, "columnas": columnas, "zonas": list(zonas)}


def validar_cuadricula(valor):
    """Normaliza la geometría sin asumir dimensiones ausentes."""
    if isinstance(valor, str):
        try:
            valor = json.loads(valor)
        except ValueError as error:
            raise ValueError("Metadatos de cuadrícula inválidos") from error
    if not isinstance(valor, dict) or not {"filas", "columnas", "zonas"} <= valor.keys():
        raise ValueError("Indica filas, columnas y zonas de la cuadrícula")
    return crear_cuadricula(valor["filas"], valor["columnas"], valor["zonas"])


def combinar_cuadriculas(*valores):
    """Acepta una geometría común y rechaza capturas con acomodos diferentes."""
    resultado = None
    for valor in valores:
        if valor is None or valor == "":
            continue
        actual = validar_cuadricula(valor)
        if resultado is not None and resultado != actual:
            raise ValueError("Los archivos tienen cuadrículas diferentes; prepara y entrena cada geometría por separado")
        resultado = actual
    return resultado


def cuadricula_de_filas(filas, explicita=None):
    """Recupera la geometría embebida en CSV y comprueba su consistencia."""
    return combinar_cuadriculas(explicita, *(fila.get("cuadricula") for fila in filas))


def coordenadas(cuadricula):
    return {zona: (i % cuadricula["columnas"], i // cuadricula["columnas"])
            for i, zona in enumerate(cuadricula["zonas"])}


def comprobar_zonas(zonas, cuadricula=None):
    """Valida etiquetas positivas y, si se conoce, su pertenencia a la matriz."""
    if any(type(z) is not int or z < 1 for z in zonas):
        raise ValueError("Las zonas deben ser enteros positivos")
    if cuadricula and any(z not in cuadricula["zonas"] for z in zonas):
        raise ValueError("Hay zonas fuera de la cuadrícula configurada")


def resolver_cuadricula(modelo, explicita=None, filas=()):
    """Usa la geometría del modelo/CSV; conserva 3×3 para modelos antiguos."""
    return combinar_cuadriculas(getattr(modelo, "cuadricula_", None), explicita,
                               cuadricula_de_filas(filas)) or crear_cuadricula()


def agregar_argumentos(parser):
    parser.add_argument("--filas", type=int, help="Filas de la cuadrícula (1–20; requiere --columnas)")
    parser.add_argument("--columnas", type=int, help="Columnas de la cuadrícula (1–20; requiere --filas)")
    parser.add_argument("--cuadricula", type=Path, help="JSON con filas, columnas y zonas para un acomodo personalizado")


def desde_argumentos(args):
    if args.cuadricula:
        if args.filas is not None or args.columnas is not None:
            raise ValueError("Usa --cuadricula o --filas y --columnas, no ambos")
        return validar_cuadricula(args.cuadricula.read_text(encoding="utf-8"))
    if args.filas is not None or args.columnas is not None:
        return crear_cuadricula(args.filas, args.columnas)
    return None

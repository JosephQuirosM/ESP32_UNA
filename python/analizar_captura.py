#!/usr/bin/env python3
"""Resume capturas RSSI v2/v3 y diagnostica los enlaces cuando existen campos v3."""

from __future__ import annotations

import argparse
import csv
import re
from collections import Counter, defaultdict
from pathlib import Path

COLUMNAS_BASE = {
    "timestamp_utc_pc",
    "sesion_gateway",
    "tiempo_gateway_recepcion_ms",
    "tiempo_torre_ms",
    "torre_id",
    "mac_torre",
    "jugador_id",
    "sesion_jugador",
    "secuencia",
    "rssi",
}
COLUMNAS_DIAGNOSTICO_ENLACE = {"sesion_torre", "secuencia_torre_tx"}
COLUMNAS_REQUERIDAS = COLUMNAS_BASE | COLUMNAS_DIAGNOSTICO_ENLACE


def parsear_torres(texto: str) -> set[int]:
    """Convierte una lista de IDs separada por comas en un conjunto validado."""
    try:
        torres = {int(valor) for valor in texto.split(",") if valor}
    except ValueError as error:
        raise argparse.ArgumentTypeError("--torres debe contener IDs numéricos separados por comas") from error
    if not torres or any(torre < 1 or torre > 254 for torre in torres):
        raise argparse.ArgumentTypeError("los IDs de torre deben estar entre 1 y 254")
    return torres


def leer_metricas_gateway(ruta: Path | None) -> str:
    """Extrae el último resumen completo publicado por el Gateway."""
    if ruta is None:
        return "No medida: entregue --log-gateway con la salida serial del Gateway."
    if not ruta.exists():
        return f"No medida: no existe el log serial {ruta}."
    coincidencias = re.findall(r"^Gateway: .+$", ruta.read_text(encoding="utf-8"), re.MULTILINE)
    if not coincidencias:
        return "No medidas: el log serial no contiene una línea de resumen del Gateway."
    return coincidencias[-1]


def leer_metricas_torres(rutas: list[Path] | None) -> list[str]:
    """Extrae el último resumen de cada log serial de torre."""
    if not rutas:
        return ["- No medidas: entregue una opción --log-torre por cada torre."]
    resultados: list[str] = []
    for ruta in rutas:
        if not ruta.exists():
            resultados.append(f"- No existe `{ruta}`.")
            continue
        coincidencias = re.findall(r"^Torre: .+$", ruta.read_text(encoding="utf-8"), re.MULTILINE)
        if coincidencias:
            resultados.append(f"- `{ruta}`: {coincidencias[-1]}")
        else:
            resultados.append(f"- `{ruta}`: no contiene una línea de resumen de torre.")
    return resultados


def analizar(
    archivo: Path,
    torres_esperadas: set[int],
    log_gateway: Path | None = None,
    logs_torres: list[Path] | None = None,
) -> str:
    """Calcula completitud, duplicados y cobertura de torres sin depender de pandas."""
    with archivo.open(newline="", encoding="utf-8") as flujo:
        lector = csv.DictReader(flujo)
        columnas = set(lector.fieldnames or [])
        faltantes = COLUMNAS_BASE - columnas
        if faltantes:
            raise ValueError(f"faltan columnas requeridas: {', '.join(sorted(faltantes))}")

        lecturas_por_torre: Counter[int] = Counter()
        filas_por_sesion: Counter[tuple[int, int, int]] = Counter()
        lecturas_por_torre_sesion: dict[tuple[int, int, int], Counter[int]] = defaultdict(Counter)
        timestamps_por_sesion: dict[tuple[int, int, int], list[str]] = defaultdict(list)
        secuencias: dict[tuple[int, int, int, int], set[int]] = defaultdict(set)
        secuencias_emitidas: dict[tuple[int, int, int], list[int]] = defaultdict(list)
        observaciones: set[tuple[int, int, int, int, int]] = set()
        secuencias_tx_por_sesion_torre: dict[tuple[int, int, int], Counter[int]] = defaultdict(
            Counter
        )
        diagnostico_enlace_disponible = COLUMNAS_DIAGNOSTICO_ENLACE.issubset(columnas)
        duplicados = 0
        filas = 0
        for fila in lector:
            try:
                sesion_gateway = int(fila["sesion_gateway"])
                jugador = int(fila["jugador_id"])
                sesion_jugador = int(fila["sesion_jugador"])
                secuencia = int(fila["secuencia"])
                torre = int(fila["torre_id"])
                if diagnostico_enlace_disponible:
                    sesion_torre = int(fila["sesion_torre"])
                    secuencia_torre_tx = int(fila["secuencia_torre_tx"])
            except ValueError as error:
                raise ValueError(f"fila {filas + 2}: contiene un identificador no numérico") from error
            filas += 1
            if diagnostico_enlace_disponible:
                secuencias_tx_por_sesion_torre[(sesion_gateway, torre, sesion_torre)][
                    secuencia_torre_tx
                ] += 1
            clave_sesion = (sesion_gateway, jugador, sesion_jugador)
            filas_por_sesion[clave_sesion] += 1
            lecturas_por_torre_sesion[clave_sesion][torre] += 1
            timestamps_por_sesion[clave_sesion].append(fila["timestamp_utc_pc"])
            clave_observacion = (sesion_gateway, jugador, sesion_jugador, secuencia, torre)
            if clave_observacion in observaciones:
                duplicados += 1
                continue
            observaciones.add(clave_observacion)
            lecturas_por_torre[torre] += 1
            secuencias[(sesion_gateway, jugador, sesion_jugador, secuencia)].add(torre)
            secuencias_emitidas[(sesion_gateway, jugador, sesion_jugador)].append(secuencia)

    completas = sum(1 for torres in secuencias.values() if torres_esperadas.issubset(torres))
    minimo_cobertura_parcial = min(3, len(torres_esperadas))
    parciales_utiles = sum(
        1
        for torres in secuencias.values()
        if len(torres_esperadas.intersection(torres)) >= minimo_cobertura_parcial
    )
    total_secuencias = len(secuencias)
    emitidas_estimadas = sum(max(valores) - min(valores) + 1 for valores in secuencias_emitidas.values())
    completitud = 0.0 if total_secuencias == 0 else completas * 100 / total_secuencias
    cobertura_parcial = (
        0.0 if total_secuencias == 0 else parciales_utiles * 100 / total_secuencias
    )
    lineas_torres = [
        f"- Torre {torre}: {lecturas_por_torre[torre]} lecturas"
        for torre in sorted(torres_esperadas)
    ]
    lineas_sesiones: list[str] = []
    for clave_sesion in sorted(filas_por_sesion):
        sesion_gateway, jugador, sesion_jugador = clave_sesion
        secuencias_sesion = {
            secuencia: torres
            for (gateway, player, boot, secuencia), torres in secuencias.items()
            if (gateway, player, boot) == clave_sesion
        }
        completas_sesion = sum(
            1 for torres in secuencias_sesion.values() if torres_esperadas.issubset(torres)
        )
        total_sesion = len(secuencias_sesion)
        porcentaje_sesion = 0.0 if total_sesion == 0 else completas_sesion * 100 / total_sesion
        secuencias_observadas = sorted(secuencias_sesion)
        estimadas_sesion = (
            secuencias_observadas[-1] - secuencias_observadas[0] + 1
            if secuencias_observadas
            else 0
        )
        timestamps = timestamps_por_sesion[clave_sesion]
        torres_sesion = ", ".join(
            f"T{torre}={lecturas_por_torre_sesion[clave_sesion][torre]}"
            for torre in sorted(torres_esperadas)
        )
        lineas_sesiones.append(
            f"- Gateway {sesion_gateway}, jugador {jugador}, sesión de arranque {sesion_jugador}: "
            f"{timestamps[0]} a {timestamps[-1]}; filas={filas_por_sesion[clave_sesion]}, "
            f"secuencias={total_sesion}, estimadas_por_rango={estimadas_sesion}, "
            f"completas={completas_sesion} ({porcentaje_sesion:.2f} %); {torres_sesion}"
        )
    lineas_enlace: list[str] = []
    faltantes_tx_totales = 0
    esperadas_tx_totales = 0
    duplicados_tx_totales = 0
    if diagnostico_enlace_disponible:
        for (sesion_gateway, torre, sesion_torre), contador in sorted(
            secuencias_tx_por_sesion_torre.items()
        ):
            observadas_tx = sorted(contador)
            esperadas_tx = observadas_tx[-1] - observadas_tx[0] + 1
            faltantes_tx = esperadas_tx - len(observadas_tx)
            duplicados_tx = sum(cantidad - 1 for cantidad in contador.values())
            cobertura = 100.0 * len(observadas_tx) / esperadas_tx
            faltantes_tx_totales += faltantes_tx
            esperadas_tx_totales += esperadas_tx
            duplicados_tx_totales += duplicados_tx
            lineas_enlace.append(
                f"- Gateway {sesion_gateway}, torre {torre}, sesión de torre {sesion_torre}: "
                f"recibidas={len(observadas_tx)}, rango={observadas_tx[0]}..{observadas_tx[-1]}, "
                f"huecos_internos={faltantes_tx}, cobertura={cobertura:.2f} %, "
                f"duplicados_tx={duplicados_tx}"
            )
        cobertura_tx_total = (
            0.0
            if esperadas_tx_totales == 0
            else 100.0 * (esperadas_tx_totales - faltantes_tx_totales) / esperadas_tx_totales
        )
        resumen_enlace = (
            f"Cobertura agregada Torre → Gateway: {cobertura_tx_total:.2f} %; "
            f"huecos internos={faltantes_tx_totales}; duplicados de secuencia de torre="
            f"{duplicados_tx_totales}."
        )
    else:
        resumen_enlace = (
            "No disponible: el CSV es v2 y no contiene sesion_torre ni secuencia_torre_tx."
        )
    return "\n".join(
        [
            "# Informe de captura RSSI",
            "",
            f"Archivo: `{archivo}`",
            f"Filas leídas: {filas}",
            f"Paquetes emitidos estimados por rangos de secuencia: {emitidas_estimadas}",
            f"Secuencias observadas: {total_secuencias}",
            f"Secuencias completas ({len(torres_esperadas)} torres): {completas} ({completitud:.2f} %)",
            f"Secuencias con {minimo_cobertura_parcial} o más torres esperadas: "
            f"{parciales_utiles} ({cobertura_parcial:.2f} %)",
            f"Duplicados de (sesión, jugador, secuencia, torre): {duplicados}",
            "",
            "## Sesiones de jugador",
            "",
            *lineas_sesiones,
            "",
            "## Lecturas por torre",
            "",
            *lineas_torres,
            "",
            "## Diagnóstico Torre → Gateway",
            "",
            resumen_enlace,
            *lineas_enlace,
            "",
            "## Métricas del Gateway",
            "",
            "Los descartes de cola, entrega y reintentos se leen del monitor serial del Gateway.",
            f"Último resumen: {leer_metricas_gateway(log_gateway)}",
            "",
            "## Métricas de las torres",
            "",
            *leer_metricas_torres(logs_torres),
        ]
    ) + "\n"


def argumentos() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Genera el informe de una captura RSSI v2/v3.")
    parser.add_argument("archivo", type=Path, help="CSV real generado por receptor_gateway.py")
    parser.add_argument("--torres", type=parsear_torres, default={1, 2, 3, 4})
    parser.add_argument("--log-gateway", type=Path, help="Log de monitor serial del Gateway")
    parser.add_argument(
        "--log-torre",
        type=Path,
        action="append",
        help="Log serial de una torre; repita la opción para las cuatro torres",
    )
    parser.add_argument("--salida", type=Path, help="Archivo Markdown de salida; por defecto usa stdout")
    return parser.parse_args()


def main() -> int:
    args = argumentos()
    informe = analizar(args.archivo, args.torres, args.log_gateway, args.log_torre)
    if args.salida is None:
        print(informe, end="")
    else:
        args.salida.parent.mkdir(parents=True, exist_ok=True)
        args.salida.write_text(informe, encoding="utf-8")
        print(f"Informe guardado en {args.salida}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

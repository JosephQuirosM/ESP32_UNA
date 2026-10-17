"""Contrato estable del MVP KNN para el mapa de calor RSSI.

La identidad física de una torre es su MAC. Los IDs asignados por el Gateway
son dinámicos y no deben usarse como características ni como etiquetas.
"""

from __future__ import annotations

from typing import Final

DURACION_ZONA_SEGUNDOS: Final = 60.0
EXCLUSION_TRANSICION_SEGUNDOS: Final = 6.0
ZONAS_EN_ORDEN: Final = tuple(range(1, 10))

COLUMNAS_CARACTERISTICAS: Final = (
    "rssi_sup_izq",
    "rssi_sup_der",
    "rssi_inf_izq",
    "rssi_inf_der",
)

# Fuente: docs/mapa_torres_fisicas.md.
MAC_A_CARACTERISTICA: Final = {
    "10:06:1C:D5:95:04": "rssi_sup_izq",
    "90:15:06:5A:30:D0": "rssi_sup_der",
    "10:06:1C:D5:95:8C": "rssi_inf_izq",
    "10:06:1C:D4:8F:C4": "rssi_inf_der",
}

# (columna, fila), con origen visual en la esquina superior izquierda.
COORDENADAS_ZONA: Final = {
    1: (0, 0), 2: (1, 0), 3: (2, 0),
    6: (0, 1), 5: (1, 1), 4: (2, 1),
    7: (0, 2), 8: (1, 2), 9: (2, 2),
}


def normalizar_mac(mac: str) -> str:
    """Normaliza una MAC para buscarla sin depender de mayúsculas."""
    return mac.strip().upper().replace("-", ":")


def zona_por_tiempo(elapsed_s: float) -> int:
    """Devuelve la zona 1..9 según el recorrido temporal de una sesión."""
    return int(elapsed_s // DURACION_ZONA_SEGUNDOS) + 1


def son_zonas_vecinas(zona_a: int, zona_b: int) -> bool:
    """Indica si dos zonas comparten lado (no sólo esquina)."""
    columna_a, fila_a = COORDENADAS_ZONA[zona_a]
    columna_b, fila_b = COORDENADAS_ZONA[zona_b]
    return abs(columna_a - columna_b) + abs(fila_a - fila_b) == 1

"""Pruebas del contrato de preprocesamiento del MVP KNN."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

from mvp_config import (  # noqa: E402
    COLUMNAS_CARACTERISTICAS,
    COORDENADAS_ZONA,
    EXCLUSION_TRANSICION_SEGUNDOS,
    son_zonas_vecinas,
    zona_por_tiempo,
)
from preprocesar_calibracion import construir_muestras  # noqa: E402


class PreprocesamientoMvpTests(unittest.TestCase):
    def _fila(self, mac: str, rssi: int, timestamp: str, secuencia: int = 1) -> dict[str, str]:
        return {
            "timestamp_utc_pc": timestamp, "sesion_gateway": "1", "jugador_id": "1",
            "sesion_jugador": "99", "secuencia": str(secuencia), "mac_torre": mac, "rssi": str(rssi),
        }

    def test_construye_vector_por_mac_en_orden_fisico(self) -> None:
        timestamp = "2026-09-07T01:36:06.000Z"
        macs = ["10:06:1C:D5:95:04", "90:15:06:5A:30:D0", "10:06:1C:D5:95:8C", "10:06:1C:D4:8F:C4"]
        # Las filas iniciales fijan el origen de la sesión y se excluyen.
        filas = [self._fila(mac, -40, "2026-09-07T01:36:00.000Z", 0) for mac in macs] + [
            self._fila("10:06:1C:D5:95:04", -41, timestamp),
            self._fila("90:15:06:5A:30:D0", -42, timestamp),
            self._fila("10:06:1C:D5:95:8C", -43, timestamp),
            self._fila("10:06:1C:D4:8F:C4", -44, timestamp),
        ]
        muestras, resumen = construir_muestras(filas)
        self.assertEqual(resumen["vectores_completos"], 1)
        self.assertEqual([muestras[0][columna] for columna in COLUMNAS_CARACTERISTICAS], [-43, -41, -44, -42])
        self.assertEqual(muestras[0]["zona"], 1)

    def test_excluye_los_primeros_seis_segundos_de_cada_zona(self) -> None:
        macs = ["10:06:1C:D5:95:04", "90:15:06:5A:30:D0", "10:06:1C:D5:95:8C", "10:06:1C:D4:8F:C4"]
        # Al iniciar el CSV estas cuatro lecturas definen t=0; deben excluirse.
        inicio = [self._fila(mac, -40, "2026-09-07T01:36:00.000Z") for mac in macs]
        # t=66 pertenece a la zona 2 y se conserva.
        estable = [self._fila(mac, -40, "2026-09-07T01:37:06.000Z", 2) for mac in macs]
        muestras, resumen = construir_muestras(inicio + estable)
        self.assertEqual(resumen["filas_excluidas_transicion"], 4)
        self.assertEqual(len(muestras), 1)
        self.assertEqual(muestras[0]["zona"], 2)

    def test_rechaza_mac_no_registrada(self) -> None:
        with self.assertRaisesRegex(ValueError, "MAC de torre no registrada"):
            construir_muestras([self._fila("AA:BB:CC:DD:EE:FF", -40, "2026-09-07T01:36:06.000Z")])


class ContratoGeometriaTests(unittest.TestCase):
    def test_etiquetado_temporal_de_zonas(self) -> None:
        self.assertEqual(zona_por_tiempo(EXCLUSION_TRANSICION_SEGUNDOS), 1)
        self.assertEqual(zona_por_tiempo(66.0), 2)
        self.assertEqual(zona_por_tiempo(539.9), 9)

    def test_geometria_serpentina_y_vecindad(self) -> None:
        self.assertEqual(COORDENADAS_ZONA[1], (0, 0))
        self.assertEqual(COORDENADAS_ZONA[6], (0, 1))
        self.assertTrue(son_zonas_vecinas(2, 5))
        self.assertFalse(son_zonas_vecinas(1, 5))


if __name__ == "__main__":
    unittest.main()

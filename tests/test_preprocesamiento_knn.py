"""Pruebas del contrato de preprocesamiento para KNN."""

from __future__ import annotations

import sys
import csv
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

from config_rssi import (  # noqa: E402
    COLUMNAS_CARACTERISTICAS,
    COORDENADAS_ZONA,
    son_zonas_vecinas,
)
from preprocesar_calibracion import construir_muestras, leer_y_preprocesar  # noqa: E402


class PreprocesamientoKnnTests(unittest.TestCase):
    def _fila(self, mac: str, rssi: int, timestamp: str, secuencia: int = 1) -> dict[str, str]:
        return {
            "timestamp_utc_pc": timestamp, "sesion_gateway": "1", "jugador_id": "1",
            "sesion_jugador": "99", "secuencia": str(secuencia), "mac_torre": mac, "rssi": str(rssi),
        }

    def test_construye_vector_por_mac_en_orden_fisico(self) -> None:
        timestamp = "2026-09-07T01:36:06.000Z"
        macs = ["10:06:1C:D5:95:04", "90:15:06:5A:30:D0", "10:06:1C:D5:95:8C", "10:06:1C:D4:8F:C4"]
        # Las filas iniciales también se conservan.
        filas = [self._fila(mac, -40, "2026-09-07T01:36:00.000Z", 0) for mac in macs] + [
            self._fila("10:06:1C:D5:95:04", -41, timestamp),
            self._fila("90:15:06:5A:30:D0", -42, timestamp),
            self._fila("10:06:1C:D5:95:8C", -43, timestamp),
            self._fila("10:06:1C:D4:8F:C4", -44, timestamp),
        ]
        muestras, resumen = construir_muestras(filas, zona=1)
        self.assertEqual(resumen["vectores_completos"], 2)
        self.assertEqual([muestras[1][columna] for columna in COLUMNAS_CARACTERISTICAS], [-41, -42, -43, -44])
        self.assertEqual(muestras[0]["zona"], 1)

    def test_conserva_inicio_y_zona_explicita_pasado_un_minuto(self) -> None:
        macs = ["10:06:1C:D5:95:04", "90:15:06:5A:30:D0", "10:06:1C:D5:95:8C", "10:06:1C:D4:8F:C4"]
        # Las lecturas iniciales deben conservarse.
        inicio = [self._fila(mac, -40, "2026-09-07T01:36:00.000Z") for mac in macs]
        # Pasados 66 segundos sigue siendo la zona explícita del archivo.
        estable = [self._fila(mac, -40, "2026-09-07T01:37:06.000Z", 2) for mac in macs]
        muestras, resumen = construir_muestras(inicio + estable, zona=2)
        self.assertEqual(resumen["filas_excluidas_transicion"], 0)
        self.assertEqual(len(muestras), 2)
        self.assertTrue(all(m["zona"] == 2 for m in muestras))

    def test_archivos_por_zona_no_mezclan_secuencias(self) -> None:
        macs = ["10:06:1C:D5:95:04", "90:15:06:5A:30:D0", "10:06:1C:D5:95:8C", "10:06:1C:D4:8F:C4"]
        with tempfile.TemporaryDirectory() as carpeta:
            for zona in (1, 9):
                filas = [self._fila(mac, -40-zona, "2026-09-07T01:36:00.000Z") for mac in macs]
                with (Path(carpeta) / f"Dataset1_1min_zona_{zona}_test.csv").open("w", newline="") as flujo:
                    escritor = csv.DictWriter(flujo, fieldnames=list(filas[0]))
                    escritor.writeheader()
                    escritor.writerows(filas)
            muestras, resumen = leer_y_preprocesar([Path(carpeta)])
        self.assertEqual([m["zona"] for m in muestras], [1, 9])
        self.assertTrue(all(m["dataset"] == "dataset 1" and m["completo"] == 1 for m in muestras))
        self.assertEqual(resumen["filas_entrada"], 8)
        self.assertEqual(resumen["duplicados_en_vector"], 0)

    def test_rechaza_mac_no_registrada(self) -> None:
        with self.assertRaisesRegex(ValueError, "MAC de torre no registrada"):
            construir_muestras([self._fila("AA:BB:CC:DD:EE:FF", -40, "2026-09-07T01:36:06.000Z")], zona=1)


class ContratoGeometriaTests(unittest.TestCase):
    def test_geometria_serpentina_y_vecindad(self) -> None:
        self.assertEqual(COORDENADAS_ZONA[1], (0, 0))
        self.assertEqual(COORDENADAS_ZONA[6], (0, 1))
        self.assertTrue(son_zonas_vecinas(2, 5))
        self.assertFalse(son_zonas_vecinas(1, 5))


if __name__ == "__main__":
    unittest.main()

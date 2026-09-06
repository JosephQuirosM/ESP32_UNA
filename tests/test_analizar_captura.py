import csv
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from analizar_captura import COLUMNAS_REQUERIDAS, analizar  # noqa: E402


class PruebasAnalizarCaptura(unittest.TestCase):
    def test_informe_calcula_completitud_y_duplicados(self):
        with tempfile.TemporaryDirectory() as temporal:
            ruta = Path(temporal) / "lecturas.csv"
            filas = []
            for torre in (1, 2, 3, 4):
                filas.append(
                    {
                        "timestamp_utc_pc": "2026-09-05T00:00:00.000Z",
                        "sesion_gateway": 1,
                        "tiempo_gateway_recepcion_ms": 100,
                        "tiempo_torre_ms": 90,
                        "torre_id": torre,
                        "mac_torre": f"AA:BB:CC:DD:EE:{torre:02X}",
                        "jugador_id": 1,
                        "sesion_jugador": 2,
                        "secuencia": 10,
                        "rssi": -60,
                    }
                )
            filas.append(dict(filas[0]))
            with ruta.open("w", newline="", encoding="utf-8") as archivo:
                escritor = csv.DictWriter(archivo, fieldnames=sorted(COLUMNAS_REQUERIDAS))
                escritor.writeheader()
                escritor.writerows(filas)

            informe = analizar(ruta, {1, 2, 3, 4})

            self.assertIn("Secuencias completas (4 torres): 1 (100.00 %)", informe)
            self.assertIn("Duplicados de (sesión, jugador, secuencia, torre): 1", informe)


if __name__ == "__main__":
    unittest.main()

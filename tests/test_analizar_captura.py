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
                        "sesion_torre": 100 + torre,
                        "secuencia_torre_tx": 10,
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
            self.assertIn("Cobertura agregada Torre → Gateway: 100.00 %", informe)
            self.assertIn("duplicados de secuencia de torre=1", informe)

    def test_acepta_csv_v2_sin_diagnostico_de_enlace(self):
        with tempfile.TemporaryDirectory() as temporal:
            ruta = Path(temporal) / "lecturas_v2.csv"
            columnas_v2 = sorted(COLUMNAS_REQUERIDAS - {"sesion_torre", "secuencia_torre_tx"})
            fila = {
                "timestamp_utc_pc": "2026-09-05T00:00:00.000Z",
                "sesion_gateway": 1,
                "tiempo_gateway_recepcion_ms": 100,
                "tiempo_torre_ms": 90,
                "torre_id": 1,
                "mac_torre": "AA:BB:CC:DD:EE:01",
                "jugador_id": 1,
                "sesion_jugador": 2,
                "secuencia": 10,
                "rssi": -60,
            }
            with ruta.open("w", newline="", encoding="utf-8") as archivo:
                escritor = csv.DictWriter(archivo, fieldnames=columnas_v2)
                escritor.writeheader()
                escritor.writerow(fila)

            informe = analizar(ruta, {1})

            self.assertIn("No disponible: el CSV es v2", informe)

    def test_detecta_hueco_de_transmision_torre_y_extrae_logs(self):
        with tempfile.TemporaryDirectory() as temporal:
            base = Path(temporal)
            ruta = base / "lecturas_v3.csv"
            filas = []
            for secuencia_jugador, secuencia_torre in ((1, 1), (2, 3)):
                filas.append(
                    {
                        "timestamp_utc_pc": "2026-09-06T00:00:00.000Z",
                        "sesion_gateway": 10,
                        "tiempo_gateway_recepcion_ms": 100,
                        "tiempo_torre_ms": 90,
                        "torre_id": 1,
                        "sesion_torre": 20,
                        "secuencia_torre_tx": secuencia_torre,
                        "mac_torre": "AA:BB:CC:DD:EE:01",
                        "jugador_id": 1,
                        "sesion_jugador": 30,
                        "secuencia": secuencia_jugador,
                        "rssi": -60,
                    }
                )
            with ruta.open("w", newline="", encoding="utf-8") as archivo:
                escritor = csv.DictWriter(archivo, fieldnames=sorted(COLUMNAS_REQUERIDAS))
                escritor.writeheader()
                escritor.writerows(filas)
            log_gateway = base / "gateway.log"
            log_gateway.write_text(
                "Gateway: control=1 datos=2 enviados=2 descartes_control=0 "
                "descartes_datos=0 inválidos=0 descartes_entrega=0 fallos_http=0 "
                "reintentos=0 latencia_http_media_ms=4 destino_pc=si\n",
                encoding="utf-8",
            )
            log_torre = base / "torre.log"
            log_torre.write_text(
                "Torre: id=1 sesion=20 beacons=3 encolados=3 descartes_cola=0 "
                "tx_intentos=3 tx_confirmadas=3 tx_fallidas=0 fallos_inicio=0 "
                "gateway_unicast=si\n",
                encoding="utf-8",
            )

            informe = analizar(ruta, {1}, log_gateway, [log_torre])

            self.assertIn("huecos internos=1", informe)
            self.assertIn("latencia_http_media_ms=4", informe)
            self.assertIn("gateway_unicast=si", informe)


if __name__ == "__main__":
    unittest.main()

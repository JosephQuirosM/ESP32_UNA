import csv
import json
import sys
import tempfile
import threading
import unittest
import uuid
from http.client import HTTPConnection
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from receptor_gateway import (  # noqa: E402
    MAXIMO_REGISTROS_LOTE,
    EscritorCsv,
    ServidorRegistros,
    validar_registro,
)


CAPTURA_ID = str(uuid.uuid4())

REGISTRO = {
    "sesion_gateway": 456,
    "tiempo_gateway_recepcion_ms": 1234,
    "tiempo_torre_ms": 1210,
    "torre_id": 1,
    "sesion_torre": 321,
    "secuencia_torre_tx": 41,
    "mac_torre": "AA:BB:CC:DD:EE:FF",
    "jugador_id": 1,
    "sesion_jugador": 789,
    "secuencia": 42,
    "rssi": -61,
    "movimiento": 2,
}


class PruebasReceptorGateway(unittest.TestCase):
    def test_validar_registro_normaliza_mac(self):
        registro = validar_registro(dict(REGISTRO, mac_torre="aa:bb:cc:dd:ee:ff"))
        self.assertEqual(registro["mac_torre"], "AA:BB:CC:DD:EE:FF")

    def test_validar_registro_rechaza_mac_e_id_invalidos(self):
        for registro in (
            dict(REGISTRO, mac_torre="GG:BB:CC:DD:EE:FF"),
            dict(REGISTRO, jugador_id=0),
            dict(REGISTRO, torre_id=255),
            dict(REGISTRO, sesion_jugador=0),
            dict(REGISTRO, sesion_torre=0),
            dict(REGISTRO, secuencia_torre_tx=0),
            dict(REGISTRO, rssi=1),
            dict(REGISTRO, rssi=-128),
        ):
            with self.subTest(registro=registro):
                with self.assertRaises(ValueError):
                    validar_registro(registro)
        legado = {k: v for k, v in REGISTRO.items() if k != "movimiento"}
        self.assertEqual(validar_registro(legado)["movimiento"], "")

    def test_post_crea_csv_v3_y_cerrar_drena_lotes(self):
        with tempfile.TemporaryDirectory() as temporal:
            ruta = Path(temporal) / "lecturas.csv"
            escritor = EscritorCsv(ruta)
            escritor.iniciar()
            servidor = ServidorRegistros(("127.0.0.1", 0), escritor, CAPTURA_ID)
            servidor.admitiendo.set()
            hilo = threading.Thread(target=servidor.serve_forever, daemon=True)
            hilo.start()
            conexion = HTTPConnection("127.0.0.1", servidor.server_address[1])
            conexion.request(
                "POST",
                "/v1/registros",
                body=json.dumps(
                    [REGISTRO, dict(REGISTRO, secuencia=43, secuencia_torre_tx=42)]
                ),
                headers={"Content-Type": "application/json", "X-Heatmap-Captura": CAPTURA_ID},
            )
            self.assertEqual(conexion.getresponse().status, 202)
            conexion.close()
            servidor.shutdown()
            servidor.server_close()
            escritor.cerrar()
            with ruta.open(newline="", encoding="utf-8") as archivo:
                filas = list(csv.DictReader(archivo))
            self.assertEqual(len(filas), 2)
            self.assertEqual(filas[0]["rssi"], "-61")
            self.assertEqual(filas[0]["movimiento"], "2")
            self.assertEqual(filas[0]["sesion_gateway"], "456")
            self.assertEqual(filas[0]["sesion_torre"], "321")
            self.assertTrue(filas[0]["timestamp_utc_pc"].endswith("Z"))

    def test_post_rechaza_lote_demasiado_grande(self):
        with tempfile.TemporaryDirectory() as temporal:
            escritor = EscritorCsv(Path(temporal) / "lecturas.csv")
            escritor.iniciar()
            servidor = ServidorRegistros(("127.0.0.1", 0), escritor, CAPTURA_ID)
            servidor.admitiendo.set()
            hilo = threading.Thread(target=servidor.serve_forever, daemon=True)
            hilo.start()
            conexion = HTTPConnection("127.0.0.1", servidor.server_address[1])
            conexion.request(
                "POST",
                "/v1/registros",
                body=json.dumps([REGISTRO] * (MAXIMO_REGISTROS_LOTE + 1)),
                headers={"Content-Type": "application/json", "X-Heatmap-Captura": CAPTURA_ID},
            )
            self.assertEqual(conexion.getresponse().status, 400)
            conexion.close()
            servidor.shutdown()
            servidor.server_close()
            escritor.cerrar()


if __name__ == "__main__":
    unittest.main()

"""Verifica aislamiento HTTP, temporizador y control UDP del receptor CLI real."""
import csv
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import uuid
from http.client import HTTPConnection
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from receptor_gateway import EscritorCsv, ServidorRegistros, ReceptorCaptura, guardar_estado
from control_gateway import ControlGatewayUdp
from test_receptor_gateway import REGISTRO


class ControlReceptorTests(unittest.TestCase):
    def test_estado_reintenta_si_windows_bloquea_el_reemplazo(self):
        with tempfile.TemporaryDirectory() as tmp:
            ruta = Path(tmp) / "estado.json"
            ruta.write_text('{"estado": "iniciando"}', encoding="utf-8")
            reemplazar = Path.replace
            bloqueo = PermissionError("Acceso denegado")
            bloqueo.winerror = 5

            def reemplazar_despues_de_liberar(temporal, destino):
                if llamadas.call_count == 1:
                    self.assertEqual(json.loads(destino.read_text())["estado"], "iniciando")
                    raise bloqueo
                reemplazar(temporal, destino)

            with patch.object(Path, "replace", autospec=True,
                              side_effect=reemplazar_despues_de_liberar) as llamadas:
                guardar_estado(ruta, '{"estado": "grabando"}')
            self.assertEqual(llamadas.call_count, 2)
            self.assertEqual(json.loads(ruta.read_text())["estado"], "grabando")

    def test_estado_reporta_la_ruta_si_windows_mantiene_el_bloqueo(self):
        with tempfile.TemporaryDirectory() as tmp:
            ruta = Path(tmp) / "estado.json"
            bloqueo = PermissionError("Acceso denegado")
            bloqueo.winerror = 5
            with patch.object(Path, "replace", side_effect=bloqueo) as reemplazar, \
                    patch("receptor_gateway.time.sleep") as esperar:
                with self.assertRaises(RuntimeError) as fallo:
                    guardar_estado(ruta, "{}")
            self.assertIn(str(ruta), str(fallo.exception))
            self.assertIs(fallo.exception.__cause__, bloqueo)
            self.assertGreater(esperar.call_count, 0)
            self.assertEqual(reemplazar.call_count, esperar.call_count + 1)

    def test_receptor_reabre_red_y_conserva_csv_e_identidad(self):
        with tempfile.TemporaryDirectory() as tmp:
            ruta = Path(tmp) / "partida.csv"
            escritor = EscritorCsv(ruta, nuevo=True)
            escritor.iniciar()
            token = str(uuid.uuid4())
            receptor = ReceptorCaptura(escritor, token, 0)

            def post(id_captura, secuencia):
                conexion = HTTPConnection(receptor.host, receptor.servidor.server_address[1], timeout=2)
                conexion.request("POST", "/v1/registros", json.dumps([{**REGISTRO, "secuencia": secuencia}]),
                                 {"X-Heatmap-Captura": id_captura})
                respuesta = conexion.getresponse()
                respuesta.read()
                estado = respuesta.status
                conexion.close()
                return estado

            try:
                self.assertTrue(receptor.cambiar_red("127.0.0.1"))
                receptor.puerto = receptor.servidor.server_address[1]
                receptor.iniciar_grabacion()
                self.assertEqual(post(token, 1), 202)
                self.assertFalse(receptor.cambiar_red(None))
                self.assertFalse(receptor.estado_red()["disponible"])
                self.assertTrue(escritor._hilo.is_alive())
                # Si el puerto no se puede abrir, sigue esperando sin perder el CSV.
                with socket.socket() as ocupado:
                    ocupado.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                    ocupado.bind(("127.0.0.1", receptor.puerto))
                    ocupado.listen()
                    self.assertFalse(receptor.cambiar_red("127.0.0.1"))
                self.assertTrue(receptor.cambiar_red("127.0.0.2"))
                self.assertEqual(post(str(uuid.uuid4()), 2), 409)
                self.assertEqual(post(token, 2), 202)
                receptor.cerrar()
                self.assertFalse(receptor.cambiar_red("127.0.0.1"))
            finally:
                receptor.cerrar()
                escritor.cerrar()
            with ruta.open() as archivo:
                filas = list(csv.DictReader(archivo))
            self.assertEqual([f["secuencia"] for f in filas], ["1", "2"])

    def test_control_cli_renueva_tras_cierre_sin_cambiar_captura(self):
        with tempfile.TemporaryDirectory() as tmp:
            token = str(uuid.uuid4())
            control = ControlGatewayUdp(0, 8080, token, Path(tmp) / "control.json")
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as gateway:
                gateway.bind(("127.0.0.1", 0))
                origen = gateway.getsockname()
                try:
                    anuncio = {"mac": "AA:BB:CC:DD:EE:01", "sesion": 456,
                               "controlCaptura": 1, "revisionControl": 0}
                    control._recibir(b"HEATMAP_GATEWAY_V1 " + json.dumps(anuncio).encode(), origen)
                    revision = control.revision
                    ack = f"HEATMAP_ACK_V3 456 {revision} {token}"
                    control._recibir(f"{ack} 8080".encode(), origen)
                    self.assertTrue(control.confirmado.is_set())
                    control._recibir(f"{ack} 0".encode(), origen)
                    self.assertGreater(control.revision, revision)
                    nueva = control.revision
                    self.assertFalse(control.confirmado.is_set())
                    self.assertIsNone(control.fallo)
                    self.assertEqual(control.captura_id, token)
                    control._recibir(f"{ack} 0".encode(), origen)
                    self.assertEqual(control.revision, nueva)
                    control._recibir(f"HEATMAP_ACK_V3 456 {nueva} {token} 8080".encode(), origen)
                    self.assertTrue(control.confirmado.is_set())
                    self.assertEqual(json.loads(control.ruta.read_text())["capturaId"], token)
                finally:
                    control.cerrar()

    def test_http_no_admite_antes_de_inicio_y_rechaza_identidad_anterior(self):
        with tempfile.TemporaryDirectory() as tmp:
            escritor = EscritorCsv(Path(tmp) / "captura.csv", nuevo=True); escritor.iniciar()
            token = str(uuid.uuid4())
            servidor = ServidorRegistros(("127.0.0.1", 0), escritor, token)
            hilo = threading.Thread(target=servidor.serve_forever, daemon=True); hilo.start()
            def post(id_captura):
                conexion = HTTPConnection("127.0.0.1", servidor.server_address[1])
                conexion.request("POST", "/v1/registros", json.dumps([REGISTRO]), {"X-Heatmap-Captura": id_captura})
                estado = conexion.getresponse().status; conexion.close(); return estado
            try:
                self.assertEqual(post(token), 503)
                self.assertEqual(post(str(uuid.uuid4())), 409)
                servidor.admitiendo.set()
                self.assertEqual(post(token), 202)
                with servidor.mutex_admision:
                    servidor.deteniendo.set(); servidor.admitiendo.clear()
                self.assertEqual(post(token), 503)
            finally:
                servidor.shutdown(); servidor.server_close(); escritor.cerrar()
            with (Path(tmp) / "captura.csv").open() as f:
                self.assertEqual(len(list(csv.DictReader(f))), 1)

    def test_cli_confirma_gateway_antes_del_reloj_y_envia_parada(self):
        with tempfile.TemporaryDirectory() as tmp:
            raiz = Path(tmp)
            socket_pc = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); socket_pc.bind(("127.0.0.1", 0))
            puerto_udp = socket_pc.getsockname()[1]; socket_pc.close()
            tcp = socket.socket(); tcp.bind(("127.0.0.1", 0)); puerto_http = tcp.getsockname()[1]; tcp.close()
            gateway = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); gateway.bind(("127.0.0.1", 0)); gateway.settimeout(.05)
            terminar = threading.Event(); ordenes = []; parada = threading.Event()
            def emular():
                sesion, revision, token, puerto = 456, 0, "-", 0
                ultimo = 0
                while not terminar.is_set():
                    if time.monotonic() - ultimo >= .1:
                        anuncio = {"mac": "AA:BB:CC:DD:EE:01", "sesion": sesion, "controlCaptura": 1, "revisionControl": revision}
                        gateway.sendto(b"HEATMAP_GATEWAY_V1 " + json.dumps(anuncio).encode(), ("127.0.0.1", puerto_udp)); ultimo = time.monotonic()
                    try: datos, origen = gateway.recvfrom(1024)
                    except socket.timeout: continue
                    partes = datos.decode().split()
                    if len(partes) != 5 or partes[0] != "HEATMAP_PC_V3": continue
                    _, s, r, token, p = partes; revision, puerto = int(r), int(p)
                    ordenes.append((revision, token, puerto))
                    if puerto == 0: parada.set()
                    gateway.sendto(f"HEATMAP_ACK_V3 {s} {r} {token} {p}".encode(), origen)
            hilo = threading.Thread(target=emular); hilo.start()
            script = Path(__file__).resolve().parents[1] / "python/receptor_gateway.py"
            try:
                proceso = subprocess.Popen([sys.executable, "-B", str(script), "--archivo", str(raiz / "cli.csv"), "--nuevo",
                    "--host", "127.0.0.1", "--puerto-http", str(puerto_http), "--puerto-udp", str(puerto_udp), "--duracion", "1",
                    "--estado-json", str(raiz / "estado.json")], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                stdout, stderr = proceso.communicate(timeout=12)
                self.assertEqual(proceso.returncode, 0, stdout + stderr)
                self.assertTrue(parada.wait(1))
                estado = json.loads((raiz / "estado.json").read_text())
                self.assertEqual(estado["estado"], "completada")
                self.assertTrue(any(puerto > 0 for _, _, puerto in ordenes))
                self.assertEqual(ordenes[-1][2], 0)
                self.assertGreater(ordenes[-1][0], ordenes[0][0])
            finally:
                terminar.set(); hilo.join(timeout=2); gateway.close()

"""Control UDP V3 para el receptor independiente: autorización, ACK y cierre."""
from __future__ import annotations

import json
from pathlib import Path
import re
import socket
import threading
import time

PREFIJO = b"HEATMAP_GATEWAY_V1 "


class ControlGatewayUdp:
    """Mantiene una captura por identidad sin modificar ESP-NOW de las torres."""

    def __init__(self, puerto_udp, puerto_http, captura_id, ruta_revision):
        self.captura_id = captura_id
        self.puerto_http = puerto_http
        self.ruta = Path(ruta_revision)
        self.ruta.parent.mkdir(parents=True, exist_ok=True)
        anterior = json.loads(self.ruta.read_text()) if self.ruta.exists() else {}
        self.revision = max(int(time.time() * 1000), int(anterior.get("revision", 0)) + 1)
        self.confirmado = threading.Event()
        self.fallo = None
        self._mutex = threading.RLock()
        self._cerrando = threading.Event()
        self._ack_cierre = threading.Event()
        self._socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            self._socket.bind(("0.0.0.0", puerto_udp))
            self._socket.settimeout(0.05)
        except Exception:
            self._socket.close()
            raise
        self._destino = None
        self._sesion = None
        self._mac = None
        self._ultimo_envio = 0.0
        self._guardar()
        self._hilo = threading.Thread(target=self._ejecutar, name="control-gateway", daemon=True)

    def _guardar(self):
        temporal = self.ruta.with_suffix(".tmp")
        temporal.write_text(json.dumps({"revision": self.revision, "capturaId": "-" if self._cerrando.is_set() else self.captura_id,
                                       "puerto": 0 if self._cerrando.is_set() else self.puerto_http}), encoding="utf-8")
        temporal.replace(self.ruta)

    def iniciar(self):
        self._hilo.start()

    def _enviar(self):
        if self._destino is None:
            return
        id_captura = "-" if self._cerrando.is_set() else self.captura_id
        puerto = 0 if self._cerrando.is_set() else self.puerto_http
        mensaje = f"HEATMAP_PC_V3 {self._sesion} {self.revision} {id_captura} {puerto}".encode("ascii")
        self._socket.sendto(mensaje, self._destino)
        self._ultimo_envio = time.monotonic()

    def _recibir(self, mensaje, origen):
        if len(mensaje) > 1024:
            return
        ack = re.fullmatch(rb"HEATMAP_ACK_V3 (\d+) (\d+) ([0-9a-f-]+) (\d+)", mensaje)
        if ack:
            if origen != self._destino or int(ack[1]) != self._sesion or int(ack[2]) != self.revision:
                return
            if self._cerrando.is_set():
                if ack[3] == b"-" and int(ack[4]) == 0: self._ack_cierre.set()
            elif ack[3].decode("ascii") == self.captura_id:
                if int(ack[4]) == self.puerto_http: self.confirmado.set()
                else: self.fallo = "La autorización del Gateway venció; comienza otra captura"
            return
        if not mensaje.startswith(PREFIJO):
            return
        anuncio = json.loads(mensaje[len(PREFIJO):])
        if not isinstance(anuncio, dict) or not re.fullmatch(r"(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}", str(anuncio.get("mac", ""))):
            return
        sesion = anuncio.get("sesion")
        if type(sesion) is not int or not 0 < sesion <= 0xffffffff:
            return
        if self._mac is not None and anuncio["mac"] != self._mac:
            return
        if anuncio.get("controlCaptura") != 1:
            self.fallo = "Actualiza el firmware del Gateway: no admite control de capturas"
            return
        revision = anuncio.get("revisionControl")
        if type(revision) is not int or not 0 <= revision < 9007199254740991:
            return
        if self._sesion is not None and sesion != self._sesion:
            self.fallo = "El Gateway se reinició durante la captura"
            return
        if self._destino is None:
            self._destino, self._sesion, self._mac = origen, sesion, anuncio["mac"]
            self.revision = max(self.revision, revision + 1)
            self._guardar()
        elif revision > self.revision:
            self.fallo = "Otro control reemplazó la autorización del Gateway"
            return
        self._enviar()

    def _ejecutar(self):
        try:
            while not self._cerrando.is_set() or not self._ack_cierre.is_set():
                try:
                    mensaje, origen = self._socket.recvfrom(1025)
                    with self._mutex: self._recibir(mensaje, origen)
                except socket.timeout:
                    pass
                except (ValueError, UnicodeError, TypeError):
                    continue
                intervalo = 0.25 if self._cerrando.is_set() or not self.confirmado.is_set() else 2.0
                if time.monotonic() - self._ultimo_envio >= intervalo:
                    with self._mutex: self._enviar()
        except OSError as error:
            if not self._cerrando.is_set(): self.fallo = f"Falló el control UDP: {error}"

    def cerrar(self):
        with self._mutex:
            if not self._cerrando.is_set():
                self.revision += 1
                self._cerrando.set()
                self._guardar()
                try: self._enviar()
                except OSError: pass
        if self._hilo.is_alive():
            self._ack_cierre.wait(0.5)
        self._socket.close()
        if self._hilo.ident is not None: self._hilo.join(timeout=1)

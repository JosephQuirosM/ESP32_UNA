#!/usr/bin/env python3
"""Recibe registros HTTP del Gateway y los persiste de forma ordenada en CSV."""

from __future__ import annotations

import argparse
import csv
import json
import os
import queue
import re
import signal
import socket
import threading
import sys
import time
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

MAXIMO_UINT32 = 4_294_967_295
MAXIMO_REGISTROS_LOTE = 8
CAPACIDAD_COLA_CSV = 256

COLUMNAS_CSV = [
    "timestamp_utc_pc",
    "sesion_gateway",
    "tiempo_gateway_recepcion_ms",
    "tiempo_torre_ms",
    "torre_id",
    "sesion_torre",
    "secuencia_torre_tx",
    "mac_torre",
    "jugador_id",
    "sesion_jugador",
    "secuencia",
    "rssi",
]


def _entero_en_rango(registro: dict[str, Any], campo: str, minimo: int, maximo: int) -> int:
    """Extrae un entero del contrato y comprueba sus límites inclusivos."""
    valor = registro.get(campo)
    if isinstance(valor, bool) or not isinstance(valor, int):
        raise ValueError(f"{campo} debe ser un entero")
    if not minimo <= valor <= maximo:
        raise ValueError(f"{campo} debe estar entre {minimo} y {maximo}")
    return valor


def validar_registro(registro: Any) -> dict[str, int | str]:
    """Comprueba el contrato HTTP v3 antes de que una fila llegue al CSV."""
    if not isinstance(registro, dict):
        raise ValueError("cada registro debe ser un objeto JSON")
    resultado: dict[str, int | str] = {
        "sesion_gateway": _entero_en_rango(registro, "sesion_gateway", 1, MAXIMO_UINT32),
        "tiempo_gateway_recepcion_ms": _entero_en_rango(
            registro, "tiempo_gateway_recepcion_ms", 0, MAXIMO_UINT32
        ),
        "tiempo_torre_ms": _entero_en_rango(registro, "tiempo_torre_ms", 0, MAXIMO_UINT32),
        "torre_id": _entero_en_rango(registro, "torre_id", 1, 254),
        "sesion_torre": _entero_en_rango(registro, "sesion_torre", 1, MAXIMO_UINT32),
        "secuencia_torre_tx": _entero_en_rango(
            registro, "secuencia_torre_tx", 1, MAXIMO_UINT32
        ),
        "jugador_id": _entero_en_rango(registro, "jugador_id", 1, 254),
        "sesion_jugador": _entero_en_rango(registro, "sesion_jugador", 1, MAXIMO_UINT32),
        "secuencia": _entero_en_rango(registro, "secuencia", 1, MAXIMO_UINT32),
        "rssi": _entero_en_rango(registro, "rssi", -127, 0),
    }
    mac = registro.get("mac_torre")
    if not isinstance(mac, str) or not re.fullmatch(r"[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}", mac):
        raise ValueError("mac_torre debe tener formato XX:XX:XX:XX:XX:XX")
    resultado["mac_torre"] = mac.upper()
    return resultado


class EscritorCsv:
    """Aísla el CSV con una cola acotada y conserva cada lote como una unidad."""

    def __init__(self, ruta: Path, capacidad_cola: int = CAPACIDAD_COLA_CSV, nuevo: bool = False) -> None:
        if capacidad_cola <= 0:
            raise ValueError("capacidad_cola debe ser positiva")
        self._ruta = ruta
        self._nuevo = nuevo
        self._listo = threading.Event()
        self.filas_escritas = 0
        self.ultima_recepcion_utc: str | None = None
        self._cola: queue.Queue[list[dict[str, int | str]] | None] = queue.Queue(capacidad_cola)
        self._hilo = threading.Thread(target=self._escribir, name="escritor-csv", daemon=True)
        self._cerrado = False
        self._iniciado = False
        self._error: BaseException | None = None

    def iniciar(self) -> None:
        if self._iniciado:
            raise RuntimeError("el escritor CSV ya fue iniciado")
        self._ruta.parent.mkdir(parents=True, exist_ok=True)
        self._iniciado = True
        self._hilo.start()
        if not self._listo.wait(5):
            raise RuntimeError("el escritor CSV no se preparó a tiempo")
        self.comprobar_error()

    def comprobar_error(self) -> None:
        """Propaga errores del hilo escritor aunque no lleguen nuevos registros."""
        if self._error is not None:
            raise RuntimeError(f"falló la escritura del CSV: {self._error}") from self._error

    def encolar(self, registros: list[dict[str, int | str]]) -> bool:
        """Encola un lote completo o devuelve False sin aceptar ninguna de sus filas."""
        if not self._iniciado or self._cerrado:
            raise RuntimeError("el escritor CSV no está disponible")
        if self._error is not None:
            raise RuntimeError("el escritor CSV falló") from self._error
        filas: list[dict[str, int | str]] = []
        for registro in registros:
            fila: dict[str, int | str] = {
                "timestamp_utc_pc": datetime.now(timezone.utc)
                .isoformat(timespec="milliseconds")
                .replace("+00:00", "Z")
            }
            fila.update(registro)
            filas.append(fila)
        try:
            self._cola.put_nowait(filas)
        except queue.Full:
            return False
        return True

    def cerrar(self) -> None:
        """Drena los lotes aceptados, cierra el archivo y propaga errores del hilo."""
        if not self._iniciado or self._cerrado:
            return
        self._cerrado = True
        try:
            self._cola.put(None, timeout=5)
        except queue.Full as error:
            raise RuntimeError("no se pudo cerrar la cola CSV") from error
        self._hilo.join(timeout=5)
        if self._hilo.is_alive():
            raise RuntimeError("el escritor CSV no terminó a tiempo")
        if self._error is not None:
            raise RuntimeError("falló la escritura del CSV") from self._error

    def _escribir(self) -> None:
        try:
            existe = self._ruta.exists() and self._ruta.stat().st_size > 0
            with self._ruta.open("x" if self._nuevo else "a", newline="", encoding="utf-8") as archivo:
                escritor = csv.DictWriter(archivo, fieldnames=COLUMNAS_CSV)
                if not existe:
                    escritor.writeheader()
                archivo.flush()
                self._listo.set()
                while True:
                    lote = self._cola.get()
                    if lote is None:
                        archivo.flush()
                        os.fsync(archivo.fileno())
                        return
                    escritor.writerows(lote)
                    archivo.flush()
                    self.filas_escritas += len(lote)
                    self.ultima_recepcion_utc = str(lote[-1]["timestamp_utc_pc"])
        except BaseException as error:
            self._error = error
        finally:
            self._listo.set()


class ServidorRegistros(ThreadingHTTPServer):
    """Servidor HTTP que comparte un escritor CSV con sus handlers."""

    daemon_threads = False

    def __init__(self, direccion: tuple[str, int], escritor: EscritorCsv) -> None:
        super().__init__(direccion, ManejadorRegistros)
        self.escritor = escritor
        self.deteniendo = threading.Event()


class ManejadorRegistros(BaseHTTPRequestHandler):
    """Acepta lotes JSON v3 del endpoint implementado por el Gateway."""

    server: ServidorRegistros

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(5)

    def do_POST(self) -> None:  # noqa: N802 - requerido por BaseHTTPRequestHandler.
        if self.server.deteniendo.is_set():
            self.send_error(HTTPStatus.SERVICE_UNAVAILABLE, "el CSV se está cerrando")
            return
        if self.path != "/v1/registros":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            longitud = int(self.headers.get("Content-Length", "0"))
            if longitud <= 0 or longitud > 32_768:
                raise ValueError("Content-Length inválido")
            carga = json.loads(self.rfile.read(longitud))
            if not isinstance(carga, list) or not carga:
                raise ValueError("se espera una lista no vacía")
            if len(carga) > MAXIMO_REGISTROS_LOTE:
                raise ValueError(f"el lote no puede superar {MAXIMO_REGISTROS_LOTE} registros")
            registros = [validar_registro(registro) for registro in carga]
            if self.server.deteniendo.is_set():
                self.send_error(HTTPStatus.SERVICE_UNAVAILABLE, "el CSV se está cerrando")
                return
            aceptado = self.server.escritor.encolar(registros)
        except (RuntimeError, ValueError, json.JSONDecodeError) as error:
            self.send_error(HTTPStatus.BAD_REQUEST, str(error))
            return
        if not aceptado:
            self.send_error(HTTPStatus.SERVICE_UNAVAILABLE, "cola CSV llena; reintente")
            return
        self.send_response(HTTPStatus.ACCEPTED)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"aceptado":true}')

    def log_message(self, formato: str, *argumentos: object) -> None:
        print(f"HTTP {self.client_address[0]} - {formato % argumentos}", file=sys.stderr, flush=True)


class AnunciadorUdp:
    """Publica la ubicación del servidor para que el Gateway conozca la IP DHCP de la PC."""

    def __init__(self, destino: str, puerto_udp: int, puerto_http: int) -> None:
        self._destino = destino
        self._puerto_udp = puerto_udp
        self._puerto_http = puerto_http
        self._detener = threading.Event()
        self._hilo = threading.Thread(target=self._anunciar, name="anunciador-udp", daemon=True)

    def iniciar(self) -> None:
        self._hilo.start()

    def cerrar(self) -> None:
        self._detener.set()
        self._hilo.join(timeout=3)

    def _anunciar(self) -> None:
        mensaje = f"HEATMAP_PC_V1 {self._puerto_http}".encode("ascii")
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as cliente:
            cliente.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            while not self._detener.is_set():
                try:
                    cliente.sendto(mensaje, (self._destino, self._puerto_udp))
                except OSError as error:
                    print(f"Aviso: no se pudo anunciar UDP: {error}", file=sys.stderr, flush=True)
                self._detener.wait(3)


def argumentos() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Registra lecturas RSSI recibidas desde el Gateway.")
    parser.add_argument("--archivo", type=Path, default=Path("data/raw/lecturas_mvp.csv"))
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--puerto-http", type=int, default=8080)
    parser.add_argument("--destino-udp", default="192.168.4.255")
    parser.add_argument("--puerto-udp", type=int, default=4210)
    parser.add_argument("--duracion", type=float, help="Segundos de captura desde que el receptor esté listo")
    parser.add_argument("--control-json", action="store_true", help="Publica estado JSON y acepta detener por entrada estándar")
    parser.add_argument("--nuevo", action="store_true", help="Crea un CSV nuevo sin anexar ni sobrescribir")
    parser.add_argument("--estado-json", type=Path, help="Archivo de estado para recuperar la captura")
    parser.add_argument("--detener-archivo", type=Path, help="Archivo de señal de cierre después de reiniciar el backend")
    args = parser.parse_args()
    if args.duracion is not None and (not 0 < args.duracion <= 86400):
        parser.error("la duración debe ser positiva y no superar 86400 segundos")
    return args


def main() -> int:
    """Ejecuta una captura con plazo propio y cierre ordenado independiente del navegador."""
    args = argumentos()
    escritor = EscritorCsv(args.archivo, nuevo=args.nuevo)
    detener = threading.Event()
    motivo = "detenida"
    estado: dict[str, Any] = {
        "estado": "iniciando", "pid": os.getpid(), "filasEscritas": 0,
        "ultimaRecepcionUtc": None, "error": None,
    }

    def publicar(nuevo_estado: str, **datos: Any) -> None:
        """Guarda un evento atómico y lo publica para el backend cuando esté conectado."""
        estado.update(datos)
        estado.update(estado=nuevo_estado, filasEscritas=escritor.filas_escritas,
                      ultimaRecepcionUtc=escritor.ultima_recepcion_utc)
        texto = json.dumps(estado, ensure_ascii=False)
        if args.estado_json:
            args.estado_json.parent.mkdir(parents=True, exist_ok=True)
            temporal = args.estado_json.with_suffix(".tmp")
            temporal.write_text(texto, encoding="utf-8")
            temporal.replace(args.estado_json)
        if args.control_json:
            try:
                print(texto, flush=True)
            except (BrokenPipeError, OSError):
                # Una tubería cerrada no interrumpe la captura ni su temporizador.
                pass

    def solicitar_cierre(_senal: int, _marco: object) -> None:
        detener.set()

    def leer_control() -> None:
        """Acepta detener sin depender de señales diferentes entre Windows y Linux."""
        for linea in sys.stdin:
            if linea.strip() == "detener":
                detener.set()
                return

    signal.signal(signal.SIGINT, solicitar_cierre)
    signal.signal(signal.SIGTERM, solicitar_cierre)
    servidor: ServidorRegistros | None = None
    anunciador: AnunciadorUdp | None = None
    hilo_servidor: threading.Thread | None = None
    fallo: Exception | None = None
    try:
        servidor = ServidorRegistros((args.host, args.puerto_http), escritor)
        escritor.iniciar()
        anunciador = AnunciadorUdp(args.destino_udp, args.puerto_udp, args.puerto_http)
        anunciador.iniciar()
        hilo_servidor = threading.Thread(target=servidor.serve_forever, name="servidor-http", daemon=True)
        hilo_servidor.start()
        inicio = datetime.now(timezone.utc)
        limite = time.monotonic() + args.duracion if args.duracion is not None else None
        fin_previsto = inicio + timedelta(seconds=args.duracion) if args.duracion is not None else None
        publicar("grabando", inicioUtc=inicio.isoformat(),
                 finPrevistoUtc=fin_previsto.isoformat() if fin_previsto else None)
        if args.control_json:
            threading.Thread(target=leer_control, name="control-entrada", daemon=True).start()
        else:
            print(f"Escuchando HTTP en {args.host}:{args.puerto_http}; CSV: {args.archivo}", flush=True)
        ultimo_conteo = 0
        while not detener.wait(0.1):
            escritor.comprobar_error()
            if args.detener_archivo and args.detener_archivo.exists():
                detener.set()
                break
            if limite is not None and time.monotonic() >= limite:
                motivo = "completada"
                break
            if escritor.filas_escritas != ultimo_conteo:
                ultimo_conteo = escritor.filas_escritas
                publicar("grabando")
    except Exception as error:
        fallo = error
    finally:
        if servidor:
            servidor.deteniendo.set()
        try:
            publicar("cerrando")
        except Exception as error:
            fallo = fallo or error
        # Cada recurso se cierra aunque falle el cierre de otro.
        for cerrar in [
            servidor.shutdown if servidor and hilo_servidor else None,
            servidor.server_close if servidor else None,
            anunciador.cerrar if anunciador else None,
            escritor.cerrar,
        ]:
            if cerrar:
                try:
                    cerrar()
                except Exception as error:
                    fallo = fallo or error
        try:
            publicar("error" if fallo else motivo,
                     finUtc=datetime.now(timezone.utc).isoformat(),
                     error=str(fallo) if fallo else None)
        except Exception as error:
            fallo = fallo or error
        if not args.control_json:
            print("Receptor y CSV cerrados." if not fallo else f"Error: {fallo}", flush=True)
    # Evita otro flush sobre una tubería rota durante la salida del intérprete.
    if args.control_json:
        try:
            sys.stdout.flush()
        except (BrokenPipeError, OSError):
            sys.stdout = open(os.devnull, "w", encoding="utf-8")
    return 1 if fallo else 0


if __name__ == "__main__":
    raise SystemExit(main())

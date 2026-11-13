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
import uuid
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from cuadricula import validar_cuadricula
from control_gateway import ControlGatewayUdp
from detectar_hotspot import detectar_hotspot

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
    "movimiento",
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
        "movimiento": _entero_en_rango(registro, "movimiento", 0, 2) if "movimiento" in registro else "",
    }
    mac = registro.get("mac_torre")
    if not isinstance(mac, str) or not re.fullmatch(r"[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}", mac):
        raise ValueError("mac_torre debe tener formato XX:XX:XX:XX:XX:XX")
    resultado["mac_torre"] = mac.upper()
    return resultado


class EscritorCsv:
    """Aísla el CSV con una cola acotada y conserva cada lote como una unidad."""

    def __init__(self, ruta: Path, capacidad_cola: int = CAPACIDAD_COLA_CSV, nuevo: bool = False, cuadricula: dict | None = None) -> None:
        if capacidad_cola <= 0:
            raise ValueError("capacidad_cola debe ser positiva")
        self._cuadricula = validar_cuadricula(cuadricula) if cuadricula is not None else None
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
            if self._cuadricula:
                fila["cuadricula"] = json.dumps(self._cuadricula, separators=(",", ":"))
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
                escritor = csv.DictWriter(archivo, fieldnames=COLUMNAS_CSV + (["cuadricula"] if self._cuadricula else []))
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

    def __init__(self, direccion: tuple[str, int], escritor: EscritorCsv, captura_id: str) -> None:
        if not isinstance(captura_id, str) or str(uuid.UUID(captura_id, version=4)) != captura_id:
            raise ValueError("El receptor requiere un UUID v4 de captura")
        super().__init__(direccion, ManejadorRegistros)
        self.escritor = escritor
        self.deteniendo = threading.Event()
        self.captura_id = captura_id
        self.admitiendo = threading.Event()
        self.mutex_admision = threading.Lock()


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
        if self.headers.get("X-Heatmap-Captura") != self.server.captura_id:
            self.send_error(HTTPStatus.CONFLICT, "el lote pertenece a otra captura")
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
            with self.server.mutex_admision:
                if self.server.deteniendo.is_set() or not self.server.admitiendo.is_set():
                    self.send_error(HTTPStatus.SERVICE_UNAVAILABLE, "la captura no admite registros")
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


class ReceptorCaptura:
    """Administra el listener HTTP durante la captura del escritor CSV."""

    def __init__(self, escritor: EscritorCsv, captura_id: str, puerto: int):
        self.escritor, self.captura_id, self.puerto = escritor, captura_id, puerto
        self.servidor: ServidorRegistros | None = None
        self._hilo: threading.Thread | None = None
        self._mutex = threading.RLock()
        self._grabando = False
        self._cerrado = False
        self.host: str | None = None
        self.error: str | None = None

    def _cerrar_listener(self):
        if self.servidor:
            with self.servidor.mutex_admision:
                self.servidor.deteniendo.set()
                self.servidor.admitiendo.clear()
            self.servidor.shutdown()
            self.servidor.server_close()
            if self._hilo:
                self._hilo.join()
            self.servidor = None
            self._hilo = None
        self.host = None

    def cambiar_red(self, host: str | None) -> bool:
        """Enlaza la dirección seleccionada por el proceso de captura."""
        with self._mutex:
            if self._cerrado:
                return False
            if host == self.host and self.servidor:
                return True
            self._cerrar_listener()
            if not host:
                self.error = "Hotspot no disponible; conservando captura y esperando reconexión"
                return False
            try:
                servidor = ServidorRegistros((host, self.puerto), self.escritor, self.captura_id)
            except OSError as error:
                self.error = f"Esperando receptor HTTP en {host}: {error}"
                return False
            self.servidor, self.host, self.error = servidor, host, None
            if self._grabando:
                servidor.admitiendo.set()
            self._hilo = threading.Thread(target=lambda: servidor.serve_forever(poll_interval=0.1),
                                          name="servidor-http", daemon=True)
            self._hilo.start()
            return True

    def iniciar_grabacion(self):
        with self._mutex:
            self._grabando = True
            if self.servidor:
                with self.servidor.mutex_admision:
                    self.servidor.admitiendo.set()

    def estado_red(self) -> dict:
        with self._mutex:
            return {"disponible": self.servidor is not None, "host": self.host, "error": self.error}

    def cerrar(self):
        with self._mutex:
            self._cerrado = True
            self._cerrar_listener()


def argumentos() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Registra lecturas RSSI recibidas desde el Gateway.")
    parser.add_argument("--captura-id", default=str(uuid.uuid4()), help="UUID de correlación HTTP de esta captura")
    parser.add_argument("--esperar-inicio", action="store_true", help="Prepara el receptor; el backend inicia el plazo tras el ACK")
    parser.add_argument("--iniciar-archivo", type=Path, help="Señal persistente de inicio tras confirmar el Gateway")
    parser.add_argument("--cuadricula-json", help="Geometría de la captura guiada para conservar en el CSV")
    parser.add_argument("--archivo", type=Path, default=Path("data/raw/lecturas.csv"))
    parser.add_argument("--host", help="IP del hotspot detectado; sin valor se detecta automáticamente")
    parser.add_argument("--puerto-http", type=int, default=8080)
    parser.add_argument("--destino-udp", default="192.168.4.255")
    parser.add_argument("--puerto-udp", type=int, default=4210)
    descubrimiento = parser.add_mutually_exclusive_group()
    descubrimiento.add_argument("--sin-anuncio-udp", action="store_true",
                        help="Delega el descubrimiento del Gateway al backend, sin anuncios desde Python")
    descubrimiento.add_argument("--anuncio-udp-legacy", action="store_true",
                                help="Obsoleto: el modo legacy se rechaza porque no delimita capturas")
    parser.add_argument("--duracion", type=float, help="Segundos de captura desde la confirmación del Gateway")
    parser.add_argument("--control-json", action="store_true", help="Publica estado JSON y acepta detener por entrada estándar")
    parser.add_argument("--nuevo", action="store_true", help="Crea un CSV nuevo sin anexar ni sobrescribir")
    parser.add_argument("--estado-json", type=Path, help="Archivo de estado para recuperar la captura")
    parser.add_argument("--detener-archivo", type=Path, help="Archivo de señal de cierre después de reiniciar el backend")
    args = parser.parse_args()
    try:
        if str(uuid.UUID(args.captura_id, version=4)) != args.captura_id: raise ValueError()
    except ValueError:
        parser.error("--captura-id debe ser un UUID v4 válido")
    if args.anuncio_udp_legacy:
        parser.error("El control de capturas requiere Gateway actualizado; ya no se permite anuncio UDP legacy")
    if args.sin_anuncio_udp and not args.esperar_inicio:
        parser.error("--sin-anuncio-udp requiere --esperar-inicio para recibir autorización del backend")
    if args.duracion is not None and (not 0 < args.duracion <= 86400):
        parser.error("la duración debe ser positiva y no superar 86400 segundos")
    if args.sin_anuncio_udp:
        if not args.host or args.host == "::":
            parser.error("el backend debe indicar una dirección IPv4 para el receptor")
    elif args.host in ("0.0.0.0", "::"):
        parser.error("el receptor no puede escuchar en todas las interfaces")
    elif args.host not in ("127.0.0.1", "::1"):
        hotspot = detectar_hotspot()
        if not hotspot or (args.host and args.host != hotspot["ip"]):
            parser.error("no se detecta el hotspot indicado; el receptor sólo puede iniciarse en loopback")
        args.host = hotspot["ip"]
    return args


def main() -> int:
    """Ejecuta una captura con plazo propio y cierre ordenado independiente del navegador."""
    args = argumentos()
    escritor = EscritorCsv(args.archivo, nuevo=args.nuevo, cuadricula=validar_cuadricula(args.cuadricula_json) if args.cuadricula_json else None)
    detener = threading.Event()
    iniciar = threading.Event()
    receptor = ReceptorCaptura(escritor, args.captura_id, args.puerto_http)
    motivo = "detenida"
    estado: dict[str, Any] = {
        "estado": "iniciando", "pid": os.getpid(), "filasEscritas": 0,
        "ultimaRecepcionUtc": None, "error": None,
    }

    def publicar(nuevo_estado: str, **datos: Any) -> None:
        """Guarda un evento atómico y lo publica para el backend cuando esté conectado."""
        estado.update(datos)
        estado.update(estado=nuevo_estado, filasEscritas=escritor.filas_escritas,
                      ultimaRecepcionUtc=escritor.ultima_recepcion_utc,
                      redReceptor=receptor.estado_red())
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
            if linea.strip() == "iniciar" and args.esperar_inicio:
                iniciar.set()

    signal.signal(signal.SIGINT, solicitar_cierre)
    signal.signal(signal.SIGTERM, solicitar_cierre)
    anunciador: ControlGatewayUdp | None = None
    fallo: Exception | None = None
    try:
        if not receptor.cambiar_red(args.host):
            raise RuntimeError(receptor.error)
        escritor.iniciar()
        if not args.sin_anuncio_udp and args.host not in ("127.0.0.1", "::1"):
            def vigilar_red() -> None:
                while not detener.wait(3):
                    actual = detectar_hotspot()
                    if detener.is_set():
                        return
                    receptor.cambiar_red(actual["ip"] if actual else None)

            threading.Thread(target=vigilar_red, name="vigilar-red", daemon=True).start()
        publicar("iniciando", preparado=True, inicioUtc=None, finPrevistoUtc=None)
        if args.control_json:
            threading.Thread(target=leer_control, name="control-entrada", daemon=True).start()
        if not args.sin_anuncio_udp:
            anunciador = ControlGatewayUdp(args.puerto_udp, args.puerto_http, args.captura_id,
                                           args.archivo.parent / ".lecturas/.control-gateway.json")
            anunciador.iniciar()
        plazo_inicio = time.monotonic() + 10
        while not iniciar.is_set() and not detener.is_set():
            escritor.comprobar_error()
            if anunciador and anunciador.fallo: raise RuntimeError(anunciador.fallo)
            if args.detener_archivo and args.detener_archivo.exists():
                detener.set()
                break
            if args.iniciar_archivo and args.iniciar_archivo.exists():
                orden = json.loads(args.iniciar_archivo.read_text(encoding="utf-8"))
                if orden.get("capturaId") == args.captura_id: iniciar.set()
            if anunciador:
                if anunciador.fallo: raise RuntimeError(anunciador.fallo)
                if anunciador.confirmado.is_set(): iniciar.set()
            if time.monotonic() >= plazo_inicio and not iniciar.is_set():
                raise RuntimeError("El Gateway no confirmó la captura en 10 segundos. Revisa su conexión e inténtalo otra vez.")
            detener.wait(0.02)
        limite = None
        if not detener.is_set():
            inicio = datetime.now(timezone.utc)
            limite = time.monotonic() + args.duracion if args.duracion is not None else None
            fin_previsto = inicio + timedelta(seconds=args.duracion) if args.duracion is not None else None
            receptor.iniciar_grabacion()
            publicar("grabando", inicioUtc=inicio.isoformat(),
                     finPrevistoUtc=fin_previsto.isoformat() if fin_previsto else None)
            if not args.control_json:
                print(f"Grabando HTTP en {args.host}:{args.puerto_http}; CSV: {args.archivo}", flush=True)
        ultimo_conteo = 0
        ultima_red = receptor.estado_red()
        while not detener.wait(0.1):
            escritor.comprobar_error()
            if anunciador and anunciador.fallo: raise RuntimeError(anunciador.fallo)
            if args.detener_archivo and args.detener_archivo.exists():
                detener.set()
                break
            if limite is not None and time.monotonic() >= limite:
                motivo = "completada"
                break
            red_actual = receptor.estado_red()
            if escritor.filas_escritas != ultimo_conteo or red_actual != ultima_red:
                ultimo_conteo = escritor.filas_escritas
                ultima_red = red_actual
                publicar("grabando")
    except Exception as error:
        fallo = error
    finally:
        detener.set()
        try:
            receptor.cerrar()
        except Exception as error:
            fallo = fallo or error
        try:
            publicar("cerrando")
        except Exception as error:
            fallo = fallo or error
        # Cada recurso se cierra aunque falle el cierre de otro.
        for cerrar in [
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

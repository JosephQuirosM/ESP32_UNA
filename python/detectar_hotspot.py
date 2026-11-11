#!/usr/bin/env python3
"""Detecta el hotspot activo sin privilegios ni reglas de firewall."""

from __future__ import annotations

import ipaddress
import json
import os
from pathlib import Path
import subprocess
import sys


def _ejecutar(*args: str) -> str:
    return subprocess.run(args, capture_output=True, text=True, check=True, timeout=4).stdout.strip()


def detectar_hotspot() -> dict[str, str] | None:
    try:
        if os.name == "nt":
            script = Path(__file__).resolve().parents[1] / "scripts" / "detectar_hotspot.ps1"
            salida = _ejecutar("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script))
            resultado = json.loads(salida)
            if not isinstance(resultado, dict) or not resultado.get("interfaz"):
                return None
            return {"interfaz": str(resultado["interfaz"]), "ip": str(ipaddress.IPv4Address(resultado["ip"]))}

        encontrados: list[dict[str, str]] = []
        for linea in _ejecutar("nmcli", "-t", "-f", "DEVICE,TYPE,STATE", "device", "status").splitlines():
            partes = linea.split(":")
            if len(partes) < 3 or partes[1:] != ["wifi", "connected"]:
                continue
            interfaz = partes[0]
            if not interfaz or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-" for c in interfaz):
                continue
            uuid = _ejecutar("nmcli", "-g", "GENERAL.CON-UUID", "device", "show", interfaz).splitlines()[0]
            modo = _ejecutar("nmcli", "-g", "802-11-wireless.mode,ipv4.method", "connection", "show", uuid).splitlines()
            if modo != ["ap", "shared"]:
                continue
            ips = []
            for direccion in _ejecutar("ip", "-4", "-o", "address", "show", "dev", interfaz, "scope", "global").splitlines():
                partes_ip = direccion.split()
                if "inet" in partes_ip:
                    ips.append(str(ipaddress.ip_interface(partes_ip[partes_ip.index("inet") + 1]).ip))
            if len(ips) == 1:
                encontrados.append({"interfaz": interfaz, "ip": ips[0]})
        return encontrados[0] if len(encontrados) == 1 else None
    except (OSError, ValueError, IndexError, KeyError, subprocess.SubprocessError):
        return None


if __name__ == "__main__":
    print(json.dumps(detectar_hotspot(), ensure_ascii=False))

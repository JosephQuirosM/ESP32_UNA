"""Ejecuta la lógica real de debounce y filtro del firmware del jugador."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class SensoresJugadorTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("g++"), "Requiere g++")
    def test_tarjeta_y_clasificacion_movimiento(self):
        fuente = Path(__file__).parent / "firmware/sensores_jugador_test.cpp"
        with tempfile.TemporaryDirectory() as tmp:
            binario = Path(tmp) / "sensores"
            subprocess.run(["g++", "-std=c++11", "-Wall", "-Wextra", "-Werror", str(fuente), "-o", str(binario)], check=True)
            subprocess.run([str(binario)], check=True)

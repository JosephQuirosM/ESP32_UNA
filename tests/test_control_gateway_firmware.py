"""Compila y ejecuta la lógica real de control del firmware sin placas."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class ControlFirmwareTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("g++"), "Requiere g++ para la máquina de estados del firmware")
    def test_ordenes_repetidas_desordenadas_expiracion_y_reinicio(self):
        fuente = Path(__file__).parent / "firmware/control_captura_test.cpp"
        with tempfile.TemporaryDirectory() as tmp:
            destino = Path(tmp) / "control_captura"
            subprocess.run(["g++", "-std=c++11", "-Wall", "-Wextra", "-Werror", str(fuente), "-o", str(destino)], check=True)
            subprocess.run([str(destino)], check=True)

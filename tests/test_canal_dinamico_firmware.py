"""Comprueba descubrimiento y recuperación de canal con la lógica del firmware."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class CanalDinamicoTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("g++"), "Requiere g++")
    def test_busqueda_cambios_perdidas_reinicio_y_desbordamiento(self):
        fuente = Path(__file__).parent / "firmware/canal_dinamico_test.cpp"
        with tempfile.TemporaryDirectory() as tmp:
            binario = Path(tmp) / "canal"
            subprocess.run(["g++", "-std=c++11", "-Wall", "-Wextra", "-Werror",
                            str(fuente), "-o", str(binario)], check=True)
            subprocess.run([str(binario)], check=True)

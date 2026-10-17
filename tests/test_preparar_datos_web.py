"""Verifica etiquetado explícito, separación de archivos y trazabilidad web."""
import csv
import io
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from preparar_datos_web import preparar


class PreparacionWebTests(unittest.TestCase):
    def archivo(self, nombre, zona, incompleto=False):
        texto = io.StringIO()
        columnas = ["timestamp_utc_pc", "sesion_gateway", "jugador_id", "sesion_jugador", "secuencia", "mac_torre", "rssi"]
        writer = csv.writer(texto)
        writer.writerow(columnas)
        macs = ["10:06:1C:D5:95:04", "90:15:06:5A:30:D0", "10:06:1C:D5:95:8C", "10:06:1C:D4:8F:C4"]
        for mac in macs[:3 if incompleto else 4]:
            writer.writerow(["2026-10-16T00:00:00Z", 1, 1, 1, 7, mac, -50])
        return {"nombre": nombre, "zona": zona, "dataset": "dataset 1", "contenido": texto.getvalue()}

    def test_n_zonas_incluida_12_sin_recortes_ni_mezcla_de_secuencias(self):
        with tempfile.TemporaryDirectory() as tmp:
            salida = Path(tmp) / "salida.csv"
            result = preparar([self.archivo("a.csv", 1), self.archivo("b.csv", 12), self.archivo("c.csv", 12, True)], salida)
            with salida.open() as f:
                filas = list(csv.DictReader(f))
            self.assertEqual([f["zona"] for f in filas], ["1", "12", "12"])
            self.assertEqual([f["archivo_origen"] for f in filas], ["a.csv", "b.csv", "c.csv"])
            self.assertEqual(result["resumen"]["vectores_completos"], 2)
            self.assertEqual(result["resumen"]["filas_excluidas_transicion"], 0)
            self.assertEqual(filas[-1]["completo"], "0")
            self.assertTrue(salida.with_suffix(".json").exists())

    def test_rechaza_archivo_invalido_sin_publicar_csv_parcial(self):
        with tempfile.TemporaryDirectory() as tmp:
            salida = Path(tmp) / "salida.csv"
            malo = self.archivo("malo.csv", 2)
            malo["contenido"] = "rssi\n-50\n"
            with self.assertRaisesRegex(ValueError, "faltan columnas"):
                preparar([self.archivo("bueno.csv", 1), malo], salida)
            self.assertFalse(salida.exists())

    def test_rechaza_csv_sin_datos(self):
        with tempfile.TemporaryDirectory() as tmp:
            archivo = self.archivo("vacio.csv", 1)
            archivo["contenido"] = archivo["contenido"].splitlines()[0] + "\n"
            with self.assertRaisesRegex(ValueError, "no contiene lecturas"):
                preparar([archivo], Path(tmp) / "salida.csv")

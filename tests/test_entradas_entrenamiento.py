"""Entradas elegidas por el usuario sin restricciones de dataset."""
import csv
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
try:
    from entrenar_knn import cargar_entradas
    from entrenar_random_forest import entrenar_y_evaluar
except ModuleNotFoundError:
    DEPENDENCIAS = False
else:
    DEPENDENCIAS = True
from mvp_config import COLUMNAS_CARACTERISTICAS
from preparar_datos_web import preparar


@unittest.skipUnless(DEPENDENCIAS, "Ejecutar con .venv/bin/python para dependencias ML")
class EntradasLibresTests(unittest.TestCase):
    def crudo(self, ruta):
        columnas = ["timestamp_utc_pc", "sesion_gateway", "jugador_id", "sesion_jugador", "secuencia", "mac_torre", "rssi"]
        with ruta.open("w", newline="") as f:
            w = csv.writer(f); w.writerow(columnas)
            for mac in ["10:06:1C:D5:95:04", "90:15:06:5A:30:D0", "10:06:1C:D5:95:8C", "10:06:1C:D4:8F:C4"]:
                w.writerow(["2026-10-16T00:00:00Z", 1, 1, 1, 1, mac, -50])

    def preparado(self, ruta, dataset=None):
        columnas = [*COLUMNAS_CARACTERISTICAS, "zona", "completo"] + (["dataset"] if dataset is not None else [])
        with ruta.open("w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=columnas); w.writeheader()
            for zona in [4, 4]:
                row = {**dict.fromkeys(COLUMNAS_CARACTERISTICAS, -50), "zona": zona, "completo": 1}
                if dataset is not None: row["dataset"] = dataset
                w.writerow(row)

    def test_mezcla_zona4_de_datasets_distintos_sin_exigir_otras_zonas(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = Path(tmp)/"Dataset1_zona_4.csv"; b = Path(tmp)/"Dataset2_zona_4.csv"
            self.crudo(a); self.crudo(b)
            X, y, _, _ = cargar_entradas([a, b])
            self.assertEqual(len(X), 2); self.assertEqual(y, [4, 4])

    def test_preparados_con_nombres_libres_y_sin_dataset(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = Path(tmp)/"papa.csv"; b = Path(tmp)/"medidas.csv"
            self.preparado(a); self.preparado(b)
            X, y, _, _ = cargar_entradas([a, b])
            self.assertEqual(len(X), 4); self.assertEqual(y, [4]*4)
            self.crudo(Path(tmp)/"lecturas.csv")
            self.assertEqual(cargar_entradas([Path(tmp)/"lecturas.csv"], zona=4)[1], [4])

    def test_random_forest_no_bloquea_prueba_con_mismo_dataset(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = Path(tmp)/"lecturas.csv"; b = Path(tmp)/"medidas.csv"
            self.preparado(a, "dataset 1"); self.preparado(b, "dataset 1")
            r = entrenar_y_evaluar([a], [b], Path(tmp)/"modelo.joblib", Path(tmp)/"informe.json")
            self.assertEqual(r["vectores_entrenamiento"], 2)
            self.assertEqual(r["vectores_prueba"], 2)

    def test_knn_entrena_mezcla_por_defecto_sin_validacion_automatica(self):
        with tempfile.TemporaryDirectory() as tmp:
            a=Path(tmp)/"a.csv"; b=Path(tmp)/"b.csv"
            self.preparado(a, "dataset 1"); self.preparado(b, "dataset 2")
            script=Path(__file__).resolve().parents[1]/"python/entrenar_knn.py"
            subprocess.run([sys.executable, "-B", str(script), str(a), str(b), "--k", "1", "--modelo", str(Path(tmp)/"m.joblib"), "--metricas", str(Path(tmp)/"m.md"), "--metadata", str(Path(tmp)/"m.json")], check=True, capture_output=True)
            self.assertIsNone(json.loads((Path(tmp)/"m.json").read_text())["evaluacion"])

    def test_web_no_exige_dataset_ni_nombre_especial(self):
        with tempfile.TemporaryDirectory() as tmp:
            ruta=Path(tmp)/"papa.csv"; self.crudo(ruta)
            r=preparar([{"nombre":"papa.csv", "zona":4, "contenido":ruta.read_text()}],Path(tmp)/"preparado.csv")
            self.assertEqual(r["resumen"]["vectores_completos"],1)

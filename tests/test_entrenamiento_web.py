"""Pruebas de modelos configurables desde el módulo web."""
import csv
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
try:
    from entrenamiento_web import leer_csv, crear_modelo, entrenar
    import joblib
except ModuleNotFoundError:
    ML = False
else:
    ML = True
from mvp_config import COLUMNAS_CARACTERISTICAS


@unittest.skipUnless(ML, "Ejecutar con .venv/bin/python")
class EntrenamientoWebTests(unittest.TestCase):
    def csv(self, ruta):
        with ruta.open("w", newline="") as f:
            w = csv.writer(f); w.writerow([*COLUMNAS_CARACTERISTICAS, "zona", "completo"])
            for rssi, zona in [(-40, 4), (-42, 4), (-70, 12), (-72, 12)]:
                w.writerow([rssi]*4 + [zona, 1])
            w.writerow(["", -40, -40, -40, 4, 0])

    def test_modelos_y_exportacion_sin_sobrescribir(self):
        with tempfile.TemporaryDirectory() as tmp:
            raiz = Path(tmp); entrada=raiz/"papa.csv"; self.csv(entrada)
            X, y, resumen = leer_csv(entrada)
            self.assertEqual(resumen["vectores_completos"], 4)
            self.assertEqual(resumen["vectores_incompletos"], 1)
            self.assertEqual(resumen["zonas"], [4, 12])
            for i, algoritmo in enumerate(["knn", "random_forest"]):
                carpeta = raiz/f"trabajo{i}"; carpeta.mkdir()
                parametros = {"k": 1, "normalizar": False, "pesos": "uniform", "distancia": "manhattan"} if algoritmo == "knn" else {"arboles": 8, "profundidad": 3, "min_division": 2, "min_hoja": 1, "semilla": 7}
                entrenar({"entrada":str(entrada), "algoritmo":algoritmo, "parametros":parametros, "nombre":"modelo", "directorioSalida":tmp}, carpeta)
                estado=json.loads((carpeta/"estado.json").read_text())
                self.assertEqual(estado["estado"], "completado")
                self.assertIsNone(estado["evaluacion"])
                modelo=joblib.load(estado["rutaModelo"])
                self.assertEqual(modelo.predict(X).tolist(), y)
                self.assertEqual(Path(estado["rutaModelo"]).name, "modelo.joblib" if i==0 else "modelo_2.joblib")
                if algoritmo == "knn": self.assertEqual(modelo.named_steps["normalizar"], "passthrough")
                else: self.assertEqual(modelo.n_estimators, 8)

    def test_rechaza_rssi_no_finito_y_k_excesivo(self):
        with tempfile.TemporaryDirectory() as tmp:
            entrada=Path(tmp)/"malo.csv"; self.csv(entrada)
            entrada.write_text(entrada.read_text().replace("-40,-40,-40,-40", "nan,-40,-40,-40"))
            with self.assertRaisesRegex(ValueError, "RSSI inválidos"): leer_csv(entrada)
        with self.assertRaisesRegex(ValueError, "k debe"): crear_modelo("knn", {"k":5}, 4)
        with self.assertRaisesRegex(ValueError, "arboles debe"): crear_modelo("random_forest", {"arboles":0}, 4)

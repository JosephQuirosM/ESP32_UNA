"""Mapas web: CSV crudos/preparados, aislamiento del suavizado y exportación."""
import csv
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
try:
    from mapas_calor_web import generar, cargar_vectores, suavizar_series
    import joblib
    from sklearn.dummy import DummyClassifier
except ModuleNotFoundError:
    ML = False
else:
    ML = True
from mvp_config import COLUMNAS_CARACTERISTICAS


@unittest.skipUnless(ML, "Ejecutar con .venv/bin/python")
class MapasWebTests(unittest.TestCase):
    def archivos(self, raiz):
        preparado = raiz/"papa.csv"
        with preparado.open("w", newline="") as f:
            w=csv.writer(f);w.writerow([*COLUMNAS_CARACTERISTICAS,"completo"])
            for _ in range(3): w.writerow([-50,-51,-52,-53,1])
            w.writerow(["",-51,-52,-53,0])
        crudo=raiz/"lecturas.csv"
        with crudo.open("w",newline="") as f:
            w=csv.writer(f);w.writerow(["timestamp_utc_pc","sesion_gateway","jugador_id","sesion_jugador","secuencia","mac_torre","rssi"])
            for mac in ["10:06:1C:D5:95:04","90:15:06:5A:30:D0","10:06:1C:D5:95:8C","10:06:1C:D4:8F:C4"]:
                w.writerow(["2026-10-17T00:00:00Z",1,1,1,1,mac,-50])
        modelo=raiz/"modelo.joblib";joblib.dump(DummyClassifier(strategy="constant",constant=5).fit([[-50]*4],[5]),modelo)
        return preparado,crudo,modelo

    def test_lote_raw_y_preparado_no_modifica_entradas_y_no_sobrescribe(self):
        with tempfile.TemporaryDirectory() as tmp:
            raiz=Path(tmp);a,b,modelo=self.archivos(raiz)
            originales=[a.read_bytes(),b.read_bytes()]
            solicitud={"entradas":[str(a),str(b)],"modelo":str(modelo),"ventana":1,"nombre":"mis mapas","directorioSalida":tmp}
            primeras=[]
            for i in range(2):
                carpeta=raiz/f"trabajo{i}";carpeta.mkdir();generar(solicitud,carpeta)
                estado=json.loads((carpeta/"estado.json").read_text())
                self.assertEqual(estado["estado"],"completado");self.assertEqual(estado["procesados"],2)
                self.assertEqual([m["vectores"] for m in estado["mapas"]],[3,1])
                for mapa in estado["mapas"]:
                    self.assertEqual(mapa["conteos"]["5"],mapa["vectores"])
                    self.assertTrue(Path(mapa["rutaImagen"]).read_bytes().startswith(b'\x89PNG'))
                    self.assertTrue(Path(mapa["rutaPredicciones"]).exists())
                if i==0:primeras=[m["rutaImagen"] for m in estado["mapas"]]
                else:self.assertTrue(all(m["rutaImagen"] not in primeras for m in estado["mapas"]))
            self.assertEqual([a.read_bytes(),b.read_bytes()],originales)

    def test_suavizado_no_cruza_jugadores(self):
        filas=[{"jugador_id":p} for p in [1,2,1,2,1]]
        self.assertEqual(suavizar_series(filas,[1,9,2,9,2],5),[1,9,2,9,2])
        self.assertEqual(suavizar_series(filas,[1,9,2,9,2],1),[1,9,2,9,2])

    def test_error_modelo_fuera_de_cuadricula_y_csv_sin_vectores(self):
        with tempfile.TemporaryDirectory() as tmp:
            raiz=Path(tmp);a,b,modelo=self.archivos(raiz)
            joblib.dump(DummyClassifier(strategy="constant",constant=12).fit([[-50]*4],[12]),modelo)
            carpeta=raiz/"trabajo";carpeta.mkdir()
            with self.assertRaisesRegex(ValueError,"cuadrícula actual"):
                generar({"entradas":[str(a)],"modelo":str(modelo),"ventana":5,"nombre":"mapa","directorioSalida":tmp},carpeta)
            self.assertEqual(json.loads((carpeta/"estado.json").read_text())["estado"],"error")
            a.write_text("completo,rssi\n1,-50\n")
            with self.assertRaisesRegex(ValueError,"CSV preparado válido"):cargar_vectores(a)

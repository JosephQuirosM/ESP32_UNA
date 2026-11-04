"""Flujo completo con N zonas, geometría portátil y compatibilidad de archivos."""
import csv
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from cuadricula import crear_cuadricula, validar_cuadricula, coordenadas
from receptor_gateway import EscritorCsv
from preparar_datos_web import preparar
from preprocesar_calibracion import construir_muestras
from mvp_config import MAC_A_CARACTERISTICA
try:
    import joblib
    import matplotlib.pyplot as plt
    from entrenamiento_web import entrenar, leer_csv
    from mapas_calor_web import generar
    from entrenar_knn import cargar_entradas, _metricas
except ModuleNotFoundError:
    ML = False
else:
    ML = True


class GeometriaTests(unittest.TestCase):
    def test_dimensiones_y_permutacion_validas(self):
        for filas, columnas in [(1, 1), (2, 2), (3, 4), (4, 3), (20, 20)]:
            g = crear_cuadricula(filas, columnas)
            self.assertEqual(len(coordenadas(g)), filas * columnas)
            self.assertEqual(coordenadas(g)[columnas + 1] if filas > 1 else (0, 0),
                             (columnas - 1, 1) if filas > 1 else (0, 0))
        for valor in [crear_cuadricula() | {"filas": 0}, crear_cuadricula() | {"filas": True},
                      crear_cuadricula() | {"zonas": [1] * 9}, {"filas": 3, "columnas": 4}]:
            with self.assertRaises(ValueError): validar_cuadricula(valor)


@unittest.skipUnless(ML, "Ejecutar con .venv/bin/python")
class FlujoZonasTests(unittest.TestCase):
    def capturas(self, raiz, geometria):
        """Usa el escritor real y conserva el acomodo en los CSV descargables."""
        archivos = []
        for zona in geometria["zonas"]:
            ruta = raiz / f"zona_{zona}.csv"
            escritor = EscritorCsv(ruta, nuevo=True, cuadricula=geometria)
            escritor.iniciar()
            for secuencia in range(1, 4):
                self.assertTrue(escritor.encolar([
                    {"sesion_gateway": 1, "tiempo_gateway_recepcion_ms": secuencia * 500,
                     "tiempo_torre_ms": secuencia * 500, "torre_id": i + 1, "sesion_torre": 10 + i,
                     "secuencia_torre_tx": secuencia, "mac_torre": mac, "jugador_id": 1,
                     "sesion_jugador": 2, "secuencia": secuencia, "rssi": -30 - zona * 3 - i}
                    for i, mac in enumerate(MAC_A_CARACTERISTICA)]))
            escritor.cerrar()
            archivos.append({"nombre": ruta.name, "zona": zona, "contenido": ruta.read_text()})
        return archivos

    def test_captura_preparacion_knn_rf_y_mapa_de_12_zonas_reordenadas(self):
        with tempfile.TemporaryDirectory() as tmp:
            raiz = Path(tmp)
            g = crear_cuadricula(3, 4)
            g["zonas"][0], g["zonas"][-1] = g["zonas"][-1], g["zonas"][0]
            archivos = self.capturas(raiz, g)
            preparado = raiz / "etiquetado.csv"
            resultado = preparar(archivos, preparado)
            self.assertEqual(resultado["cuadricula"], g)
            self.assertEqual(resultado["resumen"]["vectores_completos"], 36)
            self.assertEqual(leer_csv(preparado)[2]["cuadricula"], g)
            self.assertEqual(sorted(set(cargar_entradas([preparado])[1])), list(range(1, 13)))
            for algoritmo, parametros in [("knn", {"k": 1}), ("random_forest", {"arboles": 20})]:
                carpeta = raiz / algoritmo; carpeta.mkdir()
                entrenar({"entrada": str(preparado), "algoritmo": algoritmo, "parametros": parametros}, carpeta)
                modelo = carpeta / "modelo.joblib"
                cargado = joblib.load(modelo)
                self.assertEqual(cargado.cuadricula_, g)
                self.assertEqual(list(cargado.classes_), list(range(1, 13)))
                mapas = carpeta / "mapas"; mapas.mkdir()
                generar({"entradas": [str(preparado), str(raiz / "zona_12.csv")], "modelo": str(modelo),
                         "ventana": 1, "nombre": algoritmo, "directorioSalida": tmp}, mapas)
                estado = json.loads((mapas / "estado.json").read_text())
                self.assertEqual(estado["estado"], "completado")
                for mapa in estado["mapas"]:
                    self.assertEqual(mapa["cuadricula"], g)
                    self.assertEqual(len(mapa["conteos"]), 12)
                    self.assertTrue(Path(mapa["rutaImagen"]).read_bytes().startswith(b"\x89PNG"))
                self.assertEqual(estado["mapas"][0]["conteos"], {str(z): 3 for z in range(1, 13)})
                self.assertEqual(estado["mapas"][1]["conteos"]["12"], 3)
                self.assertEqual(estado["mapas"][1]["conteos"]["1"], 0)

    def test_conflictos_y_archivos_anteriores_sin_geometria(self):
        with tempfile.TemporaryDirectory() as tmp:
            raiz = Path(tmp); g = crear_cuadricula(3, 4)
            archivos = self.capturas(raiz, g)
            diferente = crear_cuadricula(4, 3)
            with self.assertRaisesRegex(ValueError, "cuadrículas diferentes"):
                preparar(archivos, raiz / "no.csv", diferente)
            self.assertFalse((raiz / "no.csv").exists())
            archivos[0]["zona"] = 13
            with self.assertRaisesRegex(ValueError, "fuera de la cuadrícula"):
                preparar(archivos, raiz / "no.csv")
            # Un CSV anterior sigue sirviendo y permite asignar su geometría explícitamente.
            archivo = archivos[-1]; archivo["zona"] = 12
            lector = csv.DictReader(io.StringIO(archivo["contenido"]))
            flujo = io.StringIO(); escritor = csv.DictWriter(flujo, fieldnames=[c for c in lector.fieldnames if c != "cuadricula"])
            escritor.writeheader(); escritor.writerows([{k: v for k, v in f.items() if k != "cuadricula"} for f in lector])
            archivo["contenido"] = flujo.getvalue()
            self.assertEqual(preparar([archivo], raiz / "antiguo.csv", g)["cuadricula"], g)

    def test_mapa_modelo_anterior_con_geometria_desde_frontend_y_rechazo_de_conflicto(self):
        from sklearn.dummy import DummyClassifier
        with tempfile.TemporaryDirectory() as tmp:
            raiz = Path(tmp); g = crear_cuadricula(3, 4)
            archivos = self.capturas(raiz, g)
            preparado = raiz / "etiquetado.csv"
            preparar(archivos, preparado)
            with preparado.open() as f:
                filas = list(csv.DictReader(f))
            with preparado.open("w", newline="") as f:
                w = csv.DictWriter(f, fieldnames=[c for c in filas[0] if c != "cuadricula"])
                w.writeheader(); w.writerows([{k: v for k, v in fila.items() if k != "cuadricula"} for fila in filas])
            modelo = DummyClassifier(strategy="constant", constant=12).fit([[-50] * 4], [12])
            destino = raiz / "anterior.joblib"; joblib.dump(modelo, destino)
            carpeta = raiz / "mapas"; carpeta.mkdir()
            solicitud = {"entradas": [str(preparado)], "modelo": str(destino), "ventana": 1,
                         "nombre": "anterior", "directorioSalida": tmp, "cuadricula": g}
            generar(solicitud, carpeta)
            estado = json.loads((carpeta / "estado.json").read_text())
            self.assertEqual(estado["mapas"][0]["conteos"]["12"], 36)
            modelo.cuadricula_ = crear_cuadricula(4, 3); joblib.dump(modelo, destino)
            with self.assertRaisesRegex(ValueError, "cuadrículas diferentes"):
                generar(solicitud, carpeta)
            self.assertEqual(json.loads((carpeta / "estado.json").read_text())["estado"], "error")

    def test_render_respeta_posiciones_y_todas_las_celdas(self):
        from reproducir_mapa_calor import generar_mapa
        from collections import Counter
        with tempfile.TemporaryDirectory() as tmp:
            g = crear_cuadricula(4, 3)
            g["zonas"][0], g["zonas"][-1] = g["zonas"][-1], g["zonas"][0]
            figura, eje = plt.subplots()
            with patch("reproducir_mapa_calor.plt.subplots", return_value=(figura, eje)):
                generar_mapa(Path(tmp) / "mapa.png", Counter({g["zonas"][0]: 7}), 7, cuadricula=g)
            matriz = eje.images[0].get_array()
            self.assertEqual(matriz.shape, (4, 3))
            self.assertEqual(matriz[0, 0], 7)
            self.assertEqual(matriz.sum(), 7)
            self.assertEqual(len(eje.texts), 12)

    def test_cli_knn_con_validacion_rf_y_reproduccion_incluyen_zona12(self):
        with tempfile.TemporaryDirectory() as tmp:
            raiz = Path(tmp); g = crear_cuadricula(3, 4)
            archivos = self.capturas(raiz, g)
            preparado = raiz / "etiquetado.csv"
            preparar(archivos, preparado)
            with preparado.open() as f: filas = list(csv.DictReader(f))
            # Dos sesiones completas para validar grupos sin mezclar filas.
            with preparado.open("w", newline="") as f:
                w = csv.DictWriter(f, fieldnames=list(filas[0])); w.writeheader()
                for sesion in [2, 3]: w.writerows([{**fila, "sesion_jugador": sesion} for fila in filas])
            scripts = Path(__file__).resolve().parents[1] / "python"
            def ejecutar(script, *args):
                r = subprocess.run([sys.executable, "-B", str(scripts / script), *map(str, args)], capture_output=True, text=True, timeout=60)
                self.assertEqual(r.returncode, 0, r.stderr)
            ejecutar("entrenar_knn.py", preparado, "--validar-por-grupo", "--modelo", raiz / "knn.joblib",
                     "--metadata", raiz / "knn.json", "--metricas", raiz / "knn.md")
            self.assertIn("| 12 |", (raiz / "knn.md").read_text())
            self.assertEqual(joblib.load(raiz / "knn.joblib").cuadricula_, g)
            ejecutar("entrenar_random_forest.py", preparado, "--prueba", preparado,
                     "--modelo", raiz / "rf.joblib", "--informe", raiz / "rf.json")
            informe = json.loads((raiz / "rf.json").read_text())
            self.assertEqual(len(informe["matriz_confusion"]), 12)
            self.assertEqual(informe["por_zona"]["12"]["total"], 6)
            ejecutar("reproducir_mapa_calor.py", preparado, "--modelo", raiz / "knn.joblib",
                     "--predicciones", raiz / "pred.csv", "--mapa", raiz / "mapa.png", "--ventana", 1)
            self.assertTrue((raiz / "mapa.png").exists())
            self.assertEqual(_metricas([1, 12], [1, 12], g)["distancia_manhattan_media"], 0)

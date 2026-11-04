"""Separación exacta de filas, recepción e inferencia independiente multijugador."""
import csv
import json
from collections import Counter
from pathlib import Path
import random
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"python"))
from jugadores_mapas import leer_grupos, estadisticas, guardar_lecturas
from mvp_config import MAC_A_CARACTERISTICA
from mapas_calor_web import generar
import joblib
from sklearn.neighbors import KNeighborsClassifier

MACS = list(MAC_A_CARACTERISTICA)
COLUMNAS = ["timestamp_utc_pc", "sesion_gateway", "jugador_id", "sesion_jugador", "secuencia", "torre_id", "mac_torre", "rssi", "extra"]


def fila(jugador, secuencia, torre, sesion=7, gateway=1):
    return dict(zip(COLUMNAS, ["2026-11-04T00:00:00Z", str(gateway), str(jugador), str(sesion), str(secuencia), str(torre), MACS[torre-1], "-40" if jugador%2 else "-80", " texto, íntegro "]))


class MapasJugadoresTests(unittest.TestCase):
    def test_estadisticas_huecos_duplicados_y_reinicio(self):
        # 1..10: seis completos, dos parciales, dos ausentes.
        filas = [fila(1,s,t) for s in range(1,7) for t in range(1,5)]
        filas += [fila(1,8,1), fila(1,10,2), fila(1,1,1)]
        m = estadisticas(filas, True)
        self.assertEqual(m["total_recibido"],27)
        self.assertEqual(m["paquetes_unicos_recibidos"],26)
        self.assertEqual(m["paquetes_esperados"],40)
        self.assertEqual(m["recepcion_porcentaje"],65)
        self.assertEqual(m["vectores_completos_porcentaje"],60)
        self.assertEqual(m["secuencias_ausentes"],2)
        self.assertEqual(m["vectores_incompletos"],2)
        self.assertEqual(m["duplicados"],1)
        filas += [fila(1,1,t,sesion=8) for t in range(1,5)]
        self.assertEqual(estadisticas(filas,True)["secuencias_esperadas"],11)

    def test_uno_dos_diez_jugadores_filas_intactas_orden_y_mapas(self):
        with tempfile.TemporaryDirectory() as tmp:
            raiz=Path(tmp)
            modelo=raiz/"modelo.joblib"
            joblib.dump(KNeighborsClassifier(n_neighbors=1).fit([[-40]*4,[-80]*4],[1,9]),modelo)
            for k in (1,2,10):
                filas=[fila(j,s,t) for j in range(1,k+1) for s in (2,10) for t in (4,2,1,3)]
                filas += [dict(filas[0])]
                random.Random(4).shuffle(filas)
                entrada=raiz/f"entrada{k}.csv";guardar_lecturas(entrada,COLUMNAS,filas)
                antes=entrada.read_bytes()
                carpeta=raiz/f"trabajo{k}";carpeta.mkdir()
                generar(dict(entradas=[str(entrada)],modelo=str(modelo),nombre="prueba",ventana=5,directorioSalida=tmp),carpeta)
                estado=json.loads((carpeta/"estado.json").read_text())
                self.assertEqual(estado["estado"],"completado")
                self.assertEqual(estado["procesados"],1)
                self.assertEqual(estado["mapasGenerados"],k)
                self.assertEqual(len(estado["mapas"]),k)
                recuperadas=[]
                for m in estado["mapas"]:
                    with Path(m["rutaLecturas"]).open(newline="") as f:
                        lector=csv.DictReader(f);self.assertEqual(lector.fieldnames,COLUMNAS);exportadas=list(lector)
                    recuperadas.extend(exportadas)
                    orden=[(int(f["sesion_jugador"]),int(f["secuencia"]),int(f["torre_id"])) for f in exportadas]
                    self.assertEqual(orden,sorted(orden))
                    zona="1" if m["jugadorId"]%2 else "9"
                    self.assertEqual(m["conteos"][zona],2)
                    self.assertEqual(m["estadisticas"]["secuencias_esperadas"],9)
                    with Path(m["rutaPredicciones"]).open() as f:
                        self.assertTrue(all(int(r["jugador_id"])==m["jugadorId"] for r in csv.DictReader(f)))
                self.assertEqual(Counter(tuple(f[c] for c in COLUMNAS) for f in recuperadas),Counter(tuple(f[c] for c in COLUMNAS) for f in filas))
                self.assertEqual(entrada.read_bytes(),antes)
                self.assertEqual(len(json.loads(Path(estado["rutaResumenGeneralJson"]).read_text())["jugadores"]),k)

    def test_sin_completos_continua_y_separa_gateways(self):
        with tempfile.TemporaryDirectory() as tmp:
            raiz=Path(tmp);entrada=raiz/"entrada.csv"
            filas=[fila(1,1,1)]+[fila(2,1,t) for t in range(1,5)]+[fila(1,1,t,gateway=2) for t in range(1,5)]
            guardar_lecturas(entrada,COLUMNAS,filas)
            modelo=raiz/"modelo.joblib";joblib.dump(KNeighborsClassifier(n_neighbors=1).fit([[-40]*4],[1]),modelo)
            carpeta=raiz/"trabajo";carpeta.mkdir()
            generar(dict(entradas=[str(entrada)],modelo=str(modelo),nombre="prueba",ventana=1,directorioSalida=tmp),carpeta)
            estado=json.loads((carpeta/"estado.json").read_text())
            self.assertEqual(estado["mapasGenerados"],2)
            self.assertEqual(len(estado["mapas"]),3)
            vacio=estado["mapas"][0]
            self.assertFalse(vacio["tieneMapa"])
            self.assertIsNone(vacio["rutaImagen"])
            self.assertTrue(Path(vacio["rutaLecturas"]).exists())

    def test_limite_diez_y_torre_desconocida(self):
        with tempfile.TemporaryDirectory() as tmp:
            entrada=Path(tmp)/"entrada.csv"
            guardar_lecturas(entrada,COLUMNAS,[fila(j,1,1) for j in range(1,12)])
            with self.assertRaisesRegex(ValueError,"10 jugadores"):leer_grupos(entrada)
            entrada.write_text("completo,completo\n1,1\n")
            with self.assertRaisesRegex(ValueError,"columnas repetidos"):leer_grupos(entrada)
            mala=fila(1,1,1);mala["mac_torre"]="00:00:00:00:00:00"
            with self.assertRaisesRegex(ValueError,"MAC de torre"):estadisticas([mala],True)

    def test_preparado_metricas_no_inventadas(self):
        from mvp_config import COLUMNAS_CARACTERISTICAS
        with tempfile.TemporaryDirectory() as tmp:
            entrada=Path(tmp)/"preparado.csv"
            columnas=[*COLUMNAS_CARACTERISTICAS,"completo","jugador_id"]
            guardar_lecturas(entrada,columnas,[dict(zip(columnas,["-50"]*4+["1","1"])),dict(zip(columnas,["-50"]*4+["0","2"]))])
            _,crudo,grupos=leer_grupos(entrada)
            self.assertFalse(crudo)
            self.assertEqual(len(grupos),2)
            m=estadisticas(grupos[(None,1)],False)
            self.assertIsNone(m["recepcion_porcentaje"])
            self.assertIsNone(m["vectores_completos_porcentaje"])
            self.assertEqual(m["vectores_completos"],1)

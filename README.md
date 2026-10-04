# MVP: mapa de calor RSSI con ESP32

Este repositorio implementa el MVP de un mapa de calor RSSI: 1 jugador, 4 torres ESP32 y 1 Gateway. El checkpoint actual conserva la comunicación, el receptor y el pipeline KNN, pero no contiene datasets, modelos entrenados ni resultados experimentales.

## Arquitectura

```text
Jugador -- beacon ESP-NOW broadcast --> Torres (x4)
                                           |
                              registro ESP-NOW unicast escalonado
                                           v
Gateway -- anuncio UDP --> PC/backend -- respuesta UDP unicast --> Gateway
Gateway -- HTTP POST --> PC/receptor CSV
```

La PC crea el hotspot Wi-Fi y el Gateway se conecta a él como estación, con el nombre y la clave de `firmware/Gateway/config.h`. El hotspot debe usar 2.4 GHz y el mismo canal ESP-NOW que Gateway, torres y jugador (6 por defecto). El Gateway anuncia su presencia cada dos segundos al broadcast calculado de su red. El backend de la PC escucha UDP 4210 y responde por unicast; durante una captura indica el puerto del receptor HTTP, que recibe lotes JSON v3 en `/v1/registros`. No es necesario configurar el broadcast en la PC para usar la interfaz web. El protocolo ESP-NOW también es v3; los seis dispositivos deben tener esta misma versión cargada.

> Estado actual: preparar una nueva calibración 3×3 de 6 m × 2,5 m. Los datos anteriores fueron eliminados deliberadamente; no deben usarse ni citarse como línea base.

## Requisitos

- Seis ESP32 IdeaBoard: 1 jugador, 4 torres y 1 Gateway.
- Arduino IDE con el paquete **esp32 by Espressif Systems 3.x**.
- Python 3.10 o superior; el receptor no requiere paquetes externos.

> El RSSI se toma de `esp_now_recv_info_t::rx_ctrl` y por ello requiere Arduino-ESP32 3.x / ESP-IDF 5.1 o posterior.

## Carga de firmware

1. Abra `firmware/Jugador/Jugador.ino` en Arduino IDE y cárguelo en la placa del jugador.
2. Abra `firmware/Torre/Torre.ino` y cárguelo en cada una de las cuatro torres.
3. Abra `firmware/Gateway/Gateway.ino` y cárguelo en la placa Gateway.
4. Revise los `config.h` antes de cargar: especialmente nombre/clave del hotspot y canal. Todas las placas deben compartir el mismo canal.

No es necesario cambiar el ID al cargar cada jugador o torre. Con `ID_JUGADOR_RESPALDO=0` e `ID_TORRE_RESPALDO=0`, el Gateway asigna los IDs dinámicamente según la MAC durante cada arranque. Los cuatro GPIO del driver de motores integrado se fuerzan a nivel bajo al iniciar para evitar activaciones accidentales.

Importante para KNN: el `torre_id` dinámico sirve para la comunicación, no para representar una posición física. Para la calibración de 6 m × 2,5 m, la conversión a columnas del modelo debe hacerse por MAC usando [el mapa de torres físicas](docs/mapa_torres_fisicas.md).

Las rutas relativas a `../Comun` son intencionales: `Paquete.h`, `RadioComun.h` y `LedEstado.h` se comparten entre los tres sketches. No mueva cada `.ino` fuera de su carpeta.

## Interfaz web local de recolección

El frontend, el backend y el receptor Python se ejecutan en esta misma PC. Prepare la aplicación una vez con Node.js 22.12+ y Python 3.10+:

```bash
npm run instalar
npm run build
npm start
```

Active el hotspot de la PC con las credenciales de `firmware/Gateway/config.h`, encienda el Gateway, abra `http://localhost:8000` y configure el nombre y la duración en Recolección. El modo manual crea un CSV; el guiado crea un CSV por zona confirmada y permite saltar zonas sin crear archivos. No necesita escribir un comando Python por captura.

Python controla el tiempo y cierra el CSV aunque el navegador pierda conexión. Los archivos se guardan en `data/raw`, con fecha y hora de inicio en Costa Rica, y pueden descargarse desde Datasets. Consulte [backend/README.md](backend/README.md) para configuración, recuperación y pruebas. El etiquetado KNN de estas nuevas capturas por zona requiere una adaptación posterior; la captura conserva el protocolo v3 y el Gateway ahora se conecta al hotspot de la PC.

## Receptor Python

Active primero el hotspot de la PC y configure su nombre y clave en `firmware/Gateway/config.h` antes de cargar el Gateway. Como alternativa a la web, ejecute el receptor por terminal con un archivo nuevo:

```bash
python3 python/receptor_gateway.py --archivo data/raw/captura_YYYY-MM-DD_HHMM.csv
```

El receptor independiente escucha HTTP en 8080 y los anuncios del Gateway en UDP 4210. Responde al ESP32 por unicast, sin necesidad de configurar una IP ni un broadcast. No ejecute esta alternativa junto con el backend: ambos necesitan el puerto UDP. Para firmware anterior, `--anuncio-udp-legacy --destino-udp DIRECCION` conserva el anuncio desde la PC; la captura web no utiliza ese modo.

El Gateway recibe su IP por DHCP y reintenta conectarse al hotspot cada diez segundos. Si el canal no coincide, informa el error por serial y no inicia el envío de registros; ajuste el canal y reconecte. Para detener el receptor, use `Ctrl+C`; HTTP, UDP y el CSV se cierran de forma ordenada. El CSV v3 conserva sesiones, secuencias, tiempos locales y hora UTC de la PC. No anexe una captura v3 a un CSV v2.

Ejecute las pruebas locales con:

```bash
python3 -m unittest discover -s tests -v
```

## Checkpoint: nueva calibración 6 m × 2,5 m

El MVP usa la identidad física de las torres (MAC), nunca el `torre_id` dinámico. La fuente de verdad es [docs/mapa_torres_fisicas.md](docs/mapa_torres_fisicas.md). Sus características tienen siempre este orden: superior izquierda, superior derecha, inferior izquierda e inferior derecha.

Instale las dependencias de análisis una vez:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

Cuando se haya capturado el nuevo CSV de calibración, se procesará así:

```bash
.venv/bin/python python/preprocesar_calibracion.py \
  data/raw/calibracion_6x2_5m_nueva.csv \
  --salida data/processed/calibracion_6x2_5m_nueva.csv \
  --resumen data/processed/calibracion_6x2_5m_nueva_resumen.json

.venv/bin/python python/entrenar_knn.py data/processed/calibracion_6x2_5m_nueva.csv \
  --modelo models/knn_mvp_6x2_5m_nueva.joblib \
  --metricas data/processed/evaluacion_knn_mvp_6x2_5m_nueva.md \
  --metadata models/knn_mvp_6x2_5m_nueva.json

.venv/bin/python python/reproducir_mapa_calor.py data/processed/calibracion_6x2_5m_nueva.csv \
  --modelo models/knn_mvp_6x2_5m_nueva.joblib \
  --predicciones data/processed/predicciones_knn_mvp_6x2_5m_nueva.csv \
  --mapa data/processed/mapa_calor_knn_mvp_6x2_5m_nueva.png
```

El preprocesamiento actual etiqueta zonas 1 a 9 en bloques consecutivos de **60 segundos** y elimina los primeros **6 segundos** de cada bloque. Antes de capturar, confirme que este protocolo coincide con el recorrido físico planificado. Toda nueva sesión debe conservar su identidad para que la evaluación no mezcle capturas temporalmente correlacionadas.

Después de una captura real, genere el informe de integridad con:

```bash
python3 python/analizar_captura.py data/raw/captura_YYYY-MM-DD_HHMM.csv \
  --log-gateway data/raw/gateway_YYYY-MM-DD_HHMM.log \
  --log-torre data/raw/torre_1_YYYY-MM-DD_HHMM.log \
  --log-torre data/raw/torre_2_YYYY-MM-DD_HHMM.log \
  --log-torre data/raw/torre_3_YYYY-MM-DD_HHMM.log \
  --log-torre data/raw/torre_4_YYYY-MM-DD_HHMM.log \
  --salida data/processed/informe_YYYY-MM-DD_HHMM.md
```

Consulte [docs/prueba_campo_captura.md](docs/prueba_campo_captura.md) antes de realizar la prueba de diez minutos.

## Diagnóstico rápido

- Si las torres no reciben, confirme que el Gateway usa canal 6 y que jugador/torres no se conectaron a otra red Wi-Fi.
- Si el Gateway muestra `destino_pc=no` antes de capturar, es normal: aún no hay receptor activo. Debe mostrar `PC confirmada` y la web «Comunicando con la PC». Durante una captura debe mostrar `PC descubierta` y el puerto HTTP. Si no confirma la PC, revise que el backend escuche UDP 4210 y que el firewall permita los anuncios del hotspot.
- Si aparece `HTTP no entregó lote`, revise que el firewall de la PC permita conexiones HTTP al puerto 8080 y anuncios UDP al puerto 4210 desde la red del hotspot de la PC.
- Los IDs se reservan por MAC mientras el Gateway está encendido; reiniciarlo reinicia esa reserva. Cada torre debe mostrar un ID distinto por serial.
- Cada torre debe mostrar `gateway_unicast=si`. `tx_fallidas` o `descartes_cola` crecientes identifican un problema anterior a HTTP.
- Active primero el hotspot de la PC, encienda Gateway e inicie el receptor; espere `PC confirmada` antes de encender torres y jugador; al iniciar una captura recibirá el destino HTTP. Consulte [el descubrimiento del Gateway](docs/descubrimiento_gateway.md).
- No reutilice un CSV entre pruebas: el receptor anexa filas y puede mezclar sesiones de jugador.

Consulte [docs/contexto.md](docs/contexto.md) para rutas y flujo detallado.

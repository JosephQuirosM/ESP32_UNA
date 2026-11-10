# MVP: mapa de calor RSSI con ESP32

Este repositorio implementa el MVP de un mapa de calor RSSI: 1 jugador, 4 torres ESP32 y 1 Gateway. Incluye firmware ESP-NOW v4, una aplicación local React/Express y procesos Python para captura CSV, preparación, entrenamiento KNN/Random Forest y mapas de predicción. Los datasets, modelos y resultados generados se excluyen de Git; pueden existir en la copia local.

## Arquitectura

```text
Jugador -- beacon ESP-NOW broadcast --> Torres (x4)
                                           |
                              registro ESP-NOW unicast escalonado
                                           v
Gateway -- anuncio UDP --> PC/backend -- respuesta UDP unicast --> Gateway
Gateway -- HTTP POST :8080 /v1/registros --> PC/receptor Python --> CSV
Navegador React <-- HTTP /api :8000 --> PC/backend Express --> procesos Python
CSV --> vectores RSSI --> KNN / Random Forest --> predicciones y mapa PNG
```

La PC crea el hotspot Wi-Fi y el Gateway se conecta a él como estación, con el nombre y la clave de `firmware/Gateway/config.h`. El hotspot debe usar 2.4 GHz y el mismo canal ESP-NOW que Gateway, torres y jugador (6 por defecto). El Gateway anuncia su presencia cada dos segundos al broadcast calculado de su red. El backend de la PC escucha UDP 4210 y responde por unicast; para una captura preparada autoriza su UUID y puerto HTTP, espera el ACK de limpieza y apertura, y después inicia la duración del receptor, que recibe lotes JSON v3 en `/v1/registros`. No es necesario configurar el broadcast en la PC para usar la interfaz web. El protocolo ESP-NOW también es v4; los seis dispositivos deben tener esta misma versión cargada.

> Documentación vigente: [arquitectura y contratos](docs/arquitectura.md), [contexto del proyecto](docs/contexto.md) y [estado de implementación](docs/avances.md). La geometría física documentada es 6 m × 2,5 m; compruebe la geometría y procedencia de cada campaña antes de usar sus datos.

## Requisitos

- Seis ESP32 IdeaBoard: 1 jugador, 4 torres y 1 Gateway.
- Arduino IDE con el paquete **esp32 by Espressif Systems 3.x**.
- Node.js 22.12+ para la aplicación React/Express.
- Python 3.10 o superior; el receptor no requiere paquetes externos. Preparación funciona con la biblioteca estándar; entrenamiento y mapas requieren `requirements.txt`.

> El RSSI se toma de `esp_now_recv_info_t::rx_ctrl` y por ello requiere Arduino-ESP32 3.x / ESP-IDF 5.1 o posterior.

## Carga de firmware

1. Abra `firmware/Jugador/Jugador.ino` en Arduino IDE y cárguelo en la placa del jugador.
2. Abra `firmware/Torre/Torre.ino` y cárguelo en cada una de las cuatro torres.
3. Abra `firmware/Gateway/Gateway.ino` y cárguelo en la placa Gateway.
4. Revise los `config.h` antes de cargar: especialmente nombre/clave del hotspot y canal. Todas las placas deben compartir el mismo canal.

No es necesario cambiar el ID al cargar cada jugador o torre. Con `ID_JUGADOR_RESPALDO=0` e `ID_TORRE_RESPALDO=0`, el Gateway asigna los IDs dinámicamente según la MAC durante cada arranque. Los cuatro GPIO del driver de motores integrado se fuerzan a nivel bajo al iniciar para evitar activaciones accidentales.

Importante para los modelos: el `torre_id` dinámico sirve para la comunicación, no para representar una posición física. Para la calibración de 6 m × 2,5 m, la conversión a columnas del modelo debe hacerse por MAC usando [el mapa de torres físicas](docs/mapa_torres_fisicas.md).

Las rutas relativas a `../Comun` son intencionales: `Paquete.h`, `RadioComun.h` y `LedEstado.h` se comparten entre los tres sketches. No mueva cada `.ino` fuera de su carpeta.

## Interfaz web local de recolección

El backend Express y Python se ejecutan en la PC de captura; el frontend React se ejecuta en el navegador de la PC o del móvil conectado al hotspot. Prepare la aplicación una vez con Node.js 22.12+ y Python 3.10+:

```bash
npm run instalar
npm run build
npm start
```

Active el hotspot de la PC con las credenciales de `firmware/Gateway/config.h`, encienda el Gateway, abra `http://localhost:8000` y configure el nombre y la duración en Recolección. El modo manual crea un CSV; el guiado crea un CSV por zona confirmada y permite saltar zonas sin crear archivos. No necesita escribir un comando Python por captura.

Python controla el tiempo y cierra el CSV aunque el navegador pierda conexión. Los archivos se guardan en `data/raw`, con fecha y hora de solicitud en Costa Rica por defecto, y pueden descargarse desde Datasets. Consulte [backend/README.md](backend/README.md) para configuración, recuperación y pruebas. La preparación ya admite estas capturas: asigna una zona por archivo y reúne las cuatro RSSI sin recortes por tiempo. El Gateway descarta lecturas fuera de captura y limpia cola, lote y reintentos en cada cambio de identidad. El botón muestra un spinner hasta que el Gateway confirma el inicio; entonces comienza el tiempo. Véase [el control de capturas](docs/descubrimiento_gateway.md).

## Receptor Python

Active primero el hotspot de la PC y configure su nombre y clave en `firmware/Gateway/config.h` antes de cargar el Gateway. Como alternativa a la web, ejecute el receptor por terminal con un archivo nuevo:

```bash
python3 python/receptor_gateway.py --archivo data/raw/captura_YYYY-MM-DD_HHMM.csv --nuevo
```

El receptor independiente escucha HTTP en 8080 y los anuncios del Gateway en UDP 4210. Responde al ESP32 por unicast, sin necesidad de configurar una IP ni un broadcast. No ejecute esta alternativa junto con el backend: ambos necesitan el puerto UDP. El CLI también exige la confirmación de limpieza y apertura antes de iniciar su plazo. El modo `--anuncio-udp-legacy` ya no se admite: actualice el Gateway.

El Gateway recibe su IP por DHCP y reintenta conectarse al hotspot cada diez segundos. Si el canal no coincide, informa el error por serial y no inicia el envío de registros; ajuste el canal y reconecte. Para detener el receptor, use `Ctrl+C`; HTTP, UDP y el CSV se cierran de forma ordenada. El CSV v4 conserva sesiones, secuencias, tiempos locales, hora UTC de la PC y estado de movimiento. Los CSV históricos sin la columna de movimiento siguen siendo válidos. No anexe una captura v4 a un CSV v3.

Después de instalar las dependencias de análisis en `.venv`, ejecute las pruebas locales con:

```bash
.venv/bin/python -m unittest discover -s tests -v
```

## Preparación y entrenamiento por archivos

El MVP usa la identidad física de las torres (MAC), nunca el `torre_id` dinámico. La fuente de verdad es [docs/mapa_torres_fisicas.md](docs/mapa_torres_fisicas.md). Sus características tienen siempre este orden: superior izquierda, superior derecha, inferior izquierda e inferior derecha.

Instale las dependencias de análisis una vez:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

Los comandos siguientes son ejemplos: sustituya las carpetas por entradas existentes. Git no distribuye esos datasets. Puede entrenar directamente con los CSV por zona de una carpeta, sin crear previamente un CSV combinado:

```bash
.venv/bin/python python/entrenar_knn.py \
  "data/raw/dataset 1/dataset 1 Cleaned" \
  --k 5 \
  --modelo models/knn_dataset1.joblib \
  --metricas data/processed/evaluacion_dataset1.md \
  --metadata models/knn_dataset1.json
```

También acepta archivos individuales, carpetas y varios CSV preparados, mezclando capturas libremente. No exige nueve archivos ni un conjunto completo de zonas por dataset. Por defecto entrena todas las entradas con `--k` (5); la evaluación y selección de K por grupos es opcional con `--validar-por-grupo`. El entrenamiento convierte internamente las lecturas en vectores, sin guardar un CSV combinado permanente ni hacer recortes por tiempo.

Los CSV separados por zona se procesan juntos indicando las carpetas Cleaned:

```bash
.venv/bin/python python/preprocesar_calibracion.py \
  "data/raw/dataset 1/dataset 1 Cleaned" \
  "data/raw/dataset 2/dataset 2 Cleaned" \
  "data/raw/dataset 3/dataset 3 Cleaned" \
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

El preprocesamiento obtiene la zona de `zona_Z` en el nombre; el prefijo DatasetN es opcional. Para archivos crudos con nombres libres como `lecturas.csv`, indique `--zona 4` (aplica a todos los crudos de esa invocación) o use la preparación web para asignar una zona por archivo. Acepta carpetas sin búsqueda recursiva o archivos individuales y genera un único CSV de vectores para entrenar. No elimina segundos iniciales, no divide en bloques de 60 segundos ni quita cantidades fijas de filas. Si utiliza una carpeta Cleaned, la limpieza previa debe estar documentada junto a sus originales. Cada archivo se agrupa por separado para evitar mezclar secuencias entre zonas. Se conserva la procedencia en `dataset` y `archivo_origen`.

Se mantienen los controles de MAC, duplicados y vectores incompletos: el KNN requiere las cuatro RSSI de una misma secuencia y sólo entrena con `completo=1`. Sólo si se solicita `--validar-por-grupo`, la evaluación retiene grupos completos por turno. La columna dataset es opcional y no restringe qué capturas pueden combinarse. Los CSV procesados antiguos sin columna `dataset` conservan la agrupación por sesión.

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

Consulte [docs/prueba_campo_captura.md](docs/prueba_campo_captura.md) antes de realizar una campaña; la duración es configurable.

## Diagnóstico rápido

- Si las torres no reciben, confirme que el Gateway usa canal 6 y que jugador/torres no se conectaron a otra red Wi-Fi.
- Si el Gateway muestra `destino_pc=no` antes de capturar, es normal: aún no hay receptor activo. La web debe mostrar «Comunicando con la PC». Al cambiar de captura, el serial publica `Control captura`, con revisión, ID y puerto; sin captura el puerto es 0. Si no confirma la PC, revise que el backend escuche UDP 4210 y que el firewall permita los anuncios del hotspot.
- Si aparece `HTTP falló` o `HTTP descartó lote`, revise que el firewall de la PC permita conexiones HTTP al puerto 8080 y anuncios UDP al puerto 4210 desde la red del hotspot de la PC.
- Los IDs se reservan por MAC mientras el Gateway está encendido; reiniciarlo reinicia esa reserva. Cada torre debe mostrar un ID distinto por serial.
- Cada torre debe mostrar `gateway_unicast=si`. `tx_fallidas` o `descartes_cola` crecientes identifican un problema anterior a HTTP.
- En la web, active primero el hotspot, inicie el backend y encienda el Gateway; espere «Comunicando con la PC» antes de encender torres y jugador. Al iniciar una captura recibirá el destino HTTP. En el CLI independiente, el receptor se prepara y espera el ACK del Gateway antes de grabar. Consulte [el descubrimiento del Gateway](docs/descubrimiento_gateway.md).
- No reutilice un CSV entre pruebas. La web crea archivos nuevos y el CLI con `--nuevo` rechaza nombres existentes; el CLI sin esa opción puede anexar filas y mezclar sesiones.

Consulte [docs/contexto.md](docs/contexto.md) para rutas y flujo detallado.

## Random Forest con CSV por zona

Acepta los mismos CSV preparados o crudos y carpetas que KNN. El usuario elige las entradas de entrenamiento y prueba: no se rechazan por compartir dataset o sesión. No exige nueve archivos ni cobertura de todas las zonas por captura. No aplica recortes temporales adicionales. Usa 300 árboles y semilla 42, sin seleccionar parámetros con la prueba.

```bash
.venv/bin/python python/entrenar_random_forest.py \
  "data/raw/dataset 1/dataset 1 Cleaned" \
  --prueba "data/raw/dataset 3/dataset 3 Cleaned" \
  --modelo models/random_forest_dataset1_cleaned.joblib \
  --informe data/processed/random_forest_1_prueba_3.json
```

Los informes experimentales son artefactos locales excluidos de Git. Su existencia y validez deben verificarse antes de citar métricas; este README no establece una precisión del sistema.

## Análisis desde la interfaz y límites actuales

Preparación permite subir CSV, asignar zona por archivo y descargar un CSV de vectores y su resumen. Entrenamiento web recibe un CSV preparado y configura KNN o Random Forest; guarda `.joblib` y JSON sin ejecutar una evaluación automática. Mapas recibe uno o varios CSV crudos o preparados y un modelo, aplica suavizado causal por archivo/jugador/sesión y separa hasta 10 jugadores por sesión del Gateway: exporta sus lecturas intactas y ordenadas, PNG individuales y resúmenes de recepción en CSV/JSON. Si un jugador no tiene vectores completos, conserva sus lecturas y estadísticas sin generar PNG. Los porcentajes de recepción y vectores completos usan el rango entre primera y última secuencia observadas de cada sesión, sin contar duplicados. Entrenamiento y mapas usan rutas de la PC y requieren acceso desde esa misma PC; la recolección y Datasets también pueden usarse desde el móvil.

El preset inicial es 3×3 (9 zonas). En Recolección puede cambiar filas y columnas desde el frontend, hasta 20×20, e intercambiar posiciones. Las capturas guiadas nuevas incluyen una columna adicional `cuadricula` con esa geometría. Preparación la conserva en el CSV etiquetado y Entrenamiento la guarda dentro del `.joblib` y el resumen JSON. Mapas utiliza automáticamente las dimensiones y posiciones del modelo o CSV, incluyendo zonas sin predicciones.

Para usar 12 zonas, elija 3 filas y 4 columnas en Recolección y siga el flujo habitual de etiquetar, entrenar y generar mapas. No necesita editar código ni firmware. Con archivos anteriores sin geometría, active «Definir cuadrícula» en Preparación o Mapas y seleccione sus dimensiones y acomodo. Los modelos anteriores siguen usando 3×3 si no se indica otra configuración. No se permite mezclar geometrías incompatibles.

Los entrenamientos web y CLI admiten etiquetas enteras positivas; no exigen medir todas las zonas ni tener nueve archivos. Los mapas representan conteos/proporciones de predicciones, sin integrar tiempos entre muestras. No hay inferencia en vivo ni interpolación continua implementada.

## Documentación y verificación

- [Arquitectura actual](docs/arquitectura.md): componentes, contratos, colas, persistencia y límites.
- [Descubrimiento del Gateway](docs/descubrimiento_gateway.md): mensajes UDP y confirmación de la PC.
- [Mapa físico](docs/mapa_torres_fisicas.md) y [protocolo de captura](docs/prueba_campo_captura.md).
- [Backend](backend/README.md) y [frontend](frontend/README.md): ejecución, API y flujos.
- [Roadmap](ROADMAP_CODEX_MAPA_CALOR_ESP32.md): planificación y propuestas históricas, diferenciadas del código vigente.

`Informacion.docx`, `Roadmap_Proyecto_Mapa_de_Calor_ESP32.pdf` y `references/` se conservan como material de referencia original. No definen el contrato de transmisión ni el estado actual; consulte los documentos Markdown anteriores para operar o modificar el sistema.

```bash
npm run build
npm test --prefix backend
.venv/bin/python -m unittest discover -s tests -v
```

Las pruebas locales no sustituyen una comprobación de radio con las placas ni una evaluación experimental del modelo.

### Geometría en consola

Los scripts de preparación, KNN, Random Forest y reproducción recuperan la columna `cuadricula` si existe. Para CSV antiguos puede proporcionar `--filas 3 --columnas 4` (serpentina) o `--cuadricula ruta/geometria.json` con `{ "filas": 3, "columnas": 4, "zonas": [1,2,3,4,8,7,6,5,9,10,11,12] }`. Las posiciones de `zonas` van por celdas de izquierda a derecha y de arriba abajo. Las opciones explícitas deben coincidir con cualquier geometría ya embebida. Los CLI de entrenamiento pueden clasificar etiquetas positivas sin geometría; las métricas espaciales requieren una geometría conocida y los mapas necesitan que las etiquetas quepan en la cuadrícula.

## Capturas aisladas en el Gateway

El control UDP V3 identifica cada captura con su UUID y una revisión persistida. Sin autorización el Gateway escucha radio, pero descarta RSSI y mantiene vacíos la cola y el lote HTTP. Cada captura nueva limpia los pendientes antes de confirmar; una renovación de la misma orden no los elimina. El HTTP añade `X-Heatmap-Captura` y Python rechaza IDs anteriores. No hay órdenes de captura nuevas para jugador ni torres. El paquete ESP-NOW v4 añade el movimiento; los tres tipos de placa deben actualizarse juntos.

En manual y guiado el formulario permanece visible con el botón deshabilitado y un spinner hasta confirmar. Si no hay confirmación en 10 s se informa un error y se conservan los archivos fallidos. Las pausas entre zonas desactivan el Gateway. El límite es la recepción en Gateway; las torres conservan sus propios tiempos y pequeñas colas.

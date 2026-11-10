# Protocolo de captura y calibración

## Objetivo

Obtener CSV v4 con procedencia y etiquetas fiables para entrenar y evaluar clasificadores RSSI. La geometría física documentada es 6 m × 2,5 m, con cuatro torres y preset de cuadrícula 3×3. El administrador puede configurar otras dimensiones desde el frontend (hasta 20×20); sus posiciones se conservan hasta el mapa. Registre la geometría realmente utilizada en cada campaña.

## Antes de iniciar

1. Monte el área y mantenga las torres inmóviles. Verifique [mapa_torres_fisicas.md](mapa_torres_fisicas.md) y su correspondencia con `python/mvp_config.py`.
2. Cargue el firmware compatible v4 en las seis placas. Revise las credenciales del hotspot y el mismo canal en todos los `config.h`.
3. Active el hotspot de la PC en 2.4 GHz, canal 6 por defecto. El Gateway se conecta como estación; no crea la red.
4. Para la captura web, compile con `npm run build`, levante `npm start` y abra `http://localhost:8000`. Encienda el Gateway y espere «Comunicando con la PC»; después encienda torres y jugador.
5. Confirme IDs distintos por rol, `gateway_unicast=si` en las torres y contadores de recepción en Gateway. Guarde logs seriales del Gateway y de las cuatro torres en `data/logs/`.
6. Defina antes de capturar duración, zona, orientación, rotaciones y separación entre entrenamiento y prueba. Los 60 s iniciales del formulario son configurables, no un requisito del preprocesamiento.

## Recolección por zona

- En modo guiado elija filas y columnas (3×3 por defecto) y acomode las zonas antes de comenzar. La geometría se guardará en cada CSV y viajará al etiquetado, modelo y mapa. Confirme su posición antes de iniciar cada archivo. Saltar una zona no crea CSV y completar una captura deja la siguiente esperando confirmación.
- En modo manual use un nombre con `zona_N` si después va a preparar por CLI, o asigne la zona por archivo en Preparación de Datos.
- Para calibración, cada CSV debe corresponder a una sola zona. Un recorrido por varias zonas dentro de un CSV no recibe etiquetas temporales automáticamente. Para predicción puede utilizarse un recorrido sin etiquetas.
- El preprocesamiento conserva todos los registros: no elimina los primeros 6 s ni una cantidad fija de filas. Cualquier limpieza previa debe documentarse y conservar el original.
- No reinicie las placas durante una captura planificada. Si sucede, registre el evento y separe o revise los datos antes de utilizarlos.

### Comprobar el aislamiento entre capturas

El Gateway debe estar actualizado y anunciar `controlCaptura: 1`. Sin grabación continúa escuchando radio, pero descarta RSSI y mantiene vacíos cola y lote. Al pulsar Grabar se ve un spinner; el cronómetro comienza sólo tras confirmar el Gateway. En cada inicio nuevo deben aparecer por serial ID y revisión nuevos y limpieza de pendientes. Entre zonas el puerto de control vuelve a 0.

Deje transmitir durante una pausa y compruebe que crece `descartes_inactivos`, separado de pérdidas por cola llena. Grabe dos zonas consecutivas, incluso con pausa corta, y conserve logs y CSV. Los POST anteriores se rechazan por su ID. Este control no sincroniza relojes ni vacía las pequeñas colas de las torres: revise tiempos y secuencias para interpretar el instante físico de cada medición.

## Alternativa por terminal

Detenga el backend antes de usar el receptor independiente: ambos necesitan UDP 4210. El receptor CLI escucha al Gateway y responde por unicast, sin configurar IP ni broadcast de la PC.

```bash
python3 python/receptor_gateway.py \
  --archivo data/raw/calibracion_zona_1_SESION.csv \
  --duracion 60 \
  --nuevo
```

Sustituya `SESION` por un identificador nuevo. `--nuevo` evita anexar a un archivo existente. `--duracion` cierra automáticamente; `Ctrl+C` solicita una parada anticipada. Este CLI no crea los metadatos de Datasets de la API web.

## Después de capturar

1. Espere el cierre del CSV y conserve también los archivos detenidos o parciales para diagnóstico.
2. Genere un informe para cada captura, ajustando rutas e IDs esperados si fueran diferentes de 1–4:

```bash
python3 python/analizar_captura.py data/raw/calibracion_zona_1_SESION.csv \
  --log-gateway data/logs/gateway_SESION.log \
  --log-torre data/logs/torre_1_SESION.log \
  --log-torre data/logs/torre_2_SESION.log \
  --log-torre data/logs/torre_3_SESION.log \
  --log-torre data/logs/torre_4_SESION.log \
  --salida data/processed/informe_SESION.md
```

3. Revise cobertura de las cuatro torres, duplicados, sesiones, huecos de transmisión y descartes. El diagnóstico por ID lógico no sustituye la tabla MAC→posición del modelo.
4. Prepare los CSV con zona explícita por archivo; sólo los vectores completos entran al modelo. Mantenga las cuatro posiciones físicas constantes entre calibración y prueba.
5. Elija y documente las entradas de entrenamiento y evaluación. El entrenamiento web no calcula precisión; los mapas de predicción tampoco la miden.

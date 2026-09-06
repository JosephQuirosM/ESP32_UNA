# Avances

## Codificación 2: estabilización de captura RSSI

El protocolo ESP-NOW se actualizó a versión 2. El jugador genera una sesión de arranque y no transmite beacons hasta tener un ID asignado. Cada torre conserva esa sesión junto con RSSI, secuencia y su tiempo local; el Gateway añade su propia sesión y el tiempo de recepción.

El Gateway crea un hotspot Wi‑Fi en canal 6, registra torres y jugadores por MAC, les asigna IDs lógicos en memoria y valida que cada registro RSSI provenga de la MAC registrada para el ID de torre declarado. Usa colas independientes para control y telemetría; conserva un lote HTTP pendiente y aplica reintentos con backoff.

El receptor Python, sin dependencias externas, valida tipos, rangos y tamaño de lote, y guarda los lotes mediante una cola acotada. Al recibir `Ctrl+C`, drena los lotes aceptados antes de cerrar el archivo. Se agregaron pruebas para el contrato v2, lotes inválidos y cierre ordenado.

## Validación física inicial 2026 09 06

Se completó una captura estática de aproximadamente diez minutos con un jugador, cuatro torres y el Gateway. La asignación dinámica de IDs, el descubrimiento de PC, el envío HTTP y la escritura CSV funcionaron. El análisis está conservado en [hallazgos_captura_2026-09-06.md](hallazgos_captura_2026-09-06.md).

La sesión principal registró 3717 observaciones de 4836 esperadas. Solo 356 de 1208 secuencias, un 29.47 %, tuvieron las cuatro torres; las coberturas individuales variaron entre 61.95 % y 93.63 %. El RSSI fue estable debido a la cercanía de los equipos, pero la completitud fue insuficiente.

Ese resultado fijó como siguiente trabajo la instrumentación de enlaces y el reemplazo del broadcast inmediato de Torre a Gateway. La implementación correspondiente se documenta a continuación.

## Codificación 3: instrumentación y mitigación de pérdidas

Implementada el 2026 09 06. El protocolo ESP-NOW pasó a versión 3. `REGISTRO_TORRE` ahora incluye `sesion_torre` y `secuencia_torre_tx`; ambos campos llegan al JSON y al CSV. El analizador usa sus huecos internos para estimar la cobertura del enlace Torre a Gateway y sigue aceptando los CSV históricos v2 para análisis.

Las torres obtienen la MAC del Gateway desde el origen de `ASIGNACION_ID`, la registran como peer y envían solamente la telemetría por ESP-NOW unicast. El registro y la asignación de nodos continúan por broadcast. Los reenvíos se programan fuera del callback con un retardo de `id_torre × 8 ms` más un jitter de 0 a 7 ms, manteniendo un único envío en vuelo y el orden de la cola. Cada torre reporta beacons, encolados, descartes, intentos, confirmaciones y fallos cada cinco segundos.

El jugador conserva el beacon broadcast, ahora con 0 a 100 ms de jitter sobre el intervalo base de 500 ms. En todos los roles se fuerzan a nivel bajo los GPIO 12, 13, 14 y 15 del driver de motores IdeaBoard durante el arranque.

Validación local completada:

- Jugador, Torre y Gateway compilan con `esp32:esp32` 3.3.11.
- Las siete pruebas Python pasan, incluidas validación v3, límite de lote, drenado del escritor, diagnóstico de huecos y compatibilidad de análisis con CSV v2.
- La captura estática v3_1 ya se ejecutó y alcanzó 99,91 % de vectores completos; falta validar movimiento y el área real.

## Siguiente paso vigente

La captura estática controlada ya fue realizada. El siguiente paso es repetir al menos diez minutos en el área real, con movimiento, conservando el CSV v3, el log del Gateway y los cuatro logs de torre. Comparar completitud, cobertura por torre, huecos de `secuencia_torre_tx`, fallos unicast y descartes de ambas colas contra la línea base v2. Solo si la estabilidad se mantiene se habilita el diseño de calibración; KNN continúa fuera de alcance.

## Resultado de captura v3_1

La prueba `data/raw/captura_v3_1.csv` produjo 4.459 registros durante aproximadamente 10 minutos y 12 segundos. Se observaron 1.115 secuencias: 1.114 vectores completos (99,91 %) y 1.115 con tres o más torres (100 %). La cobertura de los IDs lógicos de esa sesión fue T1=100 %, T2=99,91 %, T3=100 % y T4=100 %, sin duplicados ni registros con jugador cero. El Gateway reportó cero descartes de cola y de entrega; sí hubo tres fallos HTTP con reintento.

El único log de torre disponible, correspondiente a T4, reportó 1.120 beacons encolados, cero descartes, 1.118 confirmaciones y dos fallos unicast. Como el log continuó fuera del intervalo exacto del CSV, esos contadores no se deben restar directamente del archivo. El informe completo está en [informe_captura_v3_1.md](../data/processed/informe_captura_v3_1.md).

La captura v3 supera ampliamente la línea base v2 (29,47 % de vectores completos y 79,64 % con tres o más torres). Se autoriza pasar a una prueba de estabilidad en el área real y con movimiento; todavía no se inicia KNN ni se considera terminada la validación de campo.

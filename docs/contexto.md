# Contexto para futuras implementaciones

## Propósito actual

El MVP captura RSSI crudo. No calcula posiciones, zonas, KNN ni mapas de calor todavía. Una fila CSV representa la observación de una torre sobre una secuencia emitida por un jugador.

## Rutas importantes

| Ruta | Responsabilidad |
|---|---|
| `firmware/Comun/Paquete.h` | Estructuras y validación del protocolo ESP-NOW. |
| `firmware/Comun/RadioComun.h` | Inicialización y envío broadcast/unicast ESP-NOW. |
| `firmware/Comun/IdeaBoard.h` | Apagado preventivo del driver de motores integrado. |
| `firmware/Jugador` | Emisor periódico de beacons. |
| `firmware/Torre` | Medición RSSI y retransmisión de registros. |
| `firmware/Gateway` | Hotspot, asignación de IDs, recepción y HTTP. |
| `python/receptor_gateway.py` | Descubrimiento UDP, endpoint HTTP y CSV. |
| `python/analizar_captura.py` | Informe de completitud, duplicados, sesiones y cobertura por torre. |
| `docs/hallazgos_captura_2026-09-06.md` | Bitácora de la primera captura física y decisión técnica vigente. |
| `docs/mapa_torres_fisicas.md` | Correspondencia estable entre MAC, ubicación física y columna de análisis. |

## Flujo y protocolo

1. Gateway anuncia su sesión por ESP-NOW broadcast y mantiene la red Wi‑Fi `MapaCalor_MVP` en canal 6.
2. Torre y jugador difunden `REGISTRO_NODO` con rol y MAC. Gateway reserva un ID por MAC y responde con `ASIGNACION_ID` broadcast dirigido a esa MAC.
3. Tras recibir un ID distinto de cero, el jugador difunde `BEACON_JUGADOR` cada 500 a 600 ms con `id_jugador`, `sesion_jugador`, `secuencia` y `tiempo_jugador_ms`.
4. Cada torre recibe el beacon y lee RSSI dentro del callback. En `loop`, crea `REGISTRO_TORRE` con ID/sesión/secuencia propios de torre y los datos del jugador. Programa el envío en `id_torre × 8 ms + jitter de 0..7 ms` sin bloquear.
5. La torre aprende la MAC del Gateway desde el emisor de `ASIGNACION_ID` y le entrega la telemetría por ESP-NOW unicast. Los mensajes de descubrimiento y control permanecen en broadcast.
6. Gateway acepta un registro de torre únicamente si la MAC emisora ya está registrada como torre, coincide con `id_torre` y las sesiones/secuencias obligatorias no son cero. Añade `sesion_gateway` y `tiempo_gateway_recepcion_ms`.
7. Python valida el contrato v3, añade `timestamp_utc_pc` y guarda el CSV en `data/raw/lecturas_mvp.csv` por defecto.

## Parámetros a cambiar

- Canal, frecuencia y LED: `firmware/Jugador/config.h` y `firmware/Torre/config.h`.
- Credenciales del hotspot, tamaño de lote, puertos y vigencia de PC: `firmware/Gateway/config.h`.
- Ruta de CSV y puertos de Python: argumentos de `python/receptor_gateway.py`.

## Identidad de torres y KNN

`torre_id` es un identificador lógico de sesión. El Gateway lo asigna dinámicamente según el orden en que recibe los registros de las MAC y puede reasignarlo después de un reinicio. Por tanto, `torre_id=1` no significa permanentemente esquina superior izquierda.

La MAC identifica físicamente la placa, pero todavía debe asociarse a una ubicación documentada. Antes de entrenar o ejecutar KNN, cada fila debe transformarse mediante [mapa_torres_fisicas.md](mapa_torres_fisicas.md) a columnas estables como `rssi_esquina_sup_izq`, `rssi_esquina_sup_der`, etc. Nunca se debe entrenar con `T1,T2,T3,T4` interpretadas como posiciones físicas sin aplicar esa correspondencia.

La opción elegida es mantener IDs dinámicos para simplificar el arranque y usar una tabla persistente MAC→ubicación física para análisis. La tabla debe completarse mediante una prueba física de identificación antes de la calibración.

## Límites conocidos

- La reserva de IDs se pierde si el Gateway reinicia; `sesion_gateway` separa esos reinicios en el CSV. La ubicación física no debe depender de ese ID: debe resolverse por MAC mediante `docs/mapa_torres_fisicas.md`.
- La telemetría de torre usa unicast sin cifrado. La confirmación ESP-NOW indica entrega a nivel MAC, no que el registro ya esté escrito en el CSV.
- El Gateway usa una cola de control separada y una cola de telemetría. Conserva el lote HTTP pendiente, aplica backoff y reporta descartes y reintentos por serial.
- El código requiere Arduino-ESP32 3.x porque el RSSI se lee desde `esp_now_recv_info_t`.
- La captura v2 de 2026 09 06 confirmó RSSI estable a corta distancia, pero solo 29.47 % de vectores completos con cuatro torres. La captura v3_1 alcanzó 99.91 % en condición estática; aún falta validar movimiento y área real.
- No interpretar un CSV anexado como una única prueba: se deben separar las sesiones y usar un archivo nuevo por captura. El receptor v3 no acepta registros v2, aunque el analizador sí puede leer CSV históricos v2.

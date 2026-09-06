# Contexto para futuras implementaciones

## Propósito actual

El MVP captura RSSI crudo. No calcula posiciones, zonas, KNN ni mapas de calor todavía. Una fila CSV representa la observación de una torre sobre una secuencia emitida por un jugador.

## Rutas importantes

| Ruta | Responsabilidad |
|---|---|
| `firmware/Comun/Paquete.h` | Estructuras y validación del protocolo ESP-NOW. |
| `firmware/Comun/RadioComun.h` | Inicialización y envío broadcast ESP-NOW. |
| `firmware/Jugador` | Emisor periódico de beacons. |
| `firmware/Torre` | Medición RSSI y retransmisión de registros. |
| `firmware/Gateway` | Hotspot, asignación de IDs, recepción y HTTP. |
| `python/receptor_gateway.py` | Descubrimiento UDP, endpoint HTTP y CSV. |

## Flujo y protocolo

1. Gateway anuncia su sesión por ESP-NOW broadcast y mantiene la red Wi‑Fi `MapaCalor_MVP` en canal 6.
2. Torre y jugador difunden `REGISTRO_NODO` con rol y MAC. Gateway reserva un ID por MAC y responde con `ASIGNACION_ID` broadcast dirigido a esa MAC.
3. Tras recibir un ID distinto de cero, el jugador difunde `BEACON_JUGADOR` cada 500 ms con `id_jugador`, `sesion_jugador`, `secuencia` y `tiempo_jugador_ms`.
4. Cada torre recibe el beacon, lee RSSI y difunde `REGISTRO_TORRE` con su ID, sesión del jugador, secuencia, RSSI y reloj relativo propio.
5. Gateway acepta un registro de torre únicamente si la MAC emisora ya está registrada como torre y coincide con `id_torre`. Añade `sesion_gateway` y `tiempo_gateway_recepcion_ms`.
6. Python añade `timestamp_utc_pc` y guarda el CSV v2 en `data/raw/lecturas_mvp.csv` por defecto.

## Parámetros a cambiar

- Canal, frecuencia y LED: `firmware/Jugador/config.h` y `firmware/Torre/config.h`.
- Credenciales del hotspot, tamaño de lote, puertos y vigencia de PC: `firmware/Gateway/config.h`.
- Ruta de CSV y puertos de Python: argumentos de `python/receptor_gateway.py`.

## Límites conocidos

- La reserva de IDs se pierde si el Gateway reinicia; `sesion_gateway` separa esos reinicios en el CSV.
- Las torres envían broadcast por simplicidad; el Gateway es el único consumidor de registros en esta topología.
- El Gateway usa una cola de control separada y una cola de telemetría. Conserva el lote HTTP pendiente, aplica backoff y reporta descartes y reintentos por serial.
- El código requiere Arduino-ESP32 3.x porque el RSSI se lee desde `esp_now_recv_info_t`.

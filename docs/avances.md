# Avances

## Codificación 2: estabilización de captura RSSI

El protocolo ESP-NOW se actualizó a versión 2. El jugador genera una sesión de arranque y no transmite beacons hasta tener un ID asignado. Cada torre conserva esa sesión junto con RSSI, secuencia y su tiempo local; el Gateway añade su propia sesión y el tiempo de recepción.

El Gateway crea un hotspot Wi‑Fi en canal 6, registra torres y jugadores por MAC, les asigna IDs lógicos en memoria y valida que cada registro RSSI provenga de la MAC registrada para el ID de torre declarado. Usa colas independientes para control y telemetría; conserva un lote HTTP pendiente y aplica reintentos con backoff.

El receptor Python, sin dependencias externas, valida tipos, rangos y tamaño de lote, y guarda los lotes mediante una cola acotada. Al recibir `Ctrl+C`, drena los lotes aceptados antes de cerrar el archivo. Se agregaron pruebas para el contrato v2, lotes inválidos y cierre ordenado.

La pendiente actual es la validación física con las seis placas: no hay todavía una captura real de diez minutos ni métricas de pérdida de radio.

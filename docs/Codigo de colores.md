# Código de colores

El LED RGB WS2812B integrado de la IdeaBoard usa GPIO 2. Un error tiene prioridad sobre cualquier otro estado. Un pulso breve puede superponerse temporalmente a un estado fijo.

## Jugador

| Estado | Color / patrón | Significado |
|---|---|---|
| Inicio | Amarillo intermitente | Inicializando Wi-Fi y ESP-NOW. |
| Registrado | Azul fijo | El Gateway asignó un ID lógico. |
| Envío de beacon | Verde pulsante | Se difundió una telemetría del jugador. |
| Error | Rojo intermitente rápido | No se inicializó la radio. |

## Torres

| Estado | Color / patrón | Significado |
|---|---|---|
| Inicio | Amarillo intermitente | Inicializando radio. |
| Esperando ID | Azul intermitente | Radio lista, aún sin asignación del Gateway. |
| Escuchando | Verde fijo | Torre registrada y midiendo beacons. |
| Reenvío | Cian pulsante | Se difundió un registro RSSI al Gateway. |
| Error | Rojo intermitente rápido | No se inicializó la radio. |

## Gateway

| Estado | Color / patrón | Significado |
|---|---|---|
| Hotspot listo | Cian fijo | La red Wi‑Fi está disponible, pero aún no se descubre la PC. |
| Inicio | Amarillo intermitente | Inicializando hotspot, ESP-NOW y UDP. |
| PC activa | Verde fijo | Hay destino HTTP anunciado por Python. |
| Error | Rojo intermitente rápido | Falló hotspot, ESP-NOW o UDP. |

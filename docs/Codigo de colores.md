# Código de colores

El LED RGB WS2812B integrado de la IdeaBoard usa GPIO 2. Los sketches seleccionan un patrón de error cuando detectan fallos de inicialización o conexión. `ControlLed` superpone un pulso temporal al patrón base; no implementa una jerarquía global de prioridades.

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
| Reenvío | Cian pulsante | `esp_now_send()` aceptó localmente un registro RSSI para unicast al Gateway; no sustituye la confirmación serial `tx_confirmadas`. |
| Error | Rojo intermitente rápido | No se inicializó la radio. |

## Gateway

| Estado | Color / patrón | Significado |
|---|---|---|
| Wi-Fi conectado | Cian fijo | Gateway asociado al hotspot de la PC, con canal compatible, ESP-NOW y UDP listos; esperando respuesta de la PC. |
| Inicio / reconexión | Amarillo intermitente | Conectando o reconectando al hotspot creado por la PC. |
| PC confirmada | Verde fijo | Recibió una respuesta UDP válida de la PC. Puede indicar puerto 0, sin captura activa, o un puerto HTTP disponible. |
| Error | Rojo intermitente rápido | Falló el modo Wi-Fi, ESP-NOW o UDP, o el canal del hotspot no coincide con el configurado. |

El verde del Gateway no confirma por sí solo entrega HTTP ni escritura CSV. El vencimiento del destino UDP no cambia automáticamente ese color; compruebe la vigencia y los contadores en serial o en la web. Una caída de Wi-Fi sí selecciona el patrón de reconexión. Véase [descubrimiento_gateway.md](descubrimiento_gateway.md).

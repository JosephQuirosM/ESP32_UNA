# Código de colores

Los tres dispositivos usan el LED RGB WS2812B de la IdeaBoard en GPIO 2. «Intermitente cada 400 ms» significa 400 ms encendido y 400 ms apagado; los pulsos duran 80 ms y se superponen temporalmente al color base. Los colores indican estados locales del firmware, no confirman por sí solos que una lectura haya llegado al CSV.

## Jugador

| Color / patrón | Cuándo aparece | Significado |
|---|---|---|
| Amarillo intermitente cada 400 ms | Al arrancar, antes de configurar la radio, si el sensor de tarjeta está deshabilitado. | Inicialización en curso. |
| Rojo intermitente cada 500 ms | Al arrancar con `SENSOR_LIGHT_BLOCKING_PRESENTE=true`, antes de evaluar la tarjeta; también después de 2 s continuos sin tarjeta, o cuando llega una asignación de ID mientras los beacons están pausados. | Al inicio o sin tarjeta, los beacons están pausados. El jugador sigue enviando registros de nodo al Gateway. |
| Azul fijo | Hay tarjeta y el Gateway asignó un ID distinto de 0; también al reinsertar la tarjeta cuando el ID ya está asignado. Con el sensor de tarjeta deshabilitado, aparece tras asignar el ID. | Jugador habilitado para enviar beacons. |
| Verde durante 80 ms sobre el color base | `esp_now_send()` aceptó localmente un beacon broadcast. | Intento local de envío; no confirma recepción en las torres. Los beacons se programan cada 500 ms más un pequeño intervalo variable. |
| Rojo intermitente cada 200 ms | Falló la inicialización de ESP-NOW o el registro del callback de recepción. | Error de radio; consultar el monitor serial. |

**Caso actual con tarjeta presente e ID 0:** la lectura de la tarjeta habilita internamente los beacons, pero el firmware no los envía hasta recibir un ID del Gateway. Si el LED ya estaba rojo, permanece rojo porque la reinserción solo lo cambia a azul cuando el ID está asignado. El LED, por tanto, no distingue correctamente este estado; consulte `ID=` y `beacons=` en el monitor serial. El MPU6050 informa movimiento por serial y en los paquetes, pero no modifica el LED.

## Torres

| Color / patrón | Cuándo aparece | Significado |
|---|---|---|
| Amarillo intermitente cada 400 ms | Al arrancar. | Inicialización de la radio. |
| Azul intermitente cada 500 ms | Radio lista, antes de recibir un ID y registrar el Gateway como destino unicast. | Esperando asignación. |
| Verde fijo | ID asignado y Gateway registrado como destino unicast. | Torre lista para escuchar y reenviar registros RSSI. |
| Cian durante 80 ms sobre el color base | `esp_now_send()` aceptó localmente un registro RSSI unicast. | Intento local de reenvío; comprobar `tx_confirmadas` en serial para conocer el resultado de la transmisión. |
| Rojo intermitente cada 200 ms | Falló la inicialización de la radio o el registro de sus callbacks. | Error de radio. |

## Gateway

| Color / patrón | Cuándo aparece | Significado |
|---|---|---|
| Amarillo intermitente cada 400 ms | Al arrancar, mientras conecta con el hotspot de la PC o tras perder Wi-Fi. | Conexión o reconexión en curso. |
| Cian fijo | Se conectó al hotspot en el canal configurado e inició ESP-NOW y UDP. | Gateway listo para registrar nodos y anunciarse a la PC. |
| Verde fijo | Procesó una orden UDP válida de control de captura de la PC. La orden puede activar o desactivar la captura. | Control recibido; no garantiza captura activa ni escritura en CSV. |
| Rojo intermitente cada 200 ms | Falló el modo Wi-Fi, ESP-NOW o UDP, o el canal del hotspot no coincide con el configurado. | Error de inicialización o canal. |

El verde del Gateway puede permanecer después de que venza la autorización o el destino de la PC: ese vencimiento no cambia el LED. Compruebe `captura=`, `destino_pc=`, los contadores y los mensajes de control en serial o en la web. Véase [descubrimiento_gateway.md](descubrimiento_gateway.md).

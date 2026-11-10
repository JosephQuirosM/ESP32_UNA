# Código de colores

Los tres dispositivos usan el LED RGB WS2812B de la IdeaBoard en GPIO 2. «Intermitente cada 400 ms» significa 400 ms encendido y 400 ms apagado. Un latido baja y recupera la intensidad del mismo color base, sin cambiar de tono. Los colores indican estados locales del firmware; no confirman por sí solos que una lectura haya llegado al CSV.

## Jugador

| Color / patrón | Cuándo aparece | Significado |
|---|---|---|
| Amarillo intermitente cada 400 ms | Durante la inicialización y mientras espera el ID del Gateway con tarjeta presente. | Sensor de tarjeta habilitado y tarjeta detectada, pero aún no puede emitir beacons sin ID. En juegos sin sensor también se usa durante el inicio. |
| Rojo intermitente cada 500 ms | El sensor habilitado confirma ausencia de tarjeta al arrancar o transcurren 2 s continuos sin ella durante el juego. | Beacons pausados por falta de tarjeta; el registro del nodo continúa. Este rojo queda reservado para esa condición. |
| Verde fijo | Tarjeta presente (o sensor deshabilitado) e ID asignado. | Jugador habilitado para emitir beacons. |
| Latido verde sincronizado con cada beacon | `esp_now_send()` acepta localmente un beacon broadcast. El latido dura el intervalo hasta el siguiente beacon: 500 ms más el intervalo variable configurado. | Actividad normal de envío; no confirma recepción en las torres. Si cambia el intervalo de beacon, cambia el del latido. |
| Morado intermitente cada 200 ms | Falló la inicialización de ESP-NOW o el registro del callback de recepción. | Error de radio; consultar el monitor serial. |
| Azul intermitente cada 250 ms | El MPU6050 respondió antes, pero dejó de responder por I²C. Tiene prioridad visual sobre amarillo, rojo y verde mientras dure la desconexión. | Movimiento temporalmente no disponible. El firmware reintenta conectarlo cada 2 s y recupera automáticamente el patrón de tarjeta/ID cuando vuelve. Los beacons continúan con movimiento no disponible si la tarjeta está presente. |

El sensor digital se estabiliza durante 100 ms antes de confirmar un cambio. Con tarjeta presente e ID 0, el LED queda amarillo hasta recibir la asignación. Un MPU6050 ausente desde el arranque es opcional y no genera alerta; si se conectó y luego se pierde, aparece el aviso azul. El MPU informa movimiento por serial y en los paquetes; su estado de movimiento no cambia el LED.

El Light Blocking entrega solamente HIGH o LOW. Con la entrada `INPUT_PULLUP`, un cable de señal desconectado puede leerse como HIGH, igual que «tarjeta presente» según la polaridad configurada. El firmware no puede distinguir de forma fiable ese cable suelto de una tarjeta insertada sin una señal adicional o un circuito de supervisión. El rojo intermitente indica **ausencia de tarjeta detectada**, no confirma una desconexión física del sensor.

## Torres

| Color / patrón | Cuándo aparece | Significado |
|---|---|---|
| Amarillo intermitente cada 400 ms | Al arrancar. | Inicialización de la radio. |
| Azul intermitente cada 500 ms | Radio lista, antes de recibir un ID y registrar el Gateway como destino unicast. | Esperando asignación. |
| Verde fijo | ID asignado y Gateway registrado como destino unicast. | Torre lista para escuchar y reenviar registros RSSI. |
| Latido verde de 160 ms | `esp_now_send()` aceptó localmente un registro RSSI unicast. | Actividad normal de reenvío; comprobar `tx_confirmadas` en serial para conocer el resultado de la transmisión. |
| Rojo intermitente cada 200 ms | Falló la inicialización de la radio o el registro de sus callbacks. | Error de radio. |

## Gateway

| Color / patrón | Cuándo aparece | Significado |
|---|---|---|
| Amarillo intermitente cada 400 ms | Al arrancar, mientras conecta con el hotspot de la PC o tras perder Wi-Fi. | Conexión o reconexión en curso. |
| Verde fijo | Se conectó al Wi-Fi en el canal configurado e inició ESP-NOW y UDP. | Gateway listo para registrar nodos y anunciarse a la PC. |
| Latido verde de 250 ms | Procesó una orden UDP válida de control de captura de la PC o recibió respuesta HTTP 2xx para un lote de registros. | Actividad normal de control o entrega; una orden puede activar o desactivar la captura. |
| Rojo intermitente cada 200 ms | Falló el modo Wi-Fi, ESP-NOW o UDP, o el canal del hotspot no coincide con el configurado. | Error de inicialización o canal. |

El Gateway permanece verde después de que venza la autorización o el destino de la PC mientras siga conectado; ese vencimiento no cambia el LED. Compruebe `captura=`, `destino_pc=`, los contadores y los mensajes de control en serial o en la web. Véase [descubrimiento_gateway.md](descubrimiento_gateway.md).

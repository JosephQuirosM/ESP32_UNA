# Descubrimiento y control de capturas del Gateway

Actualizado el 4 de noviembre de 2026. La PC crea el hotspot de 2.4 GHz y el Gateway se conecta como estación con DHCP. El firmware calcula `WiFi.broadcastIP()`; el frontend no configura IP ni broadcast.

## Mensajes UDP

El backend escucha UDP 4210 desde que arranca. Cada 2 s el Gateway difunde `HEATMAP_GATEWAY_V1 ` seguido de JSON con MAC, sesión, canal, uptime, contadores y `pcConfirmada`. El firmware actualizado añade:

- `controlCaptura: 1`: capacidad obligatoria para iniciar una captura.
- `revisionControl`: última orden aplicada.
- `capturaId`, `capturando`: identidad y estado efectivo de admisión.
- `descartesInactivos`, `registrosPurgados`: descartes intencionales, separados de pérdidas por cola llena.

La PC responde por unicast al origen del anuncio y también envía los cambios inmediatamente:

```text
HEATMAP_PC_V3 SESION_GATEWAY REVISION CAPTURA_ID PUERTO_HTTP
HEATMAP_ACK_V3 SESION_GATEWAY REVISION CAPTURA_ID PUERTO_HTTP
```

Para desactivar, `CAPTURA_ID` es `-` y `PUERTO_HTTP` es `0`. Para activar, el ID es el UUID v4 de la captura y el puerto es el del receptor preparado (8080 inicial). La revisión es un entero positivo de hasta `9007199254740991`; la PC la persiste y la incrementa al cambiar de orden. El Gateway exige su sesión de arranque y una IP de origen igual a la puerta de enlace DHCP: este despliegue supone que esa puerta de enlace es la PC del hotspot.

La PC reintenta cada 250 ms hasta recibir un ACK correlacionado por origen, sesión, revisión, ID y puerto; después renueva cada 2 s. Las revisiones anteriores o una misma revisión con otro contenido se ignoran. Un ACK retrasado de otra captura no habilita el receptor actual.

## Admisión y limpieza

El Gateway arranca inactivo. Continúa recibiendo ESP-NOW y atendiendo el registro de nodos, pero descarta telemetría RSSI sin encolarla mientras no tiene autorización activa.

Una activación nueva limpia bajo el mismo bloqueo del callback la cola de registros y habilita la nueva identidad. Antes de confirmar también elimina el lote HTTP pendiente y sus reintentos. Repetir la misma orden sólo renueva el plazo: no vuelve a limpiar una captura en curso.

La desactivación, pérdida de Wi-Fi, cambio incompatible de canal o vencimiento de la autorización de 12 s cierran la admisión y limpian pendientes. Una renovación retrasada de una revisión ya cerrada o vencida no la reabre; debe comenzar otra captura con una revisión nueva. El panel marca al Gateway desconectado tras 10 s sin anuncios.

## Secuencia de una captura web

1. El usuario pulsa Grabar, en modo manual o guiado. El botón queda deshabilitado con spinner y se conserva la vista actual, sin texto «Esperando Gateway».
2. Express reserva el archivo y el ID; inicia Python con `--esperar-inicio`, `--captura-id` y `--sin-anuncio-udp`.
3. Python abre CSV y HTTP y publica `iniciando` con `preparado: true`, sin admitir registros ni iniciar el plazo.
4. El backend autoriza al Gateway. Tras confirmar limpieza y apertura, escribe una señal persistente `<id>.iniciar` y envía `iniciar` por stdin a Python.
5. Python habilita HTTP y publica `grabando`, con inicio y fin previsto efectivos. Entonces la interfaz cambia de vista y muestra el cronómetro.
6. Al terminar, detener o fallar, se envía la desactivación inmediatamente. El receptor cierra la admisión y drena sólo lotes ya aceptados. Entre zonas permanece inactivo hasta el siguiente clic.

`POST /api/lecturas` sigue devolviendo 202 inmediatamente. Las consultas de estado conservan la misma solicitud y no crean archivos adicionales. Si el inicio no se confirma en 10 s, se cierra el receptor, se conserva el archivo como fallido y la interfaz recupera sus controles con un error para reintentar.

## Aislamiento HTTP y recuperación

Cada POST a `/v1/registros` incluye `X-Heatmap-Captura: UUID`. El receptor devuelve 409 si la identidad no coincide y 503 si está preparado pero aún no grabando, cerrando o sin capacidad de cola. Un POST de la captura anterior no puede escribirse en la siguiente aunque reutilicen el puerto.

La revisión/orden se guarda en `<DIRECTORIO_DATOS>/.lecturas/.control-gateway.json`, junto con metadatos de captura, estados y señales de inicio/parada. Un reinicio corto del backend recupera el mismo ID y revisión, sin volver a vaciar la captura ni reiniciar su cronómetro. Si el receptor terminó, el Gateway reinició o la autorización ya venció, se conserva un resultado final o parcial y se exige una captura nueva.

El receptor independiente por CLI implementa el mismo control en `python/control_gateway.py`, genera su UUID y espera el ACK antes de iniciar el tiempo. No se ejecuta a la vez que el backend: ambos necesitan UDP 4210. La opción heredada `--anuncio-udp-legacy` se rechaza; V1/V2 no ofrecen el aislamiento requerido.

## Actualización y prueba física

Sólo se recarga el firmware del Gateway para este cambio. Jugador, torres y contrato ESP-NOW es v4 con movimiento del jugador. Un Gateway sin `controlCaptura: 1` produce un error que solicita actualizarlo; no se utiliza un modo de captura antiguo silenciosamente. El sufijo V1 del anuncio, V3 del control UDP y `/v1/registros` son identificadores de contratos diferentes.

Permita UDP 4210 y HTTP 8080 desde el hotspot; HTTP 8000 sirve frontend y API. El backend no crea el hotspot. El LED verde confirma control válido de la PC, incluso con captura desactivada; no demuestra escritura CSV.

Para probar físicamente, deje transmitir las torres durante la pausa, confirme `destino_pc=no` y aumentos de `descartes_inactivos`, y grabe dos zonas consecutivas guardando CSV y logs. El control delimita la **recepción en Gateway**, no sincroniza relojes ni vacía las pequeñas colas de las torres. Consulte [prueba_campo_captura.md](prueba_campo_captura.md) y [arquitectura.md](arquitectura.md).

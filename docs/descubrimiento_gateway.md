# Descubrimiento iniciado por el Gateway

La PC crea el hotspot y el ESP32 se conecta con las credenciales de `firmware/Gateway/config.h`. No se fija la IP de la PC ni un broadcast en el frontend. El firmware calcula `WiFi.broadcastIP()` a partir de DHCP.

## Intercambio

1. Cada dos segundos el Gateway envía `HEATMAP_GATEWAY_V1 ` seguido de JSON al broadcast del hotspot en UDP 4210. Incluye `mac`, `sesion`, `canal`, `uptimeMs`, `registrosRecibidos`, `registrosEnviados`, `fallosHttp` y `pcConfirmada`.
2. El backend escucha UDP 4210 desde que arranca, incluso sin Python. Registra la IP real del emisor y la fecha de recepción, y responde únicamente a su IP y puerto de origen.
3. La respuesta es `HEATMAP_PC_V2 SESION PUERTO_HTTP`. El Gateway exige su sesión actual y que la respuesta proceda de la puerta de enlace DHCP, que en este despliegue es la PC del hotspot.
4. Puerto `0` confirma que la PC está disponible pero no hay captura lista. Puerto `8080` (o el configurado) se devuelve únicamente cuando Python informa `grabando`, con el archivo y el receptor preparados. Entonces el Gateway envía los lotes HTTP v3.
5. La respuesta se renueva con cada anuncio. Su vigencia en el firmware es doce segundos. La web marca al Gateway sin conexión tras diez segundos sin anuncios, o si falla la escucha UDP.

La confirmación recibida se incluye en el siguiente anuncio del ESP32: así la web distingue «Detectado; esperando confirmación» de «Comunicando con la PC». Al empezar a llegar filas del CSV muestra «Recibiendo registros». Los contadores son acumulados desde el arranque del Gateway; recibir anuncios no garantiza que estén llegando mediciones de las torres ni que el CSV esté grabando.

## Uso

Cargue el Gateway actualizado. Conserve el SSID, clave y canal que haya configurado. Active el hotspot de 2.4 GHz con el mismo canal que las ESP32, compile la aplicación con `npm run build` y levante el backend con `npm start`. Revise Gateway en la web antes de crear un CSV. Ya no requiere establecer `RECEPTOR_DESTINO_UDP` para la captura web.

Permita UDP 4210 y HTTP 8080 desde la red del hotspot en el firewall de la PC. HTTP 8000 sirve el frontend a la PC y al móvil conectado al hotspot; permita también ese puerto desde la red del hotspot. `HOST_BACKEND` permite limitar la interfaz de escucha. Si cambia el puerto UDP, ajuste tanto `RECEPTOR_PUERTO_UDP` como `PUERTO_DESCUBRIMIENTO_UDP` del firmware.

La captura web ejecuta Python con `--sin-anuncio-udp`: el backend posee la escucha de descubrimiento y Python solo recibe lotes y escribe el CSV. El CLI independiente también escucha los anuncios del Gateway y responde por unicast; no debe usarse simultáneamente con el backend, porque ambos escuchan UDP 4210. El modo `--anuncio-udp-legacy --destino-udp DIRECCION` conserva el anuncio `HEATMAP_PC_V1` para firmware anterior.

Si el ESP32 se conecta a un router externo en lugar del hotspot de la PC, su puerta de enlace será ese router. Ese despliegue requiere otra forma de identificar la PC y queda fuera de esta configuración.

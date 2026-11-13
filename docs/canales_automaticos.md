# Canal automático del hotspot y ESP-NOW

Actualizado el 12 de noviembre de 2026.

El hotspot de Windows o Linux puede cambiar de canal. El usuario sólo configura
su nombre y contraseña en `firmware/Gateway/config.h`; ya no hay un
`CANAL_ESPNOW` fijo en los tres firmwares. Se conserva el protocolo ESP-NOW v4,
incluido su anuncio `ANUNCIO_GATEWAY`, y el formato HTTP/CSV.

## Arranque y descubrimiento

1. El Gateway busca el hotspot por SSID y contraseña con `WiFi.begin`, sin un
   canal forzado. El driver Wi-Fi determina el canal al asociarse al AP.
2. En ese canal emite anuncios ESP-NOW con su sesión y canal cada 250 ms. Los
   anuncios UDP a la PC conservan su intervalo de 2 s y muestran el canal actual.
3. Jugadores y torres recorren los canales de 2.4 GHz permitidos por la
   configuración regional del driver, normalmente 1–11. No recorren 5 GHz ni
   amplían automáticamente el rango regional. Cada canal se escucha 1200 ms,
   sin bloquear `loop`. La radio no se mueve mientras espera un callback de envío.
4. Al recibir un anuncio válido, el nodo comprueba que el canal anunciado sea
   el mismo en el que recibió el paquete. Conserva la MAC y sesión del Gateway,
   permanece en el canal y solicita su ID con un pequeño desfase aleatorio.
5. Sólo acepta asignaciones del Gateway encontrado, dirigidas a su MAC y rol.
   Después de obtener ID, el jugador emite beacons si tiene tarjeta o si el
   sensor está deshabilitado. Las torres registran el peer unicast y admiten RSSI.

La MAC del primer Gateway encontrado se conserva hasta reiniciar el nodo. Esto
evita saltos a otro Gateway cercano durante una pérdida de señal. Para sustituir
la placa Gateway por otra MAC, reinicie los nodos. No es autenticación criptográfica.
Los valores de respaldo de ID son preferencias para el registro; no habilitan
telemetría antes de descubrir al Gateway y recibir su asignación.

## Cambio durante la ejecución

El Gateway sigue el canal del AP sin fijarlo manualmente con ESP-NOW. Los peers
tienen canal 0, que significa usar el canal actual de la interfaz. Al observar
un cambio, limpia la cola y el lote HTTP pendiente y anuncia inmediatamente el
nuevo canal. No reinicia su sesión ni la tabla de IDs sólo por cambiar de canal.

Los nodos no pueden recibir desde el canal anterior un anuncio emitido en el
nuevo. Tras 5 s sin anuncios válidos, invalidan su asignación y recorren de nuevo
los canales. Las torres cierran la admisión bajo el bloqueo del callback, vacían
cola y registro pendiente, y cuentan los purgados. Los jugadores pausan sus
beacons; sensores y buzzer siguen atendidos. Un envío ya entregado al driver no
puede retirarse, pero se espera su callback antes de cambiar de canal.

Cuando encuentran otra vez la misma MAC, vuelven a registrarse automáticamente.
También detectan un reinicio del Gateway por su nueva sesión y solicitan ID,
aunque permanezca en el mismo canal. No reinician sus propias secuencias por
una recuperación de canal.

La búsqueda lleva varios segundos: con 11 canales, una vuelta completa tarda
aproximadamente 13,2 s, además del plazo de detección de pérdida y del registro.
Las interferencias y los reintentos pueden prolongarla. No se garantiza una
captura sin pérdidas durante el cambio ni se reconstruyen las lecturas ausentes.

## Capturas y desconexiones

- **Cambio de canal conservando Wi-Fi y autorización:** el CSV sigue abierto,
  el reloj continúa y vuelven a llegar lecturas cuando los nodos se recuperan.
- **Pérdida de Wi-Fi, reinicio del mismo Gateway o autorización vencida:** el
  Gateway cierra admisión y vacía pendientes, pero Python mantiene abierto el
  mismo CSV. Al recuperar comunicación, el backend envía una revisión nueva de
  autorización con el mismo UUID, sin crear otro archivo ni reiniciar el reloj.
  El receptor independiente por consola aplica la misma recuperación.
- **Hotspot ausente o IP cambiada:** el receptor de la web mantiene su escucha
  IPv4 y el escritor CSV sigue activo. La recepción se recupera cuando el
  Gateway vuelve a alcanzar la PC. El panel sigue disponible por las redes
  activas y la administración local continúa en `localhost`.
- El tiempo real sigue corriendo, también sin lecturas: el modo Juego sigue
  abierto hasta pulsar Detener; las capturas con duración terminan al cumplir
  su plazo original. No se rellenan los huecos de comunicación.
- Una parada manual o un fin de duración desactivan la orden pendiente; la
  reconexión no puede reabrir una captura terminada. Tampoco se reemplaza
  silenciosamente una autorización de otro controlador con revisión superior.
- Si el mismo Gateway se reinicia, las filas posteriores conservan su nueva
  `sesion_gateway`; separación por jugadores y estadísticas ya distinguen esas
  sesiones. No se cambia automáticamente a un Gateway con otra MAC.

## Parámetros y diagnóstico

En los `config.h` de jugador y torre:

- `ESCUCHA_CANAL_MS = 1200`: permanencia en cada canal de búsqueda.
- `VIGENCIA_ANUNCIO_GATEWAY_MS = 5000`: tiempo sin anuncio antes de buscar.

En Gateway: `INTERVALO_ANUNCIO_RADIO_MS = 250`, separado del anuncio UDP cada 2 s.
El intervalo efectivo de radio puede alargarse durante HTTP; la permanencia por
canal y la vigencia dejan margen a esa espera. No reduzca los tiempos sin medir.

El serial muestra `Buscando Gateway`, `Gateway encontrado`, canal, MAC y sesión.
La torre añade `descartes_sin_gateway` y `purgados_reconexion`. El Gateway informa
`Hotspot cambió de canal` y mantiene `canal_wifi` en su diagnóstico periódico.
Los LED conservan sus colores: jugador amarillo mientras busca con tarjeta,
torre azul mientras busca o se registra; ambos regresan a verde cuando están
listos. Rojo por tarjeta ausente y azul por MPU desconectado mantienen su prioridad
en el jugador. Véase [Código de colores](Codigo%20de%20colores.md).

## Verificación física pendiente

Cargue esta actualización en Gateway, todas las torres y todos los jugadores.
Una placa con el firmware anterior seguirá dependiendo de su canal fijo.

1. Arranque primero los nodos sin Gateway y compruebe que recorren los canales.
   Encienda el Gateway en un hotspot de canal 1, 6 u 11: todos deben obtener ID.
2. Durante una captura cambie el canal del AP manteniendo SSID y contraseña.
   Guarde logs de las tres clases de dispositivo y el CSV. Compruebe cambio en
   Gateway, búsqueda en nodos, registro y recuperación sin recargar firmware.
3. Distinga en los logs si el cambio mantuvo Wi-Fi o provocó desconexión. En el
   segundo caso debe renovarse la autorización automáticamente: mismo UUID,
   mismo archivo, mismo proceso Python y mismo inicio de captura.
4. Apague el hotspot y vuelva a encenderlo en otro canal; pruebe además un reinicio
   del Gateway y el arranque de nodos cuando ya está en marcha la captura.
5. Durante la búsqueda quite e inserte la tarjeta y observe MPU/buzzer. Las
   lecturas de sensores deben continuar y no deben emitirse beacons sin ID.
6. Compruebe que la torre purga pendientes al perder al Gateway y que el canal
   mostrado por los nodos coincide con el real del hotspot después de recuperarse.

Las pruebas de backend y Python verifican continuidad del CSV tras suspensión
de UDP, autorización cerrada, reinicio de Gateway y reapertura HTTP con nueva IP;
se mantienen el rechazo de otro UUID y la parada definitiva durante un corte.

Las pruebas automatizadas ejercitan el estado usado por el firmware: aparición
tardía, cambios 6 → 11 → 1 con pérdidas de anuncios, reinicio, filtrado de MAC y
sesión, recorrido regional y desbordamiento de `millis()`. No sustituyen las
pruebas de radio y hotspot Windows/Linux con hardware.

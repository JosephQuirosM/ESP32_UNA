# Estado del proyecto

Revisión documental: 4 de noviembre de 2026. Estado basado en el código y las pruebas locales; no implica validación física de radio ni evaluación de precisión de los modelos.

## Implementado

- Firmware v3 para un jugador, cuatro torres y un Gateway IdeaBoard ESP32, con sesiones de arranque, IDs por MAC y validación de paquetes.
- Beacons broadcast, control broadcast y registros RSSI unicast escalonados, con colas acotadas y contadores de fallos/descartes.
- Gateway como estación del hotspot de la PC, descubrimiento iniciado por UDP broadcast y respuesta unicast del backend. Entrega HTTP por lotes con reintentos.
- Recolección web manual y guiada, un CSV por captura, duración controlada por Python, parada, idempotencia, recuperación y descarga de resultados parciales.
- Preparación web/CLI de CSV por zona, vector de cuatro RSSI por MAC y secuencia, procedencia, duplicados e incompletos marcados. Sin recortes temporales automáticos.
- Entrenamiento web de KNN y Random Forest con parámetros configurables, exportación de modelo y resumen. Los CLI añaden opciones de evaluación.
- Mapas web por jugador (hasta 10 por sesión del Gateway), con CSV de lecturas intactas ordenadas, predicción de vectores completos, suavizado por sesión y resumen general de recepción CSV/JSON. Los jugadores sin vectores completos conservan sus lecturas y estadísticas.

## Geometría dinámica

El preset sigue siendo 3×3. Cambiar filas/columnas en Recolección (por ejemplo 3×4) guarda la geometría en los CSV, preparación y modelo. Mapas respeta las dimensiones y posiciones, sin límite fijo de nueve. Los archivos anteriores pueden configurarse desde el frontend.

## Límites actuales

- La geometría admite de 1 a 20 filas y columnas. Los clasificadores aceptan etiquetas positivas; para dibujar un mapa deben pertenecer a su geometría. Se rechazan configuraciones contradictorias entre archivos y modelos.
- Los mapas cuentan predicciones y proporciones; no integran tiempos entre lecturas. No hay inferencia en vivo ni interpolación continua implementada.
- Control UDP V3 con UUID, revisión persistida y ACK: el Gateway descarta en inactividad, limpia en cambios y el reloj comienza tras confirmar. Las pequeñas colas de las torres y sus relojes locales permanecen sin sincronización.
- Hay datos, modelos y resultados en esta copia local, excluidos de Git. No se publica una precisión experimental vigente sin revisar su evidencia.
- La tabla física debe mantenerse coherente entre `docs/mapa_torres_fisicas.md` y `python/mvp_config.py`.

## Verificación de esta revisión

El 4 de noviembre de 2026 pasaron 34 pruebas Python, 18 pruebas del backend y las compilaciones de backend y frontend. Las pruebas ejercitan procesos Python reales y HTTP con entradas de prueba; no sustituyen una campaña con ESP32.

La arquitectura y los contratos completos se describen en [arquitectura.md](arquitectura.md). Las ampliaciones se registran en el [roadmap](../ROADMAP_CODEX_MAPA_CALOR_ESP32.md).

Se compiló Gateway con `arduino-cli`, FQBN `esp32:esp32:esp32` y core ESP32 3.3.11. No había placas conectadas: queda pendiente la comprobación física con logs y dos zonas consecutivas. El aislamiento, recuperación y spinner se verifican con Gateway simulado; las pruebas de la máquina de estados compilan y ejecutan el encabezado real del firmware con g++.

# Estado del proyecto

## Checkpoint vigente

El proyecto conserva una arquitectura funcional de captura RSSI: un jugador ESP32 emite beacons, cuatro torres registran RSSI y entregan telemetría al Gateway por ESP-NOW unicast, y la PC recibe lotes HTTP en un CSV v3. Los IDs de nodo son dinámicos y la identidad física de cada torre se resuelve por MAC.

El código Python disponible agrupa las cuatro lecturas de una secuencia, aplica la tabla MAC→ubicación, etiqueta zonas de una cuadrícula 3×3, entrena un KNN y puede generar una visualización 3×3 reproducible. No hay modelos entrenados ni datasets disponibles en este checkpoint.

## Próximo objetivo

Reconstruir la zona de 6 m × 2,5 m con cuatro torres en posiciones fijas y realizar una nueva captura de calibración. Esa captura será la única fuente de datos para el siguiente entrenamiento y para los informes posteriores.

## Decisiones vigentes

- Modelo del MVP: KNN.
- Identidad de torres: MAC, nunca `torre_id` dinámico.
- Cuadrícula: 3×3 con nueve zonas.
- Etiquetado temporal actual: 60 s por zona y exclusión de los primeros 6 s.
- Los resultados de pruebas anteriores fueron eliminados intencionalmente y no forman parte de la línea de evidencia actual.

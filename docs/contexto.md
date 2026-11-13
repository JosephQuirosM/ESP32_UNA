# Contexto del proyecto

El sistema estima zonas aproximadas mediante fingerprinting RSSI y genera mapas de calor a partir de archivos. La descripción técnica vigente está en [arquitectura.md](arquitectura.md).

## Flujo actual

1. La PC ofrece un hotspot de 2.4 GHz. El Gateway adopta su canal; jugadores y torres lo descubren por anuncios ESP-NOW y vuelven a buscarlo si desaparece. Véase [canales automáticos](canales_automaticos.md).
2. El Gateway se conecta como estación por DHCP y asigna IDs dinámicos por MAC al jugador y las torres mediante control ESP-NOW broadcast.
3. El jugador difunde beacons; las cuatro torres miden RSSI y envían registros ESP-NOW unicast al Gateway.
4. El Gateway anuncia su presencia por UDP broadcast 4210. Express envía control V3 por unicast con sesión, revisión, ID y puerto; recibe el ACK de limpieza/apertura antes de iniciar el reloj. Puerto 0 desactiva y limpia el Gateway.
5. Durante una captura, el Gateway envía lotes HTTP al receptor Python en 8080. Python escribe CSV v4 y controla su plazo y cierre después de la confirmación del Gateway.
6. React controla la aplicación por la API de Express en 8000. Preparación, entrenamiento KNN/Random Forest y mapas ejecutan procesos Python en la PC.

## Rutas principales

| Ruta | Responsabilidad |
|---|---|
| `firmware/Comun/Paquete.h` | Contrato binario ESP-NOW v4. |
| `firmware/Jugador`, `firmware/Torre`, `firmware/Gateway` | Emisión, medición RSSI y puente ESP-NOW → HTTP. |
| `backend/src/index.ts`, `app.ts`, `gateway.ts` | Arranque, API, frontend compilado y descubrimiento UDP. |
| `backend/src/gestor.ts` | Captura única, idempotencia, procesos y recuperación. |
| `backend/src/preparacion.ts`, `entrenamiento.ts`, `mapas.ts` | Validación y ejecución de análisis Python. |
| `shared/lecturas.ts` | Tipos de captura y Gateway compartidos con React. |
| `frontend/src/App.tsx`, `Lecturas.tsx`, `VistaCuadricula.tsx` | Navegación y recolección manual/guiada. |
| `frontend/src/PreparacionDatos.tsx`, `EntrenamientoModelos.tsx`, `MapasCalor.tsx` | Formularios y resultados de análisis. |
| `python/receptor_gateway.py` | Receptor HTTP, cola y escritor CSV v4; descubrimiento propio en CLI. |
| `python/analizar_captura.py` | Informe de integridad y diagnóstico con logs seriales. |
| `python/preprocesar_calibracion.py`, `preparar_datos_web.py` | Vectores y zona explícita por archivo, sin recortes temporales. |
| `python/entrenamiento_web.py`, `entrenar_knn.py`, `entrenar_random_forest.py` | Entrenamiento y opciones CLI de evaluación. |
| `python/mapas_calor_web.py`, `reproducir_mapa_calor.py` | Predicciones, suavizado y mapas PNG. |
| `python/config_rssi.py`, `docs/mapa_torres_fisicas.md` | Tabla MAC → característica y preset 3×3. |
| `shared/cuadricula.ts`, `python/cuadricula.py` | Contrato y validación de geometría dinámica, 1–20 filas/columnas. |

## Decisiones para continuar

- La MAC define la ubicación física; el ID dinámico no define la columna RSSI.
- Se agrupa por archivo, sesión de Gateway, jugador, sesión del jugador y secuencia. Sólo se entrenan y predicen vectores completos de cuatro RSSI.
- No hay etiquetado por bloques de 60 s ni exclusión automática de los primeros 6 s.
- El preset es 3×3; el administrador cambia filas, columnas y posiciones en el frontend. La geometría acompaña la captura CSV, preparación y modelo hasta el mapa; se admiten hasta 20×20. Para archivos anteriores sin geometría se puede indicar en Preparación o Mapas. No se mezclan geometrías diferentes.
- La PC almacena CSV/JSON/modelos en disco y el navegador conserva estado en `localStorage`.
- Git no distribuye los artefactos experimentales. Puede haber datasets y modelos locales; compruebe su procedencia antes de usarlos o citar resultados.
- Sin captura autorizada el Gateway descarta RSSI, mantiene vacíos cola/lote y atiende el registro de nodos. Sólo el Gateway necesita firmware nuevo para este control; ESP-NOW v4 de jugador/torres se mantiene.
- Antes de una captura, siga [prueba_campo_captura.md](prueba_campo_captura.md), incluidos los límites de las colas entre archivos.

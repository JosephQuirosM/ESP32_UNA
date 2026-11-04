# Arquitectura actual

Revisión documental: 4 de noviembre de 2026. Este documento describe el código del repositorio; no certifica una prueba física ni la calidad de un modelo local. Las propuestas de ampliación se mantienen en el [roadmap](../ROADMAP_CODEX_MAPA_CALOR_ESP32.md).

## Componentes y despliegue

El MVP usa seis IdeaBoard ESP32: un jugador, cuatro torres y un Gateway. La PC ejecuta Express/TypeScript, el receptor y los procesos de análisis Python. El navegador ejecuta React/TypeScript. Todo el procesamiento y almacenamiento se realiza en la PC; un móvil conectado al hotspot puede controlar la recolección.

```text
Jugador -- beacon ESP-NOW broadcast --> Torres (x4)
Torres  -- registro RSSI ESP-NOW unicast escalonado --> Gateway

PC crea hotspot Wi-Fi 2.4 GHz <-- Gateway se conecta como estación (DHCP)
Gateway -- anuncio UDP broadcast :4210 --> backend de la PC
Gateway <-- respuesta UDP unicast con sesión y puerto -- backend
Gateway -- HTTP POST :8080 /v1/registros --> receptor Python --> CSV crudo

Navegador React <-- HTTP /api :8000 --> Express --> procesos Python
                                                  |
CSV crudos --> preparación --> vectores etiquetados + resumen JSON
Vectores --> entrenamiento KNN / Random Forest --> modelo .joblib + JSON
CSV crudos o preparados + modelo --> predicción y suavizado --> PNG + CSV + JSON
```

El hotspot lo activa el usuario en el sistema operativo de la PC. El backend y el Gateway no crean la red. Todos los ESP32 y el hotspot deben usar el mismo canal (6 por defecto). Jugador y torres usan Wi-Fi en modo estación sin asociarse al hotspot; fijan el canal para ESP-NOW. El Gateway sí se asocia, desactiva el ahorro de energía Wi-Fi y comprueba el canal efectivo.

| Enlace | Transporte | Función |
|---|---|---|
| Jugador → torres | ESP-NOW broadcast | Beacon con ID, sesión, secuencia y tiempo del jugador. |
| Nodos ↔ Gateway | ESP-NOW broadcast | Registro de nodos y asignación de IDs; el Gateway también anuncia canal y sesión. |
| Torres → Gateway | ESP-NOW unicast | Una lectura RSSI por beacon recibido. El peer se aprende de `ASIGNACION_ID`. |
| Gateway → PC | UDP broadcast, puerto 4210 | Anuncio de presencia y contadores cada 2 s. |
| PC → Gateway | UDP unicast | Confirmación de sesión y puerto del receptor; puerto 0 cuando no está grabando. |
| Gateway → Python | HTTP POST, puerto 8080 | Lotes JSON de hasta ocho registros en `/v1/registros`. |
| Navegador ↔ Express | HTTP, puerto 8000 | API de control, consultas y descargas; frontend compilado. |
| Express ↔ Python | Procesos, stdin/stdout y archivos JSON | Control y estado de captura, preparación, entrenamiento y mapas. |
| Monitor serial | USB, 115200 baudios | Diagnóstico de firmware; no transporta las lecturas al CSV. |

Los puertos son valores iniciales configurables. En desarrollo Vite escucha en 5173 y redirige `/api` a `127.0.0.1:8000`. No se utilizan WebSockets ni MQTT.

## Firmware y contrato de radio

`firmware/Comun/Paquete.h` es el contrato binario: estructuras empaquetadas con firma `0x484D`, versión 3 y tipo. Se validan longitud, firma, versión y tipo antes de interpretar el paquete. Los tipos son `ANUNCIO_GATEWAY`, `REGISTRO_NODO`, `ASIGNACION_ID`, `BEACON_JUGADOR` y `REGISTRO_TORRE`.

- **Jugador:** solicita registro cada 3 s. Con ID asignado emite un beacon cada 500 ms más un jitter aleatorio de 0–100 ms. Cada arranque genera una sesión no nula y las secuencias avanzan por beacon.
- **Torre:** copia el beacon, el RSSI de `rx_ctrl` y el instante local a una cola desde el callback. En `loop` construye el registro y programa el unicast con `id_torre × 8 ms` más jitter de 0–7 ms desde la recepción. Mantiene un registro pendiente y espera el callback de envío antes de transmitir otro. Si falla iniciar el envío, reintenta tras 10 ms; un fallo informado por el callback se contabiliza, sin retransmisión de aplicación de ese registro.
- **Gateway:** reserva IDs por rol y MAC, hasta 20 nodos en la tabla. La reserva se pierde al reiniciar. Comprueba que la MAC e ID de la torre correspondan a un registro y que las sesiones requeridas no sean cero. Mantiene colas separadas para control y telemetría y envía HTTP desde `loop`, nunca desde el callback ESP-NOW.

Las colas circulares tienen 24 posiciones en torre, 24 de control y 96 de telemetría en Gateway; al reservar una posición para distinguir lleno/vacío sus capacidades útiles son 23, 23 y 95. Los descartes se cuentan y se publican por serial. El POST HTTP es síncrono y puede demorar el `loop`; la recepción ESP-NOW sigue usando los callbacks y sus colas acotadas.

Todos los sketches apagan al arrancar los GPIO 12, 13, 14 y 15 del driver de motores. `LedEstado.h` centraliza patrones sin demoras explícitas. Los LEDs indican estados locales; las confirmaciones de radio, HTTP y escritura se comprueban con sus contadores respectivos.

## Descubrimiento y entrega a la PC

El Gateway reintenta Wi-Fi cada 10 s y calcula el broadcast DHCP. El backend posee UDP 4210 y envía `HEATMAP_PC_V3 SESION REVISION CAPTURA_ID PUERTO`; el Gateway confirma con `HEATMAP_ACK_V3` y los mismos campos. Puerto 0 e ID `-` desactivan. Cada captura nueva limpia cola/lote/reintentos antes de habilitar admisión; renovar la misma orden sólo prolonga el plazo. Las órdenes antiguas y ACK de otra captura se ignoran.

Los cambios se envían inmediatamente y se reintentan cada 250 ms; tras el ACK se renuevan cada 2 s. La autorización vence en 12 s. Desconexión Wi-Fi, canal incompatible, desactivación o vencimiento cierran admisión y limpian pendientes. El panel considera desconectado al Gateway tras 10 s sin anuncios. El firmware requiere control V3 y capacidad `controlCaptura: 1`; el CLI también usa este contrato. No basta conectar ambos equipos a un router externo: las órdenes deben venir de la PC que es la puerta de enlace DHCP. Véase [descubrimiento_gateway.md](descubrimiento_gateway.md).

El Gateway conserva el lote HTTP pendiente hasta recibir cualquier 2xx o acumular cinco intentos fallidos, con espera exponencial entre intentos. Los tiempos máximos configurados de conexión y lectura HTTP son 400 ms; el tope configurado de espera entre reintentos es 8 s. Al agotar los intentos descarta el lote y cuenta la pérdida. No hay almacenamiento persistente en el Gateway.

El receptor valida el lote completo antes de encolarlo. Devuelve 202 si lo admite y 503 si la cola está llena o se está cerrando. Un hilo único escribe el CSV, hace `flush` por lote y `fsync` al cerrar. **202 confirma admisión en memoria, no persistencia final en disco.** El receptor no deduplica retransmisiones: una respuesta perdida puede producir filas repetidas; el preprocesamiento conserva la primera RSSI por columna de un vector.

El Gateway descarta RSSI mientras está inactivo y limpia sus pendientes entre archivos. Cada POST lleva `X-Heatmap-Captura`; Python rechaza con 409 un ID anterior y con 503 registros antes del inicio o durante el cierre. El control delimita recepción en Gateway, no medición en torre: las pequeñas colas de las torres y sus relojes locales se mantienen.

## Contrato CSV y formación del vector

El CSV v3 contiene estas columnas, en este orden:

```text
timestamp_utc_pc,sesion_gateway,tiempo_gateway_recepcion_ms,tiempo_torre_ms,
torre_id,sesion_torre,secuencia_torre_tx,mac_torre,jugador_id,
sesion_jugador,secuencia,rssi
```

Las capturas guiadas nuevas añaden la columna `cuadricula`, un JSON `{filas, columnas, zonas}` con el acomodo visual por celdas. El Gateway no envía ese campo; Express lo pasa al receptor al iniciar la captura. Las capturas manuales o clientes anteriores pueden seguir produciendo sólo las doce columnas base.

`timestamp_utc_pc` se añade al admitir la lectura en el receptor. Los tiempos `*_ms` pertenecen a relojes locales de arranque; no son relojes sincronizados entre placas. Las sesiones permiten distinguir reinicios.

Cada archivo crudo se procesa por separado. La clave del vector es `(sesion_gateway, jugador_id, sesion_jugador, secuencia)`. La MAC determina la columna, siempre en este orden:

```text
[rssi_sup_izq, rssi_sup_der, rssi_inf_izq, rssi_inf_der]
```

La tabla física está documentada en [mapa_torres_fisicas.md](mapa_torres_fisicas.md) y codificada en `python/mvp_config.py`; ambas deben mantenerse sincronizadas. Una MAC desconocida causa error. Los IDs dinámicos nunca eligen la columna del modelo.

El resultado incluye sesiones, secuencia, `elapsed_s`, `zona`, `dataset`, `archivo_origen`, las cuatro RSSI, `faltantes`, `completo` y `cuadricula`. Los vectores incompletos se conservan marcados y se excluyen del entrenamiento y la predicción. La preparación requiere al menos un vector completo en el conjunto.

La etiqueta se asigna explícitamente por archivo en la web; en CLI se obtiene de `zona_N` en el nombre o de `--zona`. `dataset` es opcional. No se infieren zonas mediante bloques temporales ni se recortan los primeros 6 s, una cantidad fija de filas o periodos de transición. Las constantes temporales heredadas de `mvp_config.py` no controlan el preprocesamiento actual.

## Backend, procesos y persistencia

Express 5/TypeScript expone `/api/estado`, `/api/gateway`, `/api/lecturas`, `/api/preparacion`, `/api/entrenamiento` y `/api/mapas`. `shared/lecturas.ts` comparte los tipos de captura y descubrimiento con React. [backend/README.md](../backend/README.md) documenta las rutas y variables.

`GestorLecturas` permite una captura activa y valida nombre, duración de 1–86400 s e identificador de solicitud. Repetir la misma solicitud con los mismos parámetros recupera la captura original; otros parámetros causan conflicto. Python recibe argumentos sin shell y publica eventos JSON y un archivo de estado. Python prepara HTTP/CSV y publica `iniciando` con `preparado: true`. El tiempo monotónico empieza sólo tras el ACK del Gateway y la señal de inicio del backend. Si no se confirma en 10 s, se cierra como fallo y se conservan los archivos creados.

Los estados son `iniciando`, `grabando`, `cerrando`, `completada`, `detenida` y `error`. Se espera la salida del hijo antes de liberar la captura. El backend recupera metadatos tras reiniciar y consulta si el PID sigue vivo. La parada usa stdin y un archivo de señal; los resultados parciales se conservan.

| Ubicación inicial | Contenido |
|---|---|
| `data/raw/` | CSV crudos; configurable con `DIRECTORIO_DATOS`. |
| `data/raw/.lecturas/` | Metadatos, estados, señales de inicio/parada y `.control-gateway.json` con la orden/revisión persistidas. Sigue a `DIRECTORIO_DATOS`. |
| `data/processed/preparaciones/<UUID>/` | CSV preparado y resumen; copias para descarga. |
| `models/entrenamientos/<UUID>/` | Solicitud, PID, estado y artefactos de un entrenamiento web. |
| `models/` | Exportación inicial de modelos `.joblib` y JSON. |
| `data/processed/mapas_web/<UUID>/` | Solicitud, PID, estado y copias de mapas web. |
| `data/processed/mapas/` | Exportación inicial de PNG, lecturas por jugador, predicciones y resúmenes. |

Preparación permite una exportación opcional a carpeta existente. Entrenamiento y mapas permiten elegir su carpeta de salida. Las exportaciones web reservan nombres con sufijos para evitar sobrescritura. Los CLI tienen sus propias opciones y no heredan automáticamente esa política.

Entrenamiento y mapas ejecutan trabajos asíncronos con un máximo de 15 minutos y un bloqueo por módulo en la instancia del backend. Sus archivos permiten consultar trabajos conocidos tras reiniciar, pero sus bloqueos en memoria no se reconstruyen como una cola global persistente. Preparación responde al finalizar y tiene un límite de 120 s. No hay una base de datos ni un servicio externo de trabajos.

## Frontend y acceso

React 19 y Vite implementan navegación por estado local en `App.tsx`. `useServidor` consulta el backend cada segundo; Datasets consulta cada 2 s y entrenamiento/mapas cada 1,5 s mientras están pendientes. Los módulos de captura, preparación y análisis tienen sus propios formularios y estados.

La recolección guiada admite de 1 a 20 filas y columnas, numeración serpentina inicial e intercambio visual de zonas. El recorrido sigue el orden numérico; el acomodo visual se envía con la solicitud de captura y se conserva en CSV, preparación y modelo para dibujar el mapa. Cada zona exige confirmación antes de crear su CSV; saltarla no crea archivo. El recorrido y la solicitud se guardan en `localStorage` para recuperación. Entrenamiento y mapas guardan el identificador del último trabajo.

Recolección y consulta de capturas pueden usarse desde el móvil. Entrenamiento, mapas y selección/exportación a rutas elegidas requieren una conexión desde la propia PC. Los selectores nativos se abren en su escritorio (Zenity en Linux, AppleScript en macOS y PowerShell/Windows Forms en Windows). Preparación sin ruta elegida recibe el contenido de CSV subidos desde el navegador.

## Modelos, mapas y límites actuales

| Flujo | Entradas y comportamiento |
|---|---|
| Entrenamiento web | Un CSV preparado, vectores completos y zonas enteras positivas. KNN configurable (K, pesos, distancia y StandardScaler opcional) o Random Forest configurable. Entrena todas las entradas; no evalúa automáticamente. |
| KNN CLI | CSV preparados, crudos por zona o carpetas no recursivas. Zonas enteras positivas. StandardScaler y pesos por distancia. K=5 inicial; `--validar-por-grupo` permite seleccionar K con LeaveOneGroupOut cuando hay al menos dos grupos. |
| Random Forest CLI | Mismas entradas del cargador CLI, con archivos de prueba explícitos. 300 árboles y semilla 42. El usuario decide la separación entre entrenamiento y prueba. |
| Mapas web | Uno o varios CSV crudos o preparados y un modelo `.joblib` con `predict`. No exige etiqueta real de zona. Separa hasta 10 jugadores por sesión del Gateway; conserva lecturas ordenadas por jugador, genera PNG por jugador con vectores completos y resúmenes individuales y generales CSV/JSON. |
| Reproducción CLI | CSV preparado y modelo; exporta predicciones, probabilidades máximas y un mapa. El suavizado recorre las filas de entrada; para varias sesiones/jugadores use el flujo web, que separa historiales. |

El preset inicial es 3×3 en serpentina (`1 2 3 / 6 5 4 / 7 8 9`), configurable desde el frontend hasta 20×20. La geometría (`filas`, `columnas`, permutación de zonas `1..N`) se incluye como JSON en la columna `cuadricula` de los CSV nuevos y del resultado preparado; entrenamiento la guarda en `modelo.cuadricula_` y en su resumen. Mapas utiliza la geometría del modelo/CSV y representa todas sus celdas, también las que tienen conteo cero. Para archivos anteriores se puede indicar explícitamente desde Preparación o Mapas; sin geometría se mantiene el preset 3×3. Se rechazan dimensiones inválidas, etiquetas fuera del mapa y geometrías contradictorias. El suavizado web usa mayoría causal de 1–1000 predicciones, separado por archivo, Gateway, jugador y sesión del jugador.

El calor representa cantidad y proporción de vectores predichos por zona, sin ponderar por duración entre muestras. No mide por sí solo segundos de permanencia, precisión, confianza ni distancia física. No están implementados un posicionamiento continuo interpolado ni una visualización de predicciones en vivo durante la captura.

## Datos locales y evidencia

Git excluye capturas, resultados y modelos generados, salvo documentación y marcadores. Una copia recién clonada puede no contenerlos; esta copia de trabajo sí contiene datos y modelos locales. Su existencia no certifica la geometría, procedencia o validez experimental. Conserve para cada campaña el mapa físico, geometría, recorrido, orientación, duración, sesiones, CSV, logs e informes, sin atribuir resultados de archivos ausentes.

## Configurar N zonas

Para 12 zonas, el administrador cambia Recolección a 3 filas y 4 columnas y, si hace falta, intercambia sus posiciones. Los CSV guiados guardan esa configuración; Preparación la recupera, Entrenamiento la muestra y guarda dentro del modelo, y Mapas la usa automáticamente. No se modifica firmware ni código para pasar de 9 a 12 zonas.

Los CLI de preparación, entrenamiento KNN/Random Forest y reproducción aceptan `--filas` junto con `--columnas` para serpentina, o `--cuadricula` con un archivo JSON del acomodo. La geometría explícita debe coincidir con cualquier metadato existente. Los informes usan matrices de confusión con etiquetas dinámicas; KNN calcula métricas espaciales sólo si dispone de geometría (preset 3×3 para entradas antiguas limitadas a nueve).

## Recepción y mapas por jugador

Los mapas web separan por `(sesion_gateway, jugador_id)` para no unir IDs reasignados después de un reinicio del Gateway. Los CSV separados conservan columnas, valores y duplicados, ordenados numéricamente por sesión del jugador, secuencia y `torre_id`. La MAC física define las características; el ID dinámico sólo ordena las filas. Un resultado sin vectores completos conserva CSV/estadísticas y no produce imagen.

El resumen general (CSV y JSON) contiene una fila por resultado. Por sesión del jugador se estima el rango `max(secuencia) − min(secuencia) + 1`, y después se suman esos rangos. La recepción es paquetes únicos / (rango × 4); el porcentaje de vectores completos es secuencias con las cuatro torres / rango. Incluye secuencias totalmente ausentes; los duplicados se conservan pero no inflan porcentajes. Estos valores sólo describen el tramo observado y no identifican en qué enlace se perdió información. Con entradas preparadas, las métricas que requieren paquetes crudos quedan no disponibles. El flujo CLI de reproducción conserva su comportamiento anterior.

# Backend local de captura y análisis

Este backend se ejecuta en la PC de captura junto con Python; el frontend se ejecuta en el navegador de la PC o de un dispositivo conectado a su red. La API y el frontend escuchan en `0.0.0.0:8000`, accesibles desde la PC y los dispositivos de su red; los CSV se guardan en `data/raw` de esa PC. El Gateway se conecta al hotspot Wi-Fi de la PC y envía lotes v3 al receptor Python en HTTP 8080. No utiliza servidores remotos.

## Preparación y uso

Requiere Node.js 22.12+ y Python 3.10+. El receptor no necesita las dependencias de análisis KNN.

Desde la raíz del proyecto, prepare las dependencias y las compilaciones una vez:

```bash
npm run instalar
npm run build
```

Para levantar la aplicación:

```bash
npm start
```

En la PC abra `http://localhost:8000`. En el móvil conectado al hotspot abra `http://IP_DE_LA_PC:8000`, usando la IP de la interfaz que crea el hotspot. El backend imprime las direcciones IPv4 disponibles al arrancar. En Linux Mint puede consultarlas con `nmcli -f GENERAL.DEVICE,GENERAL.CONNECTION,IP4.ADDRESS device show`; busque la conexión del hotspot y omita la máscara `/24` al escribir la URL. Si el móvil no puede acceder, compruebe que el firewall permita TCP 8000 desde el hotspot. El backend sirve la interfaz compilada y ejecuta procesos Python cuando se solicita una captura, preparación, inspección de CSV, entrenamiento o generación de mapas. No necesita otro comando por CSV. Después de editar la interfaz o el backend, ejecute `npm run build` nuevamente.

El usuario debe activar el hotspot de la PC (2.4 GHz, canal 6 por defecto), configurar su nombre y clave en `firmware/Gateway/config.h` y cargar el firmware del Gateway. Gateway, torres y jugador deben compartir el canal. El Gateway calcula el broadcast de su red y anuncia su presencia cada dos segundos. El backend escucha en UDP 4210 incluso sin una captura, y responde al emisor con la disponibilidad del receptor. No necesita configurar `RECEPTOR_DESTINO_UDP` para usar la web. Encienda el Gateway y luego las torres y el jugador. Los CSV y HTTP v3 se conservan; el descubrimiento UDP ahora lo inicia el Gateway; el backend no crea el hotspot.

## Capturas

- Manual: envía nombre y duración; Python completa ese CSV aunque el navegador se cierre o se desconecte.
- Guiado: confirma cada zona antes de crear un CSV. Saltar zona no envía una orden de grabación ni crea archivos. No hay avance automático a otra captura.
- Detener: cierra y conserva las filas aceptadas; el resultado se identifica como detenido, no como una captura que completó su duración.
- El reloj comienza después del ACK del Gateway que confirma limpieza y apertura. Python prepara antes el puerto y el CSV, sin admitir registros ni contar tiempo. Los conteos muestran filas realmente escritas, no paquetes simulados.
- Los nombres utilizan fecha y hora de creación de la solicitud en Costa Rica por defecto (el inicio efectivo del receptor se informa por separado): `nombre_DD_MM_YY_HH_MM.csv` o `nombre_zona_1_DD_MM_YY_HH_MM.csv`. Si el nombre ya existe, se añade `_2`, `_3`, etc. No se sobrescribe ni se anexa a otra captura.
- Los archivos se escriben durante la captura y se drenan y sincronizan al cerrarse. Los cortes de proceso o errores se reportan; los archivos parciales se conservan.
- Datasets lista las capturas creadas por esta API y permite descargar los CSV cerrados. Los CSV históricos que no tienen metadatos de esta API no se incorporan automáticamente.

El backend conserva metadatos y eventos en `data/raw/.lecturas`. Python publica su resultado ahí incluso si el backend se interrumpe. Al reiniciar, se recupera una captura aún activa o su resultado final; si Python desapareció sin confirmar el cierre, se informa un error y se conserva el CSV. No borre esos metadatos mientras una captura esté activa.

El navegador conserva el recorrido, acomodo, zonas omitidas y la última solicitud en almacenamiento local. Al recargar consulta la misma solicitud; no inicia otra automáticamente. Ante una respuesta perdida, «Reintentar inicio» reutiliza el identificador original para evitar duplicados.

## Desarrollo

En terminales separadas, levantadas una vez:

```bash
npm run dev --prefix backend
npm run dev --prefix frontend
```

En este modo de dos terminales, abra el frontend en `http://IP_DEL_HOTSPOT:5173` desde el móvil (o `http://localhost:5173` en la PC). Vite comunica `/api` con el backend local en 8000. Permita TCP 5173 desde el hotspot si usa firewall. La interfaz de producción se abre en 8000 y no necesita Vite. Solo un proceso backend debe estar escuchando en ese puerto.

## Configuración del entorno

| Variable | Valor inicial | Uso |
|---|---|---|
| `PYTHON_EJECUTABLE` | Python de `.venv` si existe; si no `python` en Windows o `python3` en Linux | Ruta del intérprete. |
| `HOST_BACKEND` | `0.0.0.0` | Interfaces de escucha; use la IP del hotspot para limitarlo a esa red o `127.0.0.1` para acceso solo desde la PC. |
| `PUERTO_BACKEND` | `8000` | Puerto de la interfaz y API local. |
| `DIRECTORIO_DATOS` | `data/raw` del repositorio | Directorio de CSV y metadatos. |
| `RECEPTOR_HOST` | `0.0.0.0` | Interfaz de escucha del receptor. |
| `RECEPTOR_PUERTO_HTTP` | `8080` | Puerto anunciado al Gateway. |
| `RECEPTOR_DESTINO_UDP` | `192.168.4.255` | Valor legado; la captura web desactiva los anuncios desde Python y ya no depende de este destino. |
| `RECEPTOR_PUERTO_UDP` | `4210` | Puerto donde el backend escucha al Gateway; debe coincidir con su config.h. |
| `ZONA_HORARIA` | `America/Costa_Rica` | Zona para formar nombres de archivo. |

Estas variables se configuran en el entorno de la terminal que levanta el backend. La aplicación no carga un archivo `.env` automáticamente. El ejecutable Python se pasa directamente, sin construir un comando de shell.

## API

- `GET /api/estado`: disponibilidad de la API, receptor, captura activa y anuncios del Gateway.
- `GET /api/gateway`: estado de la escucha UDP y dispositivos detectados, IP, sesión, contadores y confirmación de la PC. Un dispositivo queda desconectado tras diez segundos sin anuncios. Esta presencia no garantiza por sí sola que haya mediciones de las torres.
- `POST /api/lecturas`: `{ "solicitudId": "UUID", "nombreArchivo": "laboratorio_zona_1", "duracionSegundos": 60, "cuadricula": { "filas": 3, "columnas": 3, "zonas": [1,2,3,6,5,4,7,8,9] } }`. `cuadricula` es opcional para clientes anteriores/capturas manuales; forma parte de la comparación idempotente.
- `GET /api/lecturas/actual`: captura activa o `null`.
- `GET /api/lecturas/:id`: estado, nombre definitivo, fechas, conteo y errores.
- `GET /api/lecturas/solicitud/:id`: recuperar una solicitud cuya respuesta se perdió.
- `POST /api/lecturas/:id/detener`: cierre ordenado.
- `GET /api/lecturas`: resultados de las capturas creadas por la API.
- `GET /api/lecturas/:id/archivo`: descarga de un CSV cerrado.

Solo se permite una captura activa. La misma `solicitudId` con los mismos parámetros devuelve la captura original; con parámetros diferentes produce conflicto. Las rutas, nombres y duraciones se validan en el backend.

Consulte [el protocolo de descubrimiento](../docs/descubrimiento_gateway.md). El firewall debe admitir UDP 4210 y HTTP 8080 desde el hotspot. Si el puerto UDP está ocupado, el error se muestra en Gateway; cierre el otro proceso y reinicie el backend.

## Verificación

```bash
npm test --prefix backend
.venv/bin/python -m unittest discover -s tests -v
```

Las pruebas del backend ejecutan el receptor real con lotes HTTP simulados y directorios temporales: prueban cierre por tiempo y parada, conservación de registros, idempotencia, descargas, conflictos, errores y recuperación tras interrumpir el backend. La conectividad física debe verificarse con las ESP32 encendidas; los datos simulados no equivalen a una prueba de radio.

El preprocesamiento actual usa zona explícita por archivo y no divide en bloques de 60 s ni excluye los primeros 6 s. Preparación y entrenamiento web/CLI aceptan zonas enteras positivas. Las capturas guiadas nuevas conservan dimensiones y acomodo en la columna adicional `cuadricula`; el CSV preparado y el modelo mantienen esa geometría para dibujar mapas de N zonas. El preset para archivos anteriores es 3×3 y puede configurarse desde el frontend. Consulte [arquitectura y contratos](../docs/arquitectura.md).

## API de preparación de datos

`POST /api/preparacion` recibe JSON `{archivos: [{nombre, contenido, zona}], cuadricula?}` con CSV UTF-8 (máximo 32 MB de cuerpo). Ejecuta `python/preparar_datos_web.py` usando el Python configurado para el receptor. Valida etiquetas explícitas y columnas RSSI, procesa cada archivo por separado y guarda `dataset_etiquetado.csv` y su resumen JSON en `data/processed/preparaciones/<UUID>/`. No inicia el entrenamiento ni modifica capturas.

La respuesta incluye los conteos, zonas, procedencia y enlaces `GET /api/preparacion/:id/csv` y `GET /api/preparacion/:id/resumen`. Rechaza CSV vacíos, columnas o MAC desconocidas, etiquetas inválidas y nombres duplicados. Si falla cualquier archivo, no publica un resultado parcial.

La preparación acepta `directorioSalida` opcional (carpeta existente, absoluta o relativa al proyecto). Exporta allí el CSV y el JSON sin sobrescribir archivos: usa sufijos `_2`, `_3`, etc. La respuesta incluye `rutaSalida`. Mantiene una copia interna para las descargas. `POST /api/preparacion/seleccionar-carpeta` con `{ruta}` abre el selector nativo en el escritorio de la PC; sin ruta comienza en el proyecto y al cancelar devuelve `ruta: null`. En Linux usa Zenity y necesita una sesión gráfica activa. La exploración y exportación a rutas elegidas requieren una conexión desde la misma PC.

El campo `dataset` es opcional por compatibilidad con entradas antiguas; su ausencia no impide preparar ni entrenar y la web ya no lo envía. No se deduce un dataset por defecto a partir de nombres de archivo.

## API de entrenamiento

Las operaciones de `/api/entrenamiento` requieren una conexión desde esta PC:

- `POST /seleccionar-csv`: abre el selector nativo de archivo CSV y devuelve su ruta (null si se cancela).
- `POST /inspeccionar` con `{entrada}`: valida un CSV preparado y devuelve cantidades y etiquetas presentes.
- `POST /` con `{entrada, algoritmo, parametros, nombre, directorioSalida}`: inicia entrenamiento y devuelve HTTP 202 con `id`. Algoritmos: `knn`, `random_forest`. Parámetros KNN: `{k, pesos: "distance"|"uniform", distancia: "euclidean"|"manhattan", normalizar: boolean}`. RF: `{arboles, profundidad: null|entero, min_division, min_hoja, semilla}`.
- `GET /:id`: consulta estado pendiente, entrenando, completado o error y rutas del resultado.
- `GET /:id/modelo` y `GET /:id/resumen`: descargan artefactos terminados.

Ejecuta `python/entrenamiento_web.py` con el Python configurado y las dependencias de `requirements.txt`. Conserva solicitud, estado, modelo y resumen en `models/entrenamientos/<UUID>/`. Exporta modelo y resumen a la carpeta elegida, o `models/` por defecto, con nombres libres de colisiones. El CSV original no se modifica. El entrenamiento usa las cuatro RSSI y las zonas positivas presentes en los vectores completos, sin restricciones por dataset ni evaluación automática. KNN guarda la normalización junto al clasificador si se habilita. Una tarea por vez, máximo 100 MB de CSV y 15 minutos por entrenamiento.

## API de mapas de calor

`/api/mapas` requiere acceso desde la misma PC:

- `POST /seleccionar` con `{tipo: "csv"|"joblib"}`: selector nativo, múltiple para CSV y simple para modelo; devuelve `{archivos: [...]}` y un arreglo vacío si se cancela.
- `POST /` con `{entradas: string[], modelo, nombre, directorioSalida, ventana, cuadricula?}`: valida rutas, inicia Python y devuelve HTTP 202 con `id`. Máximo 50 CSV, 100 MB por archivo y 200 MB de CSV en total. `directorioSalida` vacío usa `data/processed/mapas/`.
- `GET /:id`: estado, progreso por archivos, configuración y resultados con URLs de imágenes y descargas.
- `GET /:id/archivo/:indice/imagen`: PNG para la galería. Tipos `png`, `csv`, `lecturas` y `json` permiten descargar imagen, predicciones, lecturas originales ordenadas y resumen. Un jugador sin vectores completos devuelve 404 para imagen/PNG y conserva sus demás descargas. Los trabajos antiguos conservan sus rutas previas.
- `GET /:id/resumen/csv` y `GET /:id/resumen/json`: resumen general del trabajo. Disponibles al finalizar la generación.

Ejecuta `python/mapas_calor_web.py` con Matplotlib en modo Agg y el Python configurado. Conserva solicitud, PID, estado y copias de los artefactos en `data/processed/mapas_web/<UUID>/`. Exporta PNG, CSV y JSON sin sobrescribir. Una tarea por vez y 15 minutos de plazo. Cada CSV se separa por `(sesion_gateway, jugador_id)`, admite hasta 10 jugadores por arranque del Gateway y suaviza por sesión del jugador; si falla uno, el estado informa el error y conserva los mapas anteriores del lote. La geometría se obtiene del modelo o CSV y puede indicarse explícitamente para archivos antiguos. Se rechazan etiquetas fuera de esa geometría o configuraciones que contradigan la geometría guardada.

## Garantías de entrega y continuidad

La respuesta 202 de `/v1/registros` pertenece al receptor Python, no a Express, y confirma que el lote completo entró a su cola en memoria. El escritor hace `flush` por lote y sincroniza al cerrar; la confirmación HTTP no equivale a un `fsync` por lote. No se deduplican filas en el receptor. El preprocesamiento cuenta duplicados y conserva la primera lectura de cada columna del vector.

El control UDP V3 con puerto 0 cierra la admisión del Gateway y limpia cola, lote HTTP y reintentos. Una captura nueva lleva UUID y revisión propios, limpia antes de confirmar y no reutiliza pendientes de la anterior. Jugador y torres no reciben órdenes nuevas. Consulte el [protocolo de campo](../docs/prueba_campo_captura.md).

La recuperación de capturas utiliza metadatos persistidos, eventos de Python y comprobación del PID. Entrenamiento y mapas permiten consultar trabajos conocidos por sus archivos de solicitud, PID y estado, pero sus bloqueos por módulo viven en memoria y no se reconstruyen como una cola global al reiniciar. Entrenamiento y mapas tienen un plazo de 15 minutos por trabajo; preparación, 120 segundos.

## Contrato de geometría

`cuadricula` contiene `{filas, columnas, zonas}`: dimensiones enteras de 1 a 20 y una permutación completa de `1..filas*columnas` en orden visual por celdas. La validación HTTP se comparte en `shared/cuadricula.ts`; Python valida nuevamente en `python/cuadricula.py`. El receptor recibe `--cuadricula-json` al iniciar capturas guiadas y escribe el JSON en una columna CSV adicional, sin cambiar el protocolo ESP-NOW ni el cuerpo HTTP del Gateway.

La preparación detecta geometrías embebidas, valida zonas y rechaza mezclar acomodos diferentes. La geometría se incluye en su CSV y resumen. El entrenamiento la serializa en `modelo.cuadricula_` y JSON. Mapas combina modelo, CSV y configuración explícita, exige concordancia y usa 3×3 sólo si ninguno contiene geometría. El estado y resumen de cada mapa incluyen la geometría efectiva y un conteo para cada zona, incluso cero.

## Inicio confirmado y compatibilidad

`iniciando` incluye apertura de Python y confirmación del Gateway; `preparado` indica HTTP/CSV listos sin grabar y `gatewayConfirmado` registra el ACK. Tras el ACK se escribe `<id>.iniciar` y se envía `iniciar` por stdin; Python publica entonces `grabando` con fechas efectivas. El inicio sigue siendo HTTP 202 y se consulta por ID/solicitud. Sin ACK en 10 s se desactiva el Gateway, se conserva el CSV fallido y se informa el error; no se inventa una captura completada.

El gestor posee el descubridor/controlador UDP y persiste `.lecturas/.control-gateway.json`. Las órdenes se envían al cambiar el estado y se reintentan cada 250 ms, con renovación cada 2 s después del ACK. Una recuperación reutiliza ID y revisión mientras el receptor y la autorización siguen disponibles; una autorización cerrada/vencida o un reinicio de Gateway requieren una captura nueva.

El receptor web se inicia con `--captura-id`, `--esperar-inicio`, `--iniciar-archivo` y `--sin-anuncio-udp`. Cada lote HTTP debe incluir `X-Heatmap-Captura`; un ID incorrecto recibe 409 y un receptor aún preparado recibe 503. El cuerpo JSON y el CSV v3 mantienen sus columnas base. El Gateway debe anunciar `controlCaptura: 1`; versiones antiguas se rechazan con un error de actualización. El receptor CLI incorpora el mismo control y no permite el modo legacy. Véase [el contrato UDP y la secuencia completa](../docs/descubrimiento_gateway.md).

Los resultados de mapas añaden `jugadorId`, `sesionGateway`, `tieneMapa`, `estadisticas`, `lecturas` y `rutaLecturas`. El estado mantiene `total`/`procesados` como archivos y añade `mapasGenerados`, `jugadoresProcesados`, `resumenGeneralCsv`/`resumenGeneralJson`. Sin vectores completos se publica el resultado con imagen nula y sin ejecutar predicción. El CSV separado conserva todas las columnas y valores, ordenados numéricamente por sesión, secuencia y `torre_id` (empates estables).

Por sesión se estima `secuencias_esperadas = max(secuencia) - min(secuencia) + 1`; se suman los rangos por jugador. `paquetes_esperados = secuencias_esperadas × 4`. La recepción utiliza paquetes únicos por sesión/secuencia/MAC física. Los vectores completos requieren las cuatro MAC registradas; su porcentaje usa las secuencias esperadas. El JSON/CSV general incluye duplicados, secuencias ausentes e incompletos observados. Sólo se mide el rango observado, no pérdidas anteriores/posteriores ni la causa de las pérdidas. Los CSV preparados no permiten reconstruir paquetes: esas métricas son `null` en JSON y celdas vacías en CSV.

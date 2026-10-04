# Backend local de recolección

Este backend se ejecuta en la misma PC que el frontend y Python. La API y el frontend escuchan en `0.0.0.0:8000`, accesibles desde la PC y los dispositivos de su red; los CSV se guardan en `data/raw` de esa PC. El Gateway se conecta al hotspot Wi-Fi de la PC y envía lotes v3 al receptor Python en HTTP 8080. No utiliza servidores remotos.

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

En la PC abra `http://localhost:8000`. En el móvil conectado al hotspot abra `http://IP_DE_LA_PC:8000`, usando la IP de la interfaz que crea el hotspot. El backend imprime las direcciones IPv4 disponibles al arrancar. En Linux Mint puede consultarlas con `nmcli -f GENERAL.DEVICE,GENERAL.CONNECTION,IP4.ADDRESS device show`; busque la conexión del hotspot y omita la máscara `/24` al escribir la URL. Si el móvil no puede acceder, compruebe que el firewall permita TCP 8000 desde el hotspot. El backend sirve la interfaz compilada y ejecuta Python únicamente cuando se solicita una captura. No necesita otro comando por CSV. Después de editar la interfaz o el backend, ejecute `npm run build` nuevamente.

El usuario debe activar el hotspot de la PC (2.4 GHz, canal 6 por defecto), configurar su nombre y clave en `firmware/Gateway/config.h` y cargar el firmware del Gateway. Gateway, torres y jugador deben compartir el canal. El Gateway calcula el broadcast de su red y anuncia su presencia cada dos segundos. El backend escucha en UDP 4210 incluso sin una captura, y responde al emisor con la disponibilidad del receptor. No necesita configurar `RECEPTOR_DESTINO_UDP` para usar la web. Encienda el Gateway y luego las torres y el jugador. Los CSV y HTTP v3 se conservan; el descubrimiento UDP ahora lo inicia el Gateway; el backend no crea el hotspot.

## Capturas

- Manual: envía nombre y duración; Python completa ese CSV aunque el navegador se cierre o se desconecte.
- Guiado: confirma cada zona antes de crear un CSV. Saltar zona no envía una orden de grabación ni crea archivos. No hay avance automático a otra captura.
- Detener: cierra y conserva las filas aceptadas; el resultado se identifica como detenido, no como una captura que completó su duración.
- El reloj cuenta desde que Python confirma que el puerto y el CSV están listos. Los conteos muestran filas realmente escritas, no paquetes simulados.
- Los nombres utilizan fecha y hora de inicio en Costa Rica: `nombre_DD_MM_YY_HH_MM.csv` o `nombre_zona_1_DD_MM_YY_HH_MM.csv`. Si el nombre ya existe, se añade `_2`, `_3`, etc. No se sobrescribe ni se anexa a otra captura.
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

Consulte [el protocolo de descubrimiento](../docs/descubrimiento_gateway.md). El firewall debe admitir UDP 4210 y HTTP 8080 desde el hotspot. Si el puerto UDP está ocupado, el error se muestra en Gateway; cierre el otro proceso y reinicie el backend.
- `POST /api/lecturas`: `{ "solicitudId": "UUID", "nombreArchivo": "laboratorio_zona_1", "duracionSegundos": 60 }`.
- `GET /api/lecturas/actual`: captura activa o `null`.
- `GET /api/lecturas/:id`: estado, nombre definitivo, fechas, conteo y errores.
- `GET /api/lecturas/solicitud/:id`: recuperar una solicitud cuya respuesta se perdió.
- `POST /api/lecturas/:id/detener`: cierre ordenado.
- `GET /api/lecturas`: resultados de las capturas creadas por la API.
- `GET /api/lecturas/:id/archivo`: descarga de un CSV cerrado.

Solo se permite una captura activa. La misma `solicitudId` con los mismos parámetros devuelve la captura original; con parámetros diferentes produce conflicto. Las rutas, nombres y duraciones se validan en el backend.

## Verificación

```bash
npm test --prefix backend
python3 -m unittest discover -s tests -v
```

Las pruebas del backend ejecutan el receptor real con lotes HTTP simulados y directorios temporales: prueban cierre por tiempo y parada, conservación de registros, idempotencia, descargas, conflictos, errores y recuperación tras interrumpir el backend. La conectividad física debe verificarse con las ESP32 encendidas; los datos simulados no equivalen a una prueba de radio.

El pipeline KNN conserva su protocolo anterior de etiquetado temporal. Los CSV por zona, duraciones configurables y cuadrículas distintas necesitan una adaptación posterior del preprocesamiento antes de entrenar.

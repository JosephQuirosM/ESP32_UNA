# Panel ESP32 — frontend

Interfaz en React y TypeScript basada en `references/Main Menu`, conectada al backend local de recolección. El backend y Python corren en la PC de captura; React corre en el navegador y los archivos se guardan en la PC. Consulte la [arquitectura vigente](../docs/arquitectura.md).

## Uso completo

Desde la raíz del proyecto:

```bash
npm run instalar
npm run build
npm start
```

En la PC abra `http://localhost:8000`; desde el móvil conectado al hotspot, `http://IP_DE_LA_PC:8000`. El backend muestra las direcciones de acceso al arrancar. Consulte `../backend/README.md` para configuración, API y detalles de la captura.

## Desarrollo de la interfaz

Con el backend iniciado en 8000:

```bash
npm run dev --prefix frontend
```

En desarrollo, abra `http://localhost:5173` en la PC o `http://IP_DEL_HOTSPOT:5173` en el móvil. Vite escucha en todas las interfaces, mantiene el puerto 5173 y redirige `/api` al backend de esta PC en 8000. Reinicie la terminal de Vite después de cambiar su configuración; el firewall debe permitir TCP 5173 desde el hotspot. `npm run build --prefix frontend` comprueba TypeScript y genera `dist/`, que el backend sirve junto con su API. Publicar solamente `dist/` en un servidor estático no proporciona la recolección Python.

## Flujos

- Manual: nombre y duración; crea un CSV con fecha y hora de la solicitud y permite detenerlo anticipadamente.
- Guiado: filas × columnas configurables (3×3 inicial, hasta 20 por lado), un CSV por zona, confirmación entre zonas y salto sin crear archivo.
- Las zonas se pueden intercambiar mediante arrastre o Espacio y flechas. El recorrido conserva su orden numérico.
- Recargar recupera el recorrido y consulta la solicitud existente al backend. Cerrar la pestaña no detiene la captura actual ni inicia zonas siguientes.
- Datasets: resultados completos o parciales y descarga de CSV cerrados.
- Gateway: parámetros de referencia de solo lectura y recepción basada en datos reales.

El estado del recorrido se guarda en `localStorage`. Los resultados y archivos permanecen en el disco del PC y pueden consultarse en Datasets aunque se borre el almacenamiento del navegador.

## Preparación de datos

La card «Preparación de Datos» y la navegación «Preparación» abren la vista basada en la referencia Stitch de `references/Preparado de datos/`. Permite seleccionar varios CSV o arrastrarlos, revisar sus tarjetas, eliminar archivos y recorrer la lista con scroll interno. La zona se sugiere a partir del nombre y es editable antes de procesar. No se solicita ni se deduce un dataset del nombre del archivo; basta con asignar la zona. Se conserva el nombre del archivo como procedencia. Acepta hasta 200 archivos y 28 MB por selección.

«Preparar datos y unificar CSV» envía la selección al backend y ejecuta el agrupado Python real. No recorta filas iniciales, no aplica filtros Kalman/IQR ni normaliza para entrenamiento. Conserva los vectores incompletos marcados y muestra conteos reales. El resultado y el resumen se descargan desde la pantalla; se guardan en la carpeta elegida con «Explorar» o escrita en el campo de ruta. Sin una ruta elegida se utiliza `data/processed/preparaciones/<id>/`. El botón «Explorar» abre el selector nativo de carpetas del sistema operativo (Zenity en Linux, diálogo de Windows o Finder en macOS); cancelar conserva la ruta anterior. Si el nombre existe, añade un sufijo numérico sin sobrescribir. Los originales seleccionados no se modifican. Preparar no ejecuta un entrenamiento.

La preparación admite zonas enteras positivas, hasta 200 archivos y 28 MB por selección. Las capturas guiadas nuevas incluyen su geometría en el CSV; la preparación la conserva automáticamente. Para archivos anteriores, «Definir cuadrícula para archivos sin geometría» permite elegir filas, columnas y posiciones. El preset es 3×3 y se pueden seleccionar hasta 20 filas y 20 columnas.

## Entrenamiento de modelos

La card y navegación «Entrenamiento» permiten seleccionar un CSV etiquetado del disco de esta PC con el selector nativo, o escribir la ruta y pulsar «Revisar CSV». Muestra los vectores completos/incompletos y su distribución por zona. Sólo los completos entran al modelo. La revisión muestra las zonas presentes y la geometría, si el CSV la incluye; no hay un máximo fijo de nueve etiquetas. No exige nombres de dataset, cobertura de todas las zonas ni nuevos recortes. Entrenamiento y mapas requieren abrir el panel desde la propia PC, porque operan con sus rutas locales; la recolección y consulta de capturas también pueden utilizarse desde el móvil.

KNN permite configurar K, pesos, distancia euclidiana/Manhattan y normalización StandardScaler. Random Forest permite configurar árboles, profundidad máxima (vacío = sin límite), muestras mínimas para dividir y por hoja, y semilla. La salida tiene nombre y carpeta elegibles con selector nativo; por defecto se exporta a `models/`. Si existe, se añade un número sin sobrescribir.

El proceso Python continúa al cambiar de módulo o recargar la página. Se consulta su estado real y se puede descargar el `.joblib` y el resumen JSON. No se muestra una precisión de entrenamiento como evaluación: la prueba del modelo corresponde a una fase posterior con archivos elegidos por el usuario.

## Mapas de calor

La card «Mapas de Calor» y la navegación «Mapas» permiten seleccionar uno o varios CSV y un modelo `.joblib` mediante el selector nativo del sistema. También se pueden introducir rutas locales. Acepta capturas RSSI crudas y vectores preparados, sin requerir etiquetas de zona para predecir. Cada CSV se separa automáticamente por `(sesion_gateway, jugador_id)`, con hasta 10 jugadores por arranque del Gateway. Cada resultado exporta sus lecturas originales ordenadas por sesión del jugador, secuencia y número de torre, conservando columnas, valores y duplicados; genera un PNG cuando hay vectores completos y un resumen JSON. Las predicciones siguen disponibles mediante la API. El nombre y la carpeta de salida son configurables con el mismo selector nativo de carpetas; si hay varios archivos, se añaden número y nombre de origen. No sobrescribe resultados existentes.

La ventana de suavizado es configurable entre 1 y 1000 predicciones: 1 lo desactiva; 5 aplica mayoría causal de las últimas cinco. Se procesa por archivo, jugador y sesión, sin mezclar historiales. No modifica el modelo ni recorta registros. Los vectores incompletos no se predicen. Los números y porcentajes del mapa son conteos de predicciones y proporciones, no exactitud ni confianza.

La galería muestra los PNG reales de Python, permite ampliarlos y descargar sus artefactos. El progreso distingue archivos terminados y mapas generados. Una tabla muestra total de filas, paquetes únicos/esperados, recepción, vectores completos y su porcentaje, incompletos, secuencias ausentes y duplicados. Permite descargar el resumen general en CSV y JSON. Un jugador sin vectores completos conserva sus descargas y no impide procesar los demás. Se recupera el último trabajo al recargar. La cuadrícula se recupera automáticamente del modelo o CSV. Para un modelo sin geometría, puede definirse desde el formulario; si no se indica, se mantiene el preset 3×3. Las etiquetas fuera de la geometría elegida y las geometrías incompatibles se rechazan. El módulo no entrena modelos.

## Estado del navegador y alcance de la cuadrícula

La navegación se controla con estado React en `App.tsx`; la API se consulta periódicamente por HTTP, sin WebSockets. El estado del servidor se consulta cada segundo, Datasets cada dos segundos y los trabajos de entrenamiento/mapas cada 1,5 segundos mientras están pendientes. Entrenamiento y mapas conservan el identificador del último trabajo en `localStorage` y recuperan su solicitud y resultado del backend.

El intercambio visual de zonas no cambia el recorrido numérico. Las capturas guiadas nuevas envían filas, columnas y el orden visual de las zonas; Python conserva esa geometría en el CSV, la preparación y el modelo. El mapa de predicción usa ese mismo acomodo. Por ejemplo, cambiar de 3×3 a 3×4 sólo requiere cambiar columnas en el frontend antes de capturar; no se modifica código.

Pulsar Grabar mantiene la vista actual y muestra un spinner en el botón deshabilitado mientras se prepara Python y el Gateway confirma limpieza y apertura. Sólo después de publicar `grabando` cambia la vista y corre el cronómetro. No se muestra una pantalla ni texto de espera del Gateway. Entre zonas se desactiva y limpia el Gateway; jugador y torres continúan transmitiendo. Revise [el protocolo de campo](../docs/prueba_campo_captura.md). Los mapas muestran proporciones de vectores predichos; no calculan segundos de permanencia ni precisión experimental.

El estado de inicio se conserva en `localStorage` junto a la solicitud: recargar recupera el mismo proceso y spinner, sin crear otro CSV. Si el Gateway no confirma en 10 s, se recupera el formulario o la zona pendiente con un error para reintentar. Un fallo anterior al inicio no marca la zona como completada.

La recepción se calcula como lecturas únicas / (4 × secuencias esperadas). El porcentaje de vectores completos usa las secuencias esperadas, no sólo las observadas. Cada sesión aporta `máxima secuencia − mínima secuencia + 1`: no se infieren pérdidas antes ni después de su rango observado. Los duplicados no aumentan porcentajes. Para CSV preparados se conservan sus filas disponibles; los paquetes y porcentajes que no pueden reconstruirse aparecen como no disponibles.

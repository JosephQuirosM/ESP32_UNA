# Panel ESP32 — frontend

Interfaz en React y TypeScript conectada al backend local de recolección. El backend y Python corren en la PC de captura; React corre en el navegador y los archivos se guardan en la PC. Consulte la [arquitectura vigente](../docs/arquitectura.md).

## Uso completo

Desde la raíz del proyecto:

```bash
npm run instalar
npm run build
npm start
```

En la PC abra `http://localhost:8000`; desde el móvil conectado al hotspot, `http://IP_DE_LA_PC:8000` e introduzca el código mostrado en la PC. El backend muestra la dirección del hotspot cuando la detecta. Consulte `../backend/README.md` para configuración, API y detalles de la captura.

## Desarrollo de la interfaz

Con el backend iniciado en 8000:

```bash
npm run dev --prefix frontend
```

En desarrollo, abra `http://localhost:5173` sólo en la PC. Vite escucha en loopback y redirige `/api` al backend local en 8000. Para el móvil, compile el frontend y use `http://IP_DEL_HOTSPOT:8000` cuando el backend detecte el hotspot. `npm run build --prefix frontend` comprueba TypeScript y genera `dist/`, que el backend sirve junto con su API. Publicar solamente `dist/` en un servidor estático no proporciona la recolección Python.

## Flujos

- Manual: nombre y duración; crea un CSV con fecha y hora de la solicitud y permite detenerlo anticipadamente.
- Guiado: filas × columnas configurables (3×3 inicial, hasta 20 por lado), un CSV por zona, confirmación entre zonas y salto sin crear archivo.
- Las zonas se pueden intercambiar mediante arrastre o Espacio y flechas. El recorrido conserva su orden numérico.
- Recargar recupera una solicitud pendiente o una captura activa sin crear otro CSV. Los formularios y las capturas cerradas vuelven al inicio del módulo.
- Datasets: resultados completos o parciales y descarga de CSV cerrados.
- Gateway: parámetros de referencia de solo lectura y recepción basada en datos reales.

Sólo se guarda en `localStorage` el estado necesario para recuperar una captura pendiente o activa. Al cerrarse, el nombre y la pantalla anterior dejan de guardarse. Los resultados y archivos permanecen en el disco del PC y pueden consultarse en Datasets.

## Preparación de datos

La vista tiene dos secciones. **Entrenamiento** conserva la preparación por zonas descrita a continuación. **Jugadores** toma un CSV de lecturas mezcladas guardado dentro de una carpeta autorizada de la PC, lo separa por `(sesion_gateway, jugador_id)` y guarda un CSV por jugador sin necesitar modelo ni generar mapas. Conserva columnas, valores y duplicados; ordena numéricamente por sesión del jugador, secuencia y torre. Muestra recepción, vectores completos, incompletos, secuencias ausentes y duplicados, y permite descargar cada CSV y el resumen general en CSV y JSON. También acepta un CSV preparado, aunque entonces no puede reconstruir las métricas de paquetes. El trabajo continúa en Python al cambiar de sección o recargar; la vista recupera solamente trabajos que siguen en curso.

La card «Preparación de Datos» y la navegación «Preparación» permiten seleccionar varios CSV del dispositivo, arrastrarlos o elegirlos directamente en las carpetas autorizadas de la PC con «Explorar CSV de la PC». El móvil no necesita descargar y volver a subir capturas. La zona se sugiere a partir del nombre y es editable antes de procesar. No se solicita ni se deduce un dataset del nombre del archivo; basta con asignar la zona. Se conserva el nombre del archivo como procedencia. Acepta hasta 200 archivos y 28 MB por selección.

«Preparar datos y unificar CSV» envía la selección al backend y ejecuta el agrupado Python real. No recorta filas iniciales, no aplica filtros Kalman/IQR ni normaliza para entrenamiento. Conserva los vectores incompletos marcados y muestra conteos reales. El resultado y el resumen se descargan desde la pantalla; se guardan en la carpeta elegida con «Explorar» o escrita en el campo de ruta. La carpeta de salida debe estar dentro de una raíz autorizada en la PC anfitriona. «Explorar» muestra las raíces autorizadas en cualquier dispositivo; el selector nativo del sistema operativo se usa sólo en la PC. Si el nombre existe, añade un sufijo numérico sin sobrescribir. Los originales seleccionados no se modifican. Preparar no ejecuta un entrenamiento.

La preparación admite zonas enteras positivas, hasta 200 archivos y 28 MB por selección. Las capturas guiadas nuevas incluyen su geometría en el CSV; la preparación la conserva automáticamente. Para archivos anteriores, «Definir cuadrícula para archivos sin geometría» permite elegir filas, columnas y posiciones. El preset es 3×3 y se pueden seleccionar hasta 20 filas y 20 columnas.

## Entrenamiento de modelos

La card y navegación «Entrenamiento» permiten seleccionar un CSV etiquetado dentro de las carpetas autorizadas con «Explorar», o escribir su ruta y pulsar «Revisar CSV». Muestra los vectores completos/incompletos y su distribución por zona. Sólo los completos entran al modelo. La revisión muestra las zonas presentes y la geometría, si el CSV la incluye; no hay un máximo fijo de nueve etiquetas. No exige nombres de dataset, cobertura de todas las zonas ni nuevos recortes. Entrenamiento y mapas también pueden utilizarse desde el móvil conectado al hotspot.

KNN permite configurar K, pesos, distancia euclidiana/Manhattan y normalización StandardScaler. Random Forest permite configurar árboles, profundidad máxima (vacío = sin límite), muestras mínimas para dividir y por hoja, y semilla. La salida tiene nombre y carpeta elegibles dentro de las raíces autorizadas. Si el nombre existe, se añade un número sin sobrescribir.

El proceso Python continúa al cambiar de módulo o recargar la página. Si sigue en curso se consulta su estado real; al terminar, la vista muestra el `.joblib` y el resumen JSON hasta salir de ella. Al volver después de completarse, abre un formulario nuevo. No se muestra una precisión de entrenamiento como evaluación: la prueba del modelo corresponde a una fase posterior con archivos elegidos por el usuario.

## Mapas de calor

La card «Mapas de Calor» y la navegación «Mapas» permiten seleccionar uno o varios CSV y un modelo `.joblib` mediante el explorador web de carpetas autorizadas; en la PC también está el selector nativo. También se pueden introducir rutas locales del backend. Acepta capturas RSSI crudas y vectores preparados, sin requerir etiquetas de zona para predecir. Cada CSV se separa automáticamente por `(sesion_gateway, jugador_id)`, con hasta 10 jugadores por arranque del Gateway. Cada resultado exporta sus lecturas originales ordenadas por sesión del jugador, secuencia y número de torre, conservando columnas, valores y duplicados; genera un PNG cuando hay vectores completos y un resumen JSON. Las predicciones siguen disponibles mediante la API. El nombre y la carpeta de salida son configurables dentro de las raíces autorizadas; si hay varios archivos, se añaden número y nombre de origen. No sobrescribe resultados existentes.

La ventana de suavizado es configurable entre 1 y 1000 predicciones: 1 lo desactiva; 5 aplica mayoría causal de las últimas cinco. Se procesa por archivo, jugador y sesión, sin mezclar historiales. No modifica el modelo ni recorta registros. Los vectores incompletos no se predicen. Los números y porcentajes del mapa son conteos de predicciones y proporciones, no exactitud ni confianza.

La galería muestra los PNG reales de Python, permite ampliarlos y descargar sus artefactos. El progreso distingue archivos terminados y mapas generados. Una tabla muestra total de filas, paquetes únicos/esperados, recepción, vectores completos y su porcentaje, incompletos, secuencias ausentes y duplicados. Permite descargar el resumen general en CSV y JSON. Un jugador sin vectores completos conserva sus descargas y no impide procesar los demás. Al volver se recupera un trabajo en curso; uno terminado deja paso a un formulario nuevo. La cuadrícula se recupera automáticamente del modelo o CSV. Para un modelo sin geometría, puede definirse desde el formulario; si no se indica, se mantiene el preset 3×3. Las etiquetas fuera de la geometría elegida y las geometrías incompatibles se rechazan. El módulo no entrena modelos.

## Estado del navegador y alcance de la cuadrícula

La navegación de módulos se registra en el historial del navegador; la API se consulta periódicamente por HTTP, sin WebSockets. El estado del servidor se consulta cada segundo, Datasets cada dos segundos y los trabajos de entrenamiento, separación de jugadores y mapas cada 1,5 segundos mientras están pendientes. El navegador conserva sólo el identificador de un trabajo en curso. Los nombres y resultados cerrados no se restauran al volver a un módulo; las rutas de archivos y carpetas elegidas siguen recordándose en el backend.

El intercambio visual de zonas no cambia el recorrido numérico. Las capturas guiadas nuevas envían filas, columnas y el orden visual de las zonas; Python conserva esa geometría en el CSV, la preparación y el modelo. El mapa de predicción usa ese mismo acomodo. Por ejemplo, cambiar de 3×3 a 3×4 sólo requiere cambiar columnas en el frontend antes de capturar; no se modifica código.

Pulsar Grabar mantiene la vista actual y muestra un spinner en el botón deshabilitado mientras se prepara Python y el Gateway confirma limpieza y apertura. Sólo después de publicar `grabando` cambia la vista y corre el cronómetro. No se muestra una pantalla ni texto de espera del Gateway. Entre zonas se desactiva y limpia el Gateway; jugador y torres continúan transmitiendo. Revise [el protocolo de campo](../docs/prueba_campo_captura.md). Los mapas muestran proporciones de vectores predichos; no calculan segundos de permanencia ni precisión experimental.

El estado de inicio se conserva en `localStorage` junto a la solicitud: recargar mientras está pendiente recupera el mismo proceso y spinner, sin crear otro CSV. Si el Gateway no confirma en 10 s, la vista abierta recupera el formulario o la zona pendiente con un error para reintentar. Un fallo anterior al inicio no marca la zona como completada. Al salir y volver después del fallo se abre un formulario nuevo.

La recepción se calcula como lecturas únicas / (4 × secuencias esperadas). El porcentaje de vectores completos usa las secuencias esperadas, no sólo las observadas. Cada sesión aporta `máxima secuencia − mínima secuencia + 1`: no se infieren pérdidas antes ni después de su rango observado. Los duplicados no aumentan porcentajes. Para CSV preparados se conservan sus filas disponibles; los paquetes y porcentajes que no pueden reconstruirse aparecen como no disponibles.

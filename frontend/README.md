# Panel ESP32 — frontend

Interfaz en React y TypeScript basada en `references/Main Menu`, conectada al backend local de recolección. El backend y Python corren en esta misma PC; los archivos se guardan aquí.

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

- Manual: nombre y duración; crea un CSV con fecha y hora reales de inicio y permite detenerlo anticipadamente.
- Guiado: filas × columnas configurables (3×3 inicial, hasta 20 por lado), un CSV por zona, confirmación entre zonas y salto sin crear archivo.
- Las zonas se pueden intercambiar mediante arrastre o Espacio y flechas. El recorrido conserva su orden numérico.
- Recargar recupera el recorrido y consulta la solicitud existente al backend. Cerrar la pestaña no detiene la captura actual ni inicia zonas siguientes.
- Datasets: resultados completos o parciales y descarga de CSV cerrados.
- Gateway: parámetros de referencia de solo lectura y recepción basada en datos reales.

El estado del recorrido se guarda en `localStorage`. Los resultados y archivos permanecen en el disco del PC y pueden consultarse en Datasets aunque se borre el almacenamiento del navegador.

## Preparación de datos

La card «Preparación de Datos» y la navegación «Preparación» abren la vista basada en la referencia Stitch de `references/Preparado de datos/`. Permite seleccionar varios CSV o arrastrarlos, revisar sus tarjetas, eliminar archivos y recorrer la lista con scroll interno. La zona se sugiere a partir del nombre y es editable antes de procesar. No se solicita ni se deduce un dataset del nombre del archivo; basta con asignar la zona. Se conserva el nombre del archivo como procedencia. Acepta hasta 200 archivos y 28 MB por selección.

«Preparar datos y unificar CSV» envía la selección al backend y ejecuta el agrupado Python real. No recorta filas iniciales, no aplica filtros Kalman/IQR ni normaliza para entrenamiento. Conserva los vectores incompletos marcados y muestra conteos reales. El resultado y el resumen se descargan desde la pantalla; se guardan en la carpeta elegida con «Explorar» o escrita en el campo de ruta. Sin una ruta elegida se utiliza `data/processed/preparaciones/<id>/`. El botón «Explorar» abre el selector nativo de carpetas del sistema operativo (Zenity en Linux, diálogo de Windows o Finder en macOS); cancelar conserva la ruta anterior. Si el nombre existe, añade un sufijo numérico sin sobrescribir. Los originales seleccionados no se modifican. Preparar no ejecuta un entrenamiento.

La preparación admite zonas enteras positivas y cualquier cantidad de archivos; el entrenamiento y los mapas actuales todavía conservan su configuración de nueve zonas.

## Entrenamiento de modelos

La card y navegación «Entrenamiento» permiten seleccionar un CSV etiquetado del disco de esta PC con el selector nativo, o escribir la ruta y pulsar «Revisar CSV». Muestra los vectores completos/incompletos y su distribución por zona. Sólo los completos entran al modelo. No exige nombres de dataset, cobertura de todas las zonas ni nuevos recortes.

KNN permite configurar K, pesos, distancia euclidiana/Manhattan y normalización StandardScaler. Random Forest permite configurar árboles, profundidad máxima (vacío = sin límite), muestras mínimas para dividir y por hoja, y semilla. La salida tiene nombre y carpeta elegibles con selector nativo; por defecto se exporta a `models/`. Si existe, se añade un número sin sobrescribir.

El proceso Python continúa al cambiar de módulo o recargar la página. Se consulta su estado real y se puede descargar el `.joblib` y el resumen JSON. No se muestra una precisión de entrenamiento como evaluación: la prueba del modelo corresponde a una fase posterior con archivos elegidos por el usuario.

## Mapas de calor

La card «Mapas de Calor» y la navegación «Mapas» permiten seleccionar uno o varios CSV y un modelo `.joblib` mediante el selector nativo del sistema. También se pueden introducir rutas locales. Acepta capturas RSSI crudas y vectores preparados, sin requerir etiquetas de zona para predecir. Cada CSV produce su propio PNG, predicciones CSV y resumen JSON. El nombre y la carpeta de salida son configurables con el mismo selector nativo de carpetas; si hay varios archivos, se añaden número y nombre de origen. No sobrescribe resultados existentes.

La ventana de suavizado es configurable entre 1 y 1000 predicciones: 1 lo desactiva; 5 aplica mayoría causal de las últimas cinco. Se procesa por archivo, jugador y sesión, sin mezclar historiales. No modifica el modelo ni recorta registros. Los vectores incompletos no se predicen. Los números y porcentajes del mapa son conteos de predicciones y proporciones, no exactitud ni confianza.

La galería muestra los PNG reales de Python, permite ampliarlos y descargar sus artefactos. El progreso es el número real de archivos terminados. Se recupera el último trabajo al recargar. La cuadrícula actual sigue siendo 3 × 3 con zonas 1 a 9; si el modelo predice otra etiqueta, devuelve un error explícito. El módulo no entrena modelos.

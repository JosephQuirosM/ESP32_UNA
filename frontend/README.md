# Panel ESP32 — frontend

Interfaz en React y TypeScript basada en `references/Main Menu`, conectada al backend local de recolección. El backend y Python corren en esta misma PC; los archivos se guardan aquí.

## Uso completo

Desde la raíz del proyecto:

```bash
npm run instalar
npm run build
npm start
```

Abra `http://localhost:8000`. Consulte `../backend/README.md` para configuración, API y detalles de la captura.

## Desarrollo de la interfaz

Con el backend iniciado en 8000:

```bash
npm run dev --prefix frontend
```

Vite redirige las peticiones `/api` al backend de esta PC. `npm run build --prefix frontend` comprueba TypeScript y genera `dist/`, que el backend sirve junto con su API. Publicar solamente `dist/` en un servidor estático no proporciona la recolección Python.

## Flujos

- Manual: nombre y duración; crea un CSV con fecha y hora reales de inicio y permite detenerlo anticipadamente.
- Guiado: filas × columnas configurables (3×3 inicial, hasta 20 por lado), un CSV por zona, confirmación entre zonas y salto sin crear archivo.
- Las zonas se pueden intercambiar mediante arrastre o Espacio y flechas. El recorrido conserva su orden numérico.
- Recargar recupera el recorrido y consulta la solicitud existente al backend. Cerrar la pestaña no detiene la captura actual ni inicia zonas siguientes.
- Datasets: resultados completos o parciales y descarga de CSV cerrados.
- Gateway: parámetros de referencia de solo lectura y recepción basada en datos reales.

El estado del recorrido se guarda en `localStorage`. Los resultados y archivos permanecen en el disco del PC y pueden consultarse en Datasets aunque se borre el almacenamiento del navegador.

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

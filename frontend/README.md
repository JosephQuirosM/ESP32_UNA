# Panel ESP32 — frontend

Interfaz en React y TypeScript basada en `references/Main Menu`. Solo usa estado local: no tiene backend, no ejecuta Python, no recibe telemetría y no genera CSV. Los temporizadores son demostraciones visuales.

## Desarrollo

Requiere Node.js 20.19+ o 22.12+ y npm.

```bash
cd frontend
npm install
npm run dev
```

Abra la URL indicada por Vite. El servidor de desarrollo escucha en la red local para poder revisar la interfaz desde otro dispositivo.

## Comprobación y publicación estática

```bash
npm run build
npm run preview
```

`build` verifica TypeScript y genera `dist/`, que puede servirse mediante cualquier servidor de archivos estáticos. `preview` permite revisar esa compilación localmente; no es un servidor de producción.

## Flujos

- Inicio: menú de Stitch, módulos futuros deshabilitados y estados «Sin conectar».
- Manual: nombre y duración en segundos; temporizador y botón Detener.
- Guiado: filas × columnas configurables (3×3 por defecto, de 1 a 20 por lado), confirmación antes de cada zona y progreso local. Arrastrar una zona sobre otra intercambia sus posiciones; también se puede usar Espacio y las flechas del teclado. El recorrido sigue el orden numérico y la disposición no altera la identidad de cada zona.
- Datasets: estado vacío, sin descargas ficticias.
- Gateway: parámetros de referencia de solo lectura.
- Ayuda: instrucciones para una integración posterior.

La navegación conserva la demostración mientras la página esté abierta. Al recargar se restablece todo el estado. La geometría y el recorrido serpenteante están separados en `src/cuadricula.ts`; la disposición inicial es serpenteante y se regenera al cambiar las dimensiones. El acomodo visual se conserva al iniciar la demostración y al navegar entre pantallas; recargar restablece la configuración.

Los iconos SVG se incluyen con la aplicación. No utiliza fuentes, imágenes ni servicios alojados externamente.

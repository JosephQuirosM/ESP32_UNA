# Contexto del checkpoint

## Propósito

Construir un MVP que estime de forma aproximada la permanencia de un jugador dentro de una cuadrícula RSSI 3×3 y permita generar un mapa de calor. No se busca posicionamiento GPS ni distancia física exacta.

## Arquitectura conservada

```text
Jugador -- beacon ESP-NOW broadcast --> Torres (x4)
                                           |
                              registro ESP-NOW unicast escalonado
                                           v
PC -- anuncio UDP --> Gateway -- HTTP POST --> receptor Python / CSV
```

## Rutas principales

| Ruta | Responsabilidad |
|---|---|
| `firmware/Comun/Paquete.h` | Contrato de paquetes ESP-NOW v3. |
| `firmware/Jugador` | Beacon periódico del jugador. |
| `firmware/Torre` | Medición RSSI y envío de registros al Gateway. |
| `firmware/Gateway` | Hotspot, registro de MAC, IDs dinámicos y entrega HTTP. |
| `python/receptor_gateway.py` | Receptor HTTP y escritor CSV v3. |
| `python/analizar_captura.py` | Informe de integridad de una captura. |
| `python/preprocesar_calibracion.py` | Agrupación RSSI y etiquetado de zonas. |
| `python/entrenar_knn.py` | Entrenamiento y evaluación KNN por sesión. |
| `python/reproducir_mapa_calor.py` | Reproducción offline de predicciones 3×3. |
| `docs/mapa_torres_fisicas.md` | Fuente de verdad MAC→posición física. |

## Próxima campaña de datos

1. Reconstruir la zona de 6 m × 2,5 m y la cuadrícula 3×3.
2. Fijar las cuatro torres y confirmar la tabla MAC→posición.
3. Iniciar Gateway, PC/receptor, torres y jugador; guardar un CSV nuevo por sesión.
4. Capturar la nueva calibración siguiendo un protocolo definido antes de empezar.
5. Validar integridad de CSV antes de entrenar.
6. Entrenar el KNN únicamente con el nuevo dataset y guardar sus artefactos con un nombre nuevo.

## Regla de continuidad

No existen datasets, modelos ni resultados de pruebas anteriores en este checkpoint. No se deben reconstruir conclusiones históricas a partir de archivos eliminados. Cada nueva captura debe documentar su geometría, recorrido, duración, orientación y sesiones.

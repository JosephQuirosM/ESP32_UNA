# Informe de captura RSSI v3 — captura_v3_1

## Archivos analizados

- CSV: `data/raw/captura_v3_1.csv`
- Log Gateway: `data/logs/captura v3 1/gateway`
- Log de torre disponible: `data/logs/captura v3 1/una_torre_random`
- No se recibieron logs completos de las otras tres torres.

## Resultado principal

La captura contiene una sesión de Gateway, una sesión de jugador y cuatro sesiones de torre. Duró aproximadamente 10 minutos y 12 segundos, desde `2026-09-06T07:21:08.927Z` hasta `2026-09-06T07:31:21.296Z`.

| Métrica | Resultado |
|---|---:|
| Secuencias de jugador observadas | 1.115 |
| Registros recibidos | 4.459 |
| Registros esperados (1.115 × 4) | 4.460 |
| Pérdida individual aproximada | 0,02 % |
| Vectores completos de 4 torres | 1.114 / 1.115 = 99,91 % |
| Vectores con 3 o más torres | 1.115 / 1.115 = 100,00 % |
| Duplicados | 0 |
| `jugador_id=0` | 0 |

## Cobertura por torre

| Torre | Registros | Cobertura |
|---|---:|---:|
| 1 | 1.115 | 100,00 % |
| 2 | 1.114 | 99,91 % |
| 3 | 1.115 | 100,00 % |
| 4 | 1.115 | 100,00 % |

El único vector incompleto tiene tres torres. El CSV no presenta huecos de `secuencia_torre_tx` en las torres 1, 3 y 4; la Torre 2 presenta un hueco interno y queda en 99,91 % de cobertura Torre→Gateway. No hubo duplicados de secuencia de torre.

## RSSI

| Torre | Mínimo | Máximo | Promedio |
|---|---:|---:|---:|
| 1 | -59 dBm | -54 dBm | -56,13 dBm |
| 2 | -67 dBm | -59 dBm | -64,17 dBm |
| 3 | -34 dBm | -30 dBm | -32,02 dBm |
| 4 | -55 dBm | -51 dBm | -52,83 dBm |

El RSSI fue muy estable, como era esperable en el espacio reducido. La Torre 3 fue la más dominante; la Torre 2 fue la más débil, pero aun así alcanzó 99,91 % de cobertura.

## Gateway

Último resumen serial disponible:

```text
control=1121 datos=4451 enviados=4451 descartes_control=0 descartes_datos=0 inválidos=0 descartes_entrega=0 fallos_http=3 reintentos=3 latencia_http_media_ms=39 destino_pc=si
```

Los contadores de cola y entrega fueron cero. Hubo 3 fallos HTTP con 3 reintentos, pero el lote pendiente se conservó y el CSV terminó con 4.459 filas. La diferencia entre el último contador serial (`4451`) y el CSV (`4459`) se debe a que el monitor serial es una instantánea periódica y no está sincronizado exactamente con el cierre del receptor; no debe interpretarse como ocho pérdidas.

## Torre con log disponible

La muestra disponible corresponde a la Torre 4:

```text
beacons=1120 encolados=1120 descartes_cola=0 tx_intentos=1120 tx_confirmadas=1118 tx_fallidas=2 fallos_inicio=0 gateway_unicast=si
```

La torre no desbordó su cola. Las dos confirmaciones fallidas representan 0,18 % de sus 1.120 intentos registrados. Como el log continuó fuera del intervalo exacto del CSV, no es posible asignar esas fallas a filas concretas del archivo.

## Interpretación del LED

El verde indica que la torre recibió/asumió su ID y dejó registrado el Gateway como peer unicast. El cian es un pulso de 80 ms cuando `esp_now_send()` acepta localmente el registro; no significa por sí solo que el Gateway ya confirmó el paquete. Observar como máximo dos torres cian simultáneamente es compatible con el diseño escalonado: cada torre transmite en ventanas separadas por ID y el pulso es corto. El CSV demuestra que las cuatro torres sí transmitieron y fueron recibidas.

## Comparación con la línea base v2

| Métrica | v2 | v3 |
|---|---:|---:|
| Vectores completos | 29,47 % | 99,91 % |
| Vectores con ≥3 torres | 79,64 % | 100,00 % |
| Pérdida individual aproximada | 23,1 % | 0,02 % |
| Duplicados | 0 | 0 |

La mejora es suficiente para considerar que la mitigación unicast + jitter + escalonamiento resolvió el problema observado en la prueba estática. Aún falta repetirla en un área abierta y con movimiento antes de calibrar.

## Decisión

La captura cumple los criterios de completitud, cobertura, duplicados y colas. El siguiente paso es una prueba de estabilidad en el espacio real de trabajo, conservando logs completos de las cuatro torres. Si mantiene al menos 95 % de cobertura Torre→Gateway y 70 % de vectores completos durante movimiento, podrá comenzar la preparación de calibración por zonas. KNN todavía no debe entrenarse con esta captura estática.

## Nota de identidad física

Los `torre_id` de este archivo son IDs dinámicos de la sesión y no deben interpretarse como esquinas físicas. Antes de usar estos datos para KNN, cada `mac_torre` debe asociarse a su ubicación mediante `docs/mapa_torres_fisicas.md`.

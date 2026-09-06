# Hallazgos de captura RSSI 2026 09 06

## Propósito de la prueba

Se realizó una prueba estática de aproximadamente diez minutos con un jugador, cuatro torres y un Gateway. Los dispositivos estuvieron en un área menor a un metro cuadrado para separar la estabilidad de señal RSSI de la pérdida de paquetes. Esta prueba no representa la geometría ni las condiciones de la futura calibración al aire libre.

## Evidencia conservada

| Artefacto | Descripción |
|---|---|
| `data/raw/lecturas_mvp 1.csv` | Captura HTTP recibida por Python. |
| `data/processed/informe_captura 1.md` | Informe reproducible generado por `python/analizar_captura.py`. |
| Salida serial compartida en la bitácora de trabajo | Muestra contadores del Gateway, incluida una observación de 216 descartes de datos y 40 ms de latencia HTTP media. No se conservó como archivo de log. |

## Resultados observados

El CSV contiene 3812 filas y dos sesiones de arranque de jugador bajo la misma sesión de Gateway. La primera sesión tiene 95 filas en una fracción de segundo y secuencias 2447 a 2478; se trata como dato residual de una ejecución anterior o como un lote pendiente anterior. La sesión principal tiene 3717 filas, va de las 05:57:08 a las 06:07:12 UTC y contiene las secuencias 1 a 1209.

Para la sesión principal:

| Métrica | Resultado |
|---|---:|
| Secuencias observadas | 1208 |
| Registros esperados con cuatro torres | 4836 |
| Registros recibidos | 3717 |
| Pérdida de observaciones individuales aproximada | 23.1 % |
| Vectores completos con cuatro torres | 356 de 1208, 29.47 % |
| Vectores con tres o cuatro torres | 962 de 1208, 79.64 % |
| Duplicados de sesión jugador secuencia torre | 0 |

| Torre | Lecturas | Cobertura aproximada |
|---|---:|---:|
| 1 | 1132 | 93.63 % |
| 2 | 749 | 61.95 % |
| 3 | 978 | 80.89 % |
| 4 | 858 | 70.97 % |

El RSSI de las filas recibidas fue estable: rango de -58 a -38 dBm y promedio aproximado de -48 dBm. Esto indica que la cercanía redujo la variación de señal, pero no elevó la completitud de vectores a un nivel aceptable.

## Hechos y límites de la interpretación

- La asignación dinámica de IDs funcionó: jugador ID 1 y cuatro torres con IDs distintos.
- Gateway, descubrimiento de PC, HTTP y receptor CSV funcionaron. La salida serial compartida mostró respuestas HTTP exitosas y una latencia media de 40 ms.
- La prueba evidencia pérdidas importantes, pero el CSV actual no permite localizar cada pérdida con certeza en el enlace Jugador a Torre, Torre a Gateway o en la cola local de una torre.
- El Gateway ya separa control y telemetría y posee una cola de 96 registros. Los 216 descartes observados pueden corresponder al intervalo antes de que la PC fuese descubierta; no deben atribuirse automáticamente a colisiones de radio.
- Las torres retransmiten actualmente por ESP-NOW broadcast de inmediato después de recibir el mismo beacon. Esto es un riesgo técnico alto de transmisiones sincronizadas; es una hipótesis de causa prioritaria, no una prueba concluyente de la causa de todas las pérdidas.
- HTTP no aparece como cuello de botella en esta prueba. No se cambiará el transporte Gateway a PC antes de corregir y medir el enlace Torre a Gateway.

## Decisión técnica

No iniciar calibración, KNN ni heatmap. El siguiente trabajo es la Codificación 3: instrumentación de enlaces y retransmisión unicast de Torre a Gateway con escalonamiento no bloqueante.

La versión siguiente debe:

1. Incrementar `VERSION_PROTOCOLO` y añadir `secuencia_torre_tx` a cada registro de torre.
2. Registrar en cada torre beacons recibidos, registros encolados, descartes de cola, intentos de transmisión, entregas confirmadas y fallos de envío.
3. Capturar la MAC del Gateway desde la asignación de ID, crear un peer ESP-NOW unicast y enviar los registros de torre a esa MAC.
4. Programar el envío fuera del callback con un retardo no bloqueante dependiente de `id_torre` y un pequeño jitter aleatorio.
5. Añadir jitter al beacon del jugador para preparar el sistema para varios jugadores.
6. Llevar las nuevas métricas al JSON, CSV y analizador Python.

## Criterios para continuar a calibración

En una nueva captura estática de diez minutos, con la PC y el receptor listos antes de encender jugador y torres:

- Vectores con tres o más torres: al menos 90 %.
- Vectores completos con cuatro torres: al menos 70 %.
- Entrega Torre a Gateway por torre: al menos 95 %.
- Descartes de cola del Gateway después de `destino_pc=si`: cero.
- Descartes de entrega HTTP: cero.
- Duplicados: medidos y deduplicables por sesión, jugador, secuencia y torre.

## Regla operativa para próximas capturas

Cada prueba debe usar un nombre de archivo nuevo, por ejemplo `data/raw/captura_YYYY-MM-DD_HHMM.csv`, y debe conservar los logs seriales de Gateway y de cada torre. No reutilizar un CSV por anexado, porque mezcla sesiones y dificulta el análisis.

## Estado de la mitigación v3

La Codificación 3 fue implementada después de esta línea base. El protocolo vigente pasó a v3 y añade `sesion_torre` y `secuencia_torre_tx`. La telemetría de las torres usa unicast al Gateway con escalonamiento no bloqueante; cada torre publica métricas propias y el jugador añade jitter a sus beacons. El receptor y el analizador ya entienden los nuevos campos.

Los tres firmwares compilaron con Arduino-ESP32 3.3.11 y las siete pruebas Python pasaron. Esto verifica construcción y contrato de software, no demuestra todavía una reducción física de pérdidas. La próxima evidencia requerida es una segunda prueba estática de diez minutos con CSV v3 y cinco logs seriales. Este documento conserva los resultados v2 como línea base y no debe sobrescribirse con los resultados nuevos.

## Captura v3_1 posterior

La primera repetición con protocolo v3 se conserva en `data/raw/captura_v3_1.csv` y se resume en `data/processed/informe_captura_v3_1.md`. Alcanzó 99,91 % de vectores completos, 100 % de vectores con tres o más torres, cero duplicados y cero descartes de cola/entrega reportados por el Gateway. Esta evidencia respalda la mitigación unicast + jitter + escalonamiento, pero corresponde todavía a una condición estática y con las placas muy próximas; el siguiente control debe realizarse en el área real con movimiento.

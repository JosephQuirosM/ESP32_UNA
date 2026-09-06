# Prueba de campo de captura RSSI

## Objetivo

Validar durante diez minutos que un jugador y cuatro torres producen un CSV v3 completo y que las métricas permiten localizar las pérdidas antes de iniciar la calibración por zonas.

## Preparación

1. Cargue `Jugador.ino` en una placa, `Torre.ino` en cuatro placas y `Gateway.ino` en una sexta placa.
2. Confirme que todos los `config.h` usan el mismo canal, actualmente 6, y sustituya la clave por defecto del hotspot antes de una prueba fuera del laboratorio.
3. Abra los monitores seriales a 115200 baud. Guarde el del Gateway y los de las cuatro torres con nombres nuevos dentro de `data/raw/`, por ejemplo `gateway_YYYY-MM-DD_HHMM.log` y `torre_1_YYYY-MM-DD_HHMM.log`. La numeración del archivo debe corresponder al ID que la torre muestre, no al puerto USB.
4. Conecte la PC a `MapaCalor_MVP` y ejecute el receptor con un CSV nuevo, por ejemplo `python3 python/receptor_gateway.py --archivo data/raw/captura_YYYY-MM-DD_HHMM.csv`.
5. Espere en el Gateway `PC descubierta` o `destino_pc=si` antes de encender torres y jugador. Así se evita llenar la cola de telemetría antes de que exista destino HTTP.
6. Encienda las torres y el jugador. Espere en cada torre `ID torre asignado` y `Gateway ... registrado unicast`, y en el jugador `ID jugador asignado`. Los cuatro IDs de torre deben ser distintos y cada reporte debe terminar en `gateway_unicast=si`.
7. Confirme que el CSV nuevo tiene las columnas `sesion_torre` y `secuencia_torre_tx`. Si no aparecen, hay firmware o receptor v2 mezclado y la prueba debe detenerse.

## Ejecución

1. Para prueba de pérdida, mantenga una configuración estática durante al menos diez minutos. Para calibración futura, sitúe las torres alrededor del área real y siga el protocolo de zonas correspondiente.
2. No reinicie nodos durante la captura. Si ocurre un reinicio, anótelo: `sesion_gateway`, `sesion_torre` y `sesion_jugador` permiten separar el segmento afectado.
3. Observe sin intervenir que cada torre incremente `beacons`, `encolados`, `tx_intentos` y `tx_confirmadas`. Registre cualquier crecimiento de `descartes_cola`, `tx_fallidas` o `fallos_inicio`.
4. Al finalizar, detenga el receptor con `Ctrl+C` y conserve el CSV y los logs seriales.
5. Ejecute, sustituyendo los nombres por los de la nueva prueba:

```bash
python3 python/analizar_captura.py data/raw/captura_YYYY-MM-DD_HHMM.csv \
  --log-gateway data/raw/gateway_YYYY-MM-DD_HHMM.log \
  --log-torre data/raw/torre_1_YYYY-MM-DD_HHMM.log \
  --log-torre data/raw/torre_2_YYYY-MM-DD_HHMM.log \
  --log-torre data/raw/torre_3_YYYY-MM-DD_HHMM.log \
  --log-torre data/raw/torre_4_YYYY-MM-DD_HHMM.log \
  --salida data/processed/informe_YYYY-MM-DD_HHMM.md
```

## Criterios de aceptación

- Los tres firmwares compilan y las cuatro torres reciben IDs distintos.
- El CSV contiene registros de las cuatro torres y no contiene `jugador_id=0`.
- El informe presenta las secuencias completas, las tres clases de sesión, los duplicados y el diagnóstico Torre a Gateway.
- Vectores con tres o más torres: al menos 90 %; vectores con cuatro torres: al menos 70 %.
- Cobertura interna de `secuencia_torre_tx` por cada sesión de torre: al menos 95 %.
- Cada torre informa `descartes_cola=0`; la tasa `tx_confirmadas / tx_intentos` es al menos 95 % y `fallos_inicio=0` al terminar.
- El serial del Gateway no informa incrementos de descartes de cola ni descartes de entrega después de `destino_pc=si`.
- La latencia HTTP promedio indicada por Gateway es consistente con el límite configurado de 400 ms.

No etiquete zonas ni entrene KNN hasta cumplir estos criterios.

Antes de comenzar calibración, identifique y documente la posición física de cada MAC en [mapa_torres_fisicas.md](mapa_torres_fisicas.md). Los IDs mostrados por las torres pueden cambiar después de reiniciar el Gateway y no deben usarse como coordenadas.

## Interpretación de los contadores

- Huecos de secuencia de jugador para una torre, sin huecos de `secuencia_torre_tx`: pérdida probable en Jugador a Torre.
- Huecos de `secuencia_torre_tx`, `tx_confirmadas` altas y sin descartes locales: pérdida probable después de la torre, entre radio, Gateway y cola.
- `tx_fallidas` creciente: fallo confirmado por ESP-NOW en Torre a Gateway.
- `descartes_cola` en una torre: el procesamiento local no alcanzó a drenar beacons.
- `descartes_datos` en Gateway: la cola de telemetría se llenó antes de que HTTP pudiera drenarla.

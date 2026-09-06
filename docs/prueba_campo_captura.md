# Prueba de campo de captura RSSI

## Objetivo

Validar durante diez minutos que un jugador y cuatro torres producen un CSV v2 completo, estable y utilizable antes de iniciar la calibración por zonas.

## Preparación

1. Cargue `Jugador.ino` en una placa, `Torre.ino` en cuatro placas y `Gateway.ino` en una sexta placa.
2. Confirme que todos los `config.h` usan el mismo canal, actualmente 6, y sustituya la clave por defecto del hotspot antes de una prueba fuera del laboratorio.
3. Abra los monitores seriales a 115200 baud. Guarde el del Gateway como `data/raw/gateway_serial.log`.
4. Conecte la PC a `MapaCalor_MVP` y ejecute `python3 python/receptor_gateway.py --archivo data/raw/lecturas_mvp.csv`.
5. Espere en cada torre el mensaje `ID torre asignado` y en el jugador `ID jugador asignado`. Los cuatro IDs de torre deben ser distintos.

## Ejecución

1. Sitúe las torres alrededor del área de prueba y mantenga el jugador en movimiento durante al menos diez minutos.
2. No reinicie nodos durante la captura. Si ocurre un reinicio, anótelo: las columnas de sesión permitirán separar el segmento afectado.
3. Al finalizar, detenga el receptor con `Ctrl+C` y conserve el CSV y el log serial.
4. Ejecute:

```bash
python3 python/analizar_captura.py data/raw/lecturas_mvp.csv \
  --log-gateway data/raw/gateway_serial.log \
  --salida data/processed/informe_captura.md
```

## Criterios de aceptación

- Los tres firmwares compilan y las cuatro torres reciben IDs distintos.
- El CSV contiene registros de las cuatro torres y no contiene `jugador_id=0`.
- El informe presenta las secuencias completas y los duplicados.
- El serial del Gateway no informa descartes de cola ni descartes de entrega durante una prueba normal de un jugador.
- La latencia HTTP promedio indicada por Gateway es consistente con el límite configurado de 400 ms.

No etiquete zonas ni entrene KNN hasta cumplir estos criterios.

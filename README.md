# MVP: mapa de calor RSSI con ESP32

Este repositorio implementa la primera captura de datos del mapa de calor: 1 jugador, 4 torres ESP32 y 1 Gateway. El resultado de esta codificación es un CSV de lecturas RSSI versionado; la calibración, clasificación y heatmap quedan para una fase posterior.

## Arquitectura

```text
Jugador -- beacon ESP-NOW broadcast --> Torres (x4)
                                           |
                              registro ESP-NOW unicast escalonado
                                           v
PC -- anuncio UDP --> Gateway -- HTTP POST --> PC/receptor CSV
```

El Gateway levanta la red `MapaCalor_MVP` en canal 6. La PC se conecta a ella, anuncia cada tres segundos el puerto del receptor HTTP y recibe lotes JSON v3 en `/v1/registros`. El protocolo ESP-NOW también es v3; los seis dispositivos deben tener esta misma versión cargada.

> Estado de captura: la primera prueba física v2 obtuvo 29.47 % de vectores RSSI completos. La captura estática v3_1 alcanzó 99.91 % y ya validó la mitigación en laboratorio; falta probar movimiento y el área real antes de calibrar. Consulte [el informe v3_1](data/processed/informe_captura_v3_1.md).

## Requisitos

- Seis ESP32 IdeaBoard: 1 jugador, 4 torres y 1 Gateway.
- Arduino IDE con el paquete **esp32 by Espressif Systems 3.x**.
- Python 3.10 o superior; el receptor no requiere paquetes externos.

> El RSSI se toma de `esp_now_recv_info_t::rx_ctrl` y por ello requiere Arduino-ESP32 3.x / ESP-IDF 5.1 o posterior.

## Carga de firmware

1. Abra `firmware/Jugador/Jugador.ino` en Arduino IDE y cárguelo en la placa del jugador.
2. Abra `firmware/Torre/Torre.ino` y cárguelo en cada una de las cuatro torres.
3. Abra `firmware/Gateway/Gateway.ino` y cárguelo en la placa Gateway.
4. Revise los `config.h` antes de cargar: especialmente nombre/clave del hotspot y canal. Todas las placas deben compartir el mismo canal.

No es necesario cambiar el ID al cargar cada jugador o torre. Con `ID_JUGADOR_RESPALDO=0` e `ID_TORRE_RESPALDO=0`, el Gateway asigna los IDs dinámicamente según la MAC durante cada arranque. Los cuatro GPIO del driver de motores integrado se fuerzan a nivel bajo al iniciar para evitar activaciones accidentales.

Importante para el futuro KNN: el `torre_id` dinámico sirve para la comunicación, no para representar una posición física. La conversión a columnas del modelo debe hacerse por MAC usando [el mapa de torres físicas](docs/mapa_torres_fisicas.md).

Las rutas relativas a `../Comun` son intencionales: `Paquete.h`, `RadioComun.h` y `LedEstado.h` se comparten entre los tres sketches. No mueva cada `.ino` fuera de su carpeta.

## Receptor Python

Conecte la PC al Wi-Fi creado por el Gateway y ejecute con un archivo nuevo por prueba:

```bash
python3 python/receptor_gateway.py --archivo data/raw/captura_YYYY-MM-DD_HHMM.csv
```

El receptor escucha HTTP en el puerto 8080 y anuncia UDP a `192.168.4.255:4210`. Para detenerlo, use `Ctrl+C`; el servidor, el hilo de anuncios y el CSV se cierran de forma ordenada. El CSV v3 conserva las sesiones de Gateway, torre y jugador; las secuencias del jugador y de transmisión de torre; tiempo local de torre, tiempo de recepción en Gateway y hora UTC de la PC. No anexe una captura v3 a un CSV v2.

Ejecute las pruebas locales con:

```bash
python3 -m unittest discover -s tests -v
```

Después de una captura real, genere el informe de integridad con:

```bash
python3 python/analizar_captura.py data/raw/captura_YYYY-MM-DD_HHMM.csv \
  --log-gateway data/raw/gateway_YYYY-MM-DD_HHMM.log \
  --log-torre data/raw/torre_1_YYYY-MM-DD_HHMM.log \
  --log-torre data/raw/torre_2_YYYY-MM-DD_HHMM.log \
  --log-torre data/raw/torre_3_YYYY-MM-DD_HHMM.log \
  --log-torre data/raw/torre_4_YYYY-MM-DD_HHMM.log \
  --salida data/processed/informe_YYYY-MM-DD_HHMM.md
```

Consulte [docs/prueba_campo_captura.md](docs/prueba_campo_captura.md) antes de realizar la prueba de diez minutos.

## Diagnóstico rápido

- Si las torres no reciben, confirme que el Gateway usa canal 6 y que jugador/torres no se conectaron a otra red Wi-Fi.
- Si el Gateway muestra `destino_pc=no`, conecte la PC a `MapaCalor_MVP` y ejecute el receptor.
- Si aparece `HTTP no entregó lote`, revise que el firewall de la PC permita conexiones al puerto 8080 desde la red del Gateway.
- Los IDs se reservan por MAC mientras el Gateway está encendido; reiniciarlo reinicia esa reserva. Cada torre debe mostrar un ID distinto por serial.
- Cada torre debe mostrar `gateway_unicast=si`. `tx_fallidas` o `descartes_cola` crecientes identifican un problema anterior a HTTP.
- Inicie primero Gateway, PC y receptor; espere `PC descubierta` antes de encender torres y jugador. La primera captura perdió registros al acumular telemetría antes de tener destino HTTP.
- No reutilice un CSV entre pruebas: el receptor anexa filas y puede mezclar sesiones de jugador.

Consulte [docs/contexto.md](docs/contexto.md) para rutas y flujo detallado.

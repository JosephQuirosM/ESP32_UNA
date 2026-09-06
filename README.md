# MVP: mapa de calor RSSI con ESP32

Este repositorio implementa la primera captura de datos del mapa de calor: 1 jugador, 4 torres ESP32 y 1 Gateway. El resultado de esta codificación es un CSV de lecturas RSSI versionado; la calibración, clasificación y heatmap quedan para una fase posterior.

## Arquitectura

```text
Jugador -- beacon ESP-NOW --> Torres (x4) -- registro ESP-NOW --> Gateway
                                                                  |
PC <- anuncio UDP / HTTP POST <----------------------------------+
```

El Gateway levanta la red `MapaCalor_MVP` en canal 6. La PC se conecta a ella, anuncia cada tres segundos el puerto del receptor HTTP y recibe lotes JSON v2 en `/v1/registros`.

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

Las rutas relativas a `../Comun` son intencionales: `Paquete.h`, `RadioComun.h` y `LedEstado.h` se comparten entre los tres sketches. No mueva cada `.ino` fuera de su carpeta.

## Receptor Python

Conecte la PC al Wi-Fi creado por el Gateway y ejecute:

```bash
python3 python/receptor_gateway.py --archivo data/raw/lecturas_mvp.csv
```

El receptor escucha HTTP en el puerto 8080 y anuncia UDP a `192.168.4.255:4210`. Para detenerlo, use `Ctrl+C`; el servidor, el hilo de anuncios y el CSV se cierran de forma ordenada. El CSV conserva las sesiones de Gateway y jugador, tiempo local de torre, tiempo de recepción en Gateway y hora UTC de la PC.

Ejecute las pruebas locales con:

```bash
python3 -m unittest discover -s tests -v
```

Después de una captura real, genere el informe de integridad con:

```bash
python3 python/analizar_captura.py data/raw/lecturas_mvp.csv \
  --log-gateway data/raw/gateway_serial.log \
  --salida data/processed/informe_captura.md
```

Consulte [docs/prueba_campo_captura.md](docs/prueba_campo_captura.md) antes de realizar la prueba de diez minutos.

## Diagnóstico rápido

- Si las torres no reciben, confirme que el Gateway usa canal 6 y que jugador/torres no se conectaron a otra red Wi-Fi.
- Si el Gateway muestra `destino_pc=no`, conecte la PC a `MapaCalor_MVP` y ejecute el receptor.
- Si aparece `HTTP no entregó lote`, revise que el firewall de la PC permita conexiones al puerto 8080 desde la red del Gateway.
- Los IDs se reservan por MAC mientras el Gateway está encendido; reiniciarlo reinicia esa reserva. Cada torre debe mostrar un ID distinto por serial.

Consulte [docs/contexto.md](docs/contexto.md) para rutas y flujo detallado.

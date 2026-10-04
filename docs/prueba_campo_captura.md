# Protocolo de la próxima calibración

## Objetivo

Crear un CSV v3 limpio para entrenar el MVP KNN en una cuadrícula de 3×3 dentro de una zona de 6 m × 2,5 m.

## Antes de iniciar

1. Monte la zona y mantenga las cuatro torres inmóviles durante toda la sesión.
2. Verifique la tabla MAC→posición en [mapa_torres_fisicas.md](mapa_torres_fisicas.md).
3. Cargue el mismo firmware v3 en jugador, torres y Gateway.
4. Active el hotspot de la PC en 2.4 GHz y el mismo canal que las ESP32 (6 por defecto). Configure sus credenciales en `firmware/Gateway/config.h` y encienda el Gateway. Para la captura independiente por terminal, detenga el backend y ejecute el receptor, que escuchará los anuncios UDP del Gateway:

```bash
python3 python/receptor_gateway.py --archivo data/raw/calibracion_13-09-26_MUESTRA1_ZONA_1.csv
```

5. Espere a que Gateway descubra la PC y a que jugador y torres reciban un ID distinto de cero.

## Recorrido

- Use las zonas 1 a 9 según el plano de la cuadrícula.
- El pipeline actual espera 60 s por zona y descarta los primeros 6 s de cada una.
- Defina y anote antes de iniciar si habrá rotaciones, su orden y sus tiempos. No cambie el protocolo durante una misma sesión.
- No reinicie nodos durante la captura. Si sucede, termine el archivo y comience una sesión nueva.

## Después de capturar

1. Detenga el receptor con `Ctrl+C`.
2. Analice la integridad del CSV:

```bash
python3 python/analizar_captura.py data/raw/calibracion_6x2_5m_nueva.csv \
  --salida data/processed/informe_calibracion_6x2_5m_nueva.md
```

3. Entrene únicamente si las cuatro torres aparecen durante el recorrido y el informe no revela reinicios o pérdidas que invaliden la sesión.

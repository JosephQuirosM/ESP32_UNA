# Roadmap — Mapa de Calor con ESP32, ESP-NOW, RSSI y Python

> Revisado el 3 de noviembre de 2026. El estado implementado se resume a continuación y se detalla en [docs/arquitectura.md](docs/arquitectura.md). Las metas de interpolación, ocho torres, diez jugadores y visualización en vivo son ampliaciones propuestas. Los apartados de diseño original y sus checklists son planificación histórica, no evidencia de una prueba física ni instrucciones para reemplazar la arquitectura actual.

## 1. Descripción general del proyecto

Este proyecto busca construir un sistema de bajo costo para estimar la permanencia y el movimiento aproximado de jugadores dentro de una zona despejada al aire libre, usando dispositivos ESP32.

Cada jugador llevará un ESP32 móvil que transmitirá periódicamente un identificador. Alrededor del área de juego se colocarán varios ESP32 fijos, denominados **torres**, **anchors** o **nodos receptores**. Estas torres recibirán los paquetes enviados por los jugadores y registrarán la intensidad de señal recibida, conocida como **RSSI**.

La información recolectada será procesada en Python para:

1. Estimar en qué zona o cuadrante se encuentra cada jugador.
2. Generar una posición visual aproximada entre zonas.
3. Suavizar el movimiento del jugador sobre una interfaz gráfica.
4. Acumular el tiempo de permanencia por zona.
5. Generar mapas de calor individuales y globales.

El objetivo no es obtener una posición exacta tipo GPS, sino una **posición aproximada e interpolada** basada en patrones de señal.

## Estado de implementación

| Área | Implementación actual | Pendiente / alcance futuro |
|---|---|---|
| Radio | Un jugador, cuatro torres, Gateway, paquetes v3; beacons/control broadcast y lecturas unicast escalonadas. | Validación física de pérdida y latencia por campaña; escalamiento a más nodos. |
| Red y captura | Hotspot de la PC, Gateway estación DHCP; anuncio UDP, control V3 con revisión/UUID y ACK, limpieza por captura y lotes HTTP aislados a Python/CSV v3. | Mediciones de entrega en campo y límites de latencia de las torres. |
| Aplicación local | React/Vite, API Express/TypeScript y procesos Python. Captura manual/guiada, recuperación y descargas. | Mejoras de formularios y experiencia registradas como trabajo posterior. |
| Preparación | Zona por archivo, agrupación por sesiones/secuencia, columnas por MAC, duplicados e incompletos. Sin recortes temporales automáticos. | Mantener tabla física y protocolo experimental de cada campaña. |
| Modelos | KNN y Random Forest web configurables; CLI con opciones de evaluación. | Evaluación experimental documentada con datos elegidos explícitamente. |
| Mapas | Cuadrícula dinámica hasta 20×20 con preset 3×3, geometría conservada en CSV/modelo, predicción sobre archivos, suavizado causal web por sesión/jugador y PNG/CSV/JSON. | Integración temporal, interpolación y visualización de predicciones en vivo. |

El preset es 3×3 y el administrador puede cambiar filas, columnas y acomodo desde el frontend hasta 20×20. La geometría se conserva entre captura, preparación, entrenamiento y mapas. Los clasificadores web/CLI admiten etiquetas positivas; los mapas las validan contra la geometría elegida. El mapa actual cuenta vectores, no segundos de permanencia.

Los artefactos experimentales se excluyen de Git. Esta copia local contiene datasets, modelos y resultados; no se atribuye una precisión vigente sin revisar su procedencia, geometría y evaluación. La ausencia de esos artefactos en un clon no implica que no existan en la PC de trabajo.

---

## 2. Idea central del sistema

El sistema implementado utiliza esta arquitectura:

```text
Jugador -- ESP-NOW broadcast --> 4 torres -- ESP-NOW unicast --> Gateway
PC (hotspot 2.4 GHz) <-- Wi-Fi estación / DHCP -- Gateway
Gateway -- UDP broadcast :4210 --> Express -- UDP unicast --> Gateway
Gateway -- HTTP :8080 /v1/registros --> receptor Python --> CSV v3
Navegador React <-- HTTP /api :8000 --> Express --> procesos Python de análisis
```

Los beacons llevan sesión y secuencia; los registros de torre añaden RSSI y sesión/secuencia de transmisión propias. El Gateway añade su sesión, tiempo de recepción y MAC de torre al JSON HTTP; Python añade el timestamp UTC de la PC al CSV. La MAC determina la columna física del vector de cuatro RSSI. Los IDs son lógicos y dinámicos.

El Gateway ya está presente en el MVP. USB/serial se usa para diagnóstico. La predicción de mapas se realiza sobre archivos; recibir datos durante una captura no implica inferencia ni visualización de posición en vivo.

---

## 3. Alcance del proyecto

### 3.1 MVP

El MVP debe demostrar que el sistema puede estimar la zona de permanencia de un único ESP32 móvil.

Configuración inicial recomendada:

```text
Jugadores: 1
Torres: 4
Área física documentada: 6 m x 2,5 m (verificar por campaña)
Zonas: 3x3 = 9 zonas
Comunicación: ESP-NOW
Procesamiento: Python
Modelos implementados: KNN y Random Forest
Salida: CSV + heatmap 3x3
```

### 3.2 Versión intermedia

La versión intermedia debe permitir mostrar una posición visual aproximada del jugador moviéndose sobre un mapa.

Configuración recomendada:

```text
Jugadores: 1
Torres: 8
Zonas: 9 o 16
Modelo: KNN o Random Forest con probabilidades
Salida: punto interpolado x,y + heatmap
```

### 3.3 Versión final

La versión final debe escalar a varios jugadores.

Configuración esperada:

```text
Jugadores: hasta 10
Torres: 8 a 10
Zonas: 16 o 25
Salida: posición visual por jugador + mapa de calor individual + mapa global
```

---

## 4. Decisiones de diseño

### 4.1 No usar coordenadas exactas al inicio

No se debe intentar calcular una coordenada física exacta usando trilateración por RSSI en las primeras fases.

Razón:

El RSSI no se comporta como una distancia confiable. Puede variar por:

- Orientación del ESP32.
- Cuerpo del jugador.
- Altura del dispositivo.
- Interferencias.
- Reflexiones de señal.
- Variación entre módulos ESP32.
- Nivel de ruido del canal Wi-Fi.

En lugar de convertir RSSI a distancia, se usará un enfoque de **fingerprinting**.

### 4.2 Usar fingerprinting por zonas

El sistema aprende patrones de RSSI asociados a zonas conocidas.

Ejemplo:

```text
RSSI de torres A1, A2, A3, A4  --->  Zona Z5
```

Durante la calibración, se coloca el ESP32 jugador en cada zona y se registran datos. Luego se entrena un modelo que aprende a reconocer patrones de señal.

### 4.3 Usar probabilidades para posición aproximada

En lugar de que el modelo solo diga:

```text
Jugador está en Z5
```

se usarán probabilidades:

```text
Z5: 0.60
Z6: 0.30
Z2: 0.10
```

Luego se calcula una posición aproximada como promedio ponderado de los centros de las zonas.

```text
x = sum(probabilidad_zona * centro_x_zona)
y = sum(probabilidad_zona * centro_y_zona)
```

Esto permite dibujar el jugador entre dos zonas, aunque no se conozca su posición exacta.

### 4.4 Aplicar suavizado temporal

Las predicciones de RSSI pueden variar mucho entre muestras. Para evitar saltos visuales bruscos, se aplicará suavizado exponencial:

```python
x_display = alpha * x_previous + (1 - alpha) * x_new
y_display = alpha * y_previous + (1 - alpha) * y_new
```

Valor inicial recomendado:

```python
alpha = 0.8
```

---

## 5. Nomenclatura del sistema

### 5.1 Jugadores

Cada jugador tendrá un identificador único:

```text
J1, J2, J3, ..., J10
```

Internamente puede representarse como número:

```c
uint8_t player_id;
```

### 5.2 Torres

Cada torre tendrá un identificador único:

```text
A1, A2, A3, ..., A10
```

Internamente puede representarse como número:

```c
uint8_t anchor_id;
```

En la implementación actual, `anchor_id`/`torre_id` es un ID lógico dinámico asignado por el Gateway durante una sesión. No representa permanentemente una posición física. Para calibración y KNN, la identidad física será la MAC asociada a una ubicación documentada en `docs/mapa_torres_fisicas.md`; el vector debe ordenarse por ubicación, no por el ID dinámico observado.

### 5.3 Zonas

Para el MVP se usará una cuadrícula 3x3:

```text
Z1  Z2  Z3
Z4  Z5  Z6
Z7  Z8  Z9
```

Para versiones posteriores:

```text
4x4 = 16 zonas
5x5 = 25 zonas
```

---

## 6. Formato de datos vigente

### 6.1 Contrato ESP-NOW v3

La fuente de verdad es `firmware/Comun/Paquete.h`: estructuras empaquetadas con encabezado de firma, versión y tipo. No se deben usar los esquemas mínimos de prototipos anteriores sin sesiones ni validación.

| Paquete | Campos después del encabezado |
|---|---|
| `ANUNCIO_GATEWAY` | `canal`, `sesion_gateway` |
| `REGISTRO_NODO` | `rol`, `id_preferido`, `mac_nodo` |
| `ASIGNACION_ID` | `rol`, `id_asignado`, `mac_destino` |
| `BEACON_JUGADOR` | `id_jugador`, `sesion_jugador`, `secuencia`, `tiempo_jugador_ms` |
| `REGISTRO_TORRE` | `id_torre`, `sesion_torre`, `secuencia_torre_tx`, `id_jugador`, `sesion_jugador`, `secuencia`, `rssi`, `tiempo_torre_ms` |

El jugador emite cada 500–600 ms. La torre conserva el RSSI del beacon original y envía por unicast al peer aprendido del Gateway. Las sesiones no nulas separan reinicios. La MAC de origen y el instante de recepción del Gateway se añaden fuera del paquete de torre.

### 6.2 Entrega HTTP y CSV v3

El cuerpo HTTP es una lista JSON de 1–8 registros, enviada a `/v1/registros`. El contrato se valida en `python/receptor_gateway.py`. El CSV resultante contiene:

```text
timestamp_utc_pc,sesion_gateway,tiempo_gateway_recepcion_ms,tiempo_torre_ms,torre_id,sesion_torre,secuencia_torre_tx,mac_torre,jugador_id,sesion_jugador,secuencia,rssi
```

El receptor añade `timestamp_utc_pc`; el resto procede del Gateway. HTTP 202 confirma encolado, no persistencia final. Las retransmisiones pueden duplicar filas. Los tiempos de las placas son locales, no sincronizados.

### 6.3 Vectores y etiquetas

Cada archivo se agrupa por `(sesion_gateway, jugador_id, sesion_jugador, secuencia)`. La tabla MAC→posición forma `[rssi_sup_izq, rssi_sup_der, rssi_inf_izq, rssi_inf_der]`; `torre_id` no es una característica del modelo.

Se conserva `archivo_origen`, `dataset` opcional, sesiones, secuencia, `elapsed_s`, `zona`, `faltantes`, `completo` y `cuadricula` (geometría JSON cuando se conoce). Sólo los completos se entrenan y predicen. La zona de calibración se indica por archivo, con la web, `zona_N` en el nombre o `--zona` en CLI; no se deduce por bloques de tiempo. No se eliminan automáticamente segundos iniciales ni filas.

---

## 7. Estructura de repositorio propuesta originalmente

La estructura siguiente se conserva como diseño histórico. Las rutas implementadas son `firmware/`, `backend/src/`, `frontend/src/`, `shared/`, `python/`, `tests/` y `backend/tests/`; véase [docs/contexto.md](docs/contexto.md). No reorganice el código actual para ajustarlo a este esquema.

Codex debe organizar el proyecto con una estructura clara y modular.

```text
heatmap-esp32-rssi/
│
├── firmware/
│   ├── player_node/
│   │   ├── src/
│   │   │   └── main.cpp
│   │   ├── include/
│   │   └── platformio.ini
│   │
│   ├── anchor_node/
│   │   ├── src/
│   │   │   └── main.cpp
│   │   ├── include/
│   │   └── platformio.ini
│   │
│   └── gateway_node/
│       ├── src/
│       │   └── main.cpp
│       ├── include/
│       └── platformio.ini
│
├── data/
│   ├── raw/
│   ├── calibration/
│   ├── processed/
│   └── examples/
│
├── notebooks/
│   ├── 01_explore_rssi.ipynb
│   ├── 02_train_classifier.ipynb
│   └── 03_generate_heatmap.ipynb
│
├── src/
│   ├── config.py
│   ├── data_loader.py
│   ├── preprocessing.py
│   ├── calibration.py
│   ├── model.py
│   ├── interpolation.py
│   ├── smoothing.py
│   ├── heatmap.py
│   ├── visualization.py
│   └── main.py
│
├── tests/
│   ├── test_preprocessing.py
│   ├── test_interpolation.py
│   ├── test_smoothing.py
│   └── test_heatmap.py
│
├── models/
│   └── README.md
│
├── docs/
│   ├── architecture.md
│   ├── calibration_protocol.md
│   └── roadmap.md
│
├── requirements.txt
├── README.md
└── ROADMAP.md
```

---

## 8. Roadmap por fases

Las fases originales describen objetivos de producto y criterios de aceptación experimental. Las fases 2 y 10 se actualizaron con la arquitectura elegida; para las demás, el estado implementado al inicio de este documento prevalece sobre listas históricas. Los tiempos de captura y resultados deben documentarse por campaña.

## Fase 0 — Definición del sistema

### Objetivo

Definir el alcance técnico, la geometría del área, la cantidad de torres, la cantidad de zonas y los criterios de éxito.

### Configuración inicial recomendada

```text
Área física documentada: 6 m x 2,5 m (verificar por campaña)
Torres: 4
Jugadores: 1
Zonas: 3x3
Frecuencia de transmisión: 2 paquetes por segundo
Modelo inicial: KNN
Visualización: Python
```

### Tareas

- [ ] Definir tamaño del área de prueba.
- [ ] Definir posiciones físicas de las torres.
- [ ] Definir cantidad de zonas.
- [ ] Definir el mapa físico MAC→ubicación de las torres.
- [ ] Definir IDs de jugadores.
- [ ] Definir formato de CSV.
- [ ] Definir frecuencia de transmisión inicial.
- [ ] Documentar diagrama de arquitectura.

### Entregables

- `docs/architecture.md`
- `docs/roadmap.md`
- Diagrama de sistema.
- Tabla de coordenadas de torres.
- Tabla de coordenadas de centros de zonas.

### Criterios de aceptación

- Existe un documento con el diseño del sistema.
- Están definidas las coordenadas de cada zona.
- Está definido el formato de datos entre firmware y Python.

---

## Fase 1 — Comunicación básica con ESP-NOW

### Objetivo

Lograr que un ESP32 jugador transmita paquetes ESP-NOW y que una torre ESP32 pueda recibirlos.

### Tareas del firmware del jugador

- [ ] Inicializar Wi-Fi en modo estación.
- [x] Inicializar ESP-NOW.
- [x] Configurar transmisión broadcast o hacia peers conocidos.
- [x] Crear la estructura equivalente de paquete de jugador.
- [x] Incrementar `seq` en cada transmisión.
- [x] Transmitir cada 500 ms inicialmente.
- [x] Agregar jitter aleatorio pequeño para evitar colisiones futuras.

### Tareas del firmware de torre

- [ ] Inicializar Wi-Fi en modo estación.
- [x] Inicializar ESP-NOW.
- [x] Registrar callback de recepción.
- [x] Extraer `player_id` y `seq`.
- [x] Obtener RSSI del paquete recibido.
- [ ] Imprimir por serial:

```text
timestamp,player_id,seq,anchor_id,rssi
```

### Entregables

- `firmware/player_node/`
- `firmware/anchor_node/`
- Lecturas visibles por monitor serial.

### Criterios de aceptación

- Una torre recibe paquetes del jugador.
- La torre muestra `player_id`, `seq` y `rssi` por serial.
- El número `seq` aumenta correctamente.
- No se bloquea el callback de recepción.

---

## Fase 2 — Registro de datos (implementación vigente)

Se eligió un Gateway central desde el MVP. Las torres envían RSSI por ESP-NOW unicast y el Gateway entrega lotes HTTP al receptor Python en la PC. La salida serial se conserva para diagnóstico; no se usa un lector serial ni microSD para producir los CSV.

### Capacidades implementadas

- [x] Receptor HTTP con validación de lotes v3, cola acotada y un escritor CSV.
- [x] Timestamp UTC de la PC, sesiones y secuencias de diagnóstico.
- [x] Captura web por nombre y duración, parada, recuperación e idempotencia.
- [x] Un archivo nuevo por captura y metadatos para Datasets.
- [x] CLI independiente que responde al descubrimiento del Gateway.

### Entregables

- `python/receptor_gateway.py`
- `backend/src/gestor.ts`, `gateway.ts`, `app.ts`
- `frontend/src/Lecturas.tsx`, `Datasets.tsx`
- `tests/test_receptor_gateway.py`, `backend/tests/lecturas.test.ts`

### Verificación y límites

Las pruebas locales ejercitan la recepción HTTP, cierre, persistencia y recuperación. Una campaña debe medir las pérdidas de radio y las colas. El Gateway descarta RSSI fuera de captura y limpia cola/lote antes de confirmar cada inicio. La duración empieza tras el ACK; jugador y torres mantienen sus relojes y pequeñas colas. HTTP 202 admite un lote en memoria y no garantiza persistencia inmediata.

---

## Fase 3 — Calibración por zonas

### Objetivo

Crear un dataset etiquetado que asocie patrones RSSI con zonas conocidas.

### Procedimiento de calibración

Para una cuadrícula 3x3:

```text
Z1  Z2  Z3
Z4  Z5  Z6
Z7  Z8  Z9
```

En cada zona:

1. Colocar el ESP32 jugador en el centro de la zona.
2. Registrar un archivo por zona durante una duración definida en el protocolo (60 segundos es el valor inicial del formulario). No se recortan automáticamente transiciones; considere las colas entre archivos descritas en `docs/prueba_campo_captura.md`.
3. Repetir con distintas orientaciones.
4. Etiquetar todas las muestras con la zona real.

Orientaciones recomendadas:

```text
Norte
Sur
Este
Oeste
```

### Dataset calibrado

Formato esperado:

```csv
zone,player_id,seq,A1,A2,A3,A4
Z1,1,100,-45,-63,-80,-70
Z1,1,101,-47,-65,-78,-72
Z2,1,230,-55,-54,-76,-73
```

### Problema a resolver

Las torres reciben registros separados. Hay que agrupar por `player_id` y `seq` para formar un vector único:

```text
Entrada cruda:
15230,1,89,A1,-50
15231,1,89,A2,-61
15232,1,89,A3,-78
15233,1,89,A4,-72

Vector procesado:
player_id=1, seq=89, A1=-50, A2=-61, A3=-78, A4=-72
```

### Manejo de valores faltantes

Si una torre no recibe un paquete, se debe rellenar el RSSI faltante con un valor bajo, por ejemplo:

```python
MISSING_RSSI = -100
```

### Tareas

- [ ] Crear protocolo de calibración en `docs/calibration_protocol.md`.
- [ ] Crear script para agrupar registros crudos por `player_id` y `seq`.
- [ ] Crear dataset procesado con columnas por ubicación física, usando MAC→ubicación.
- [ ] Agregar columna `zone`.
- [ ] Manejar datos faltantes.
- [ ] Guardar dataset en `data/calibration/`.

### Entregables

- `src/preprocessing.py`
- `src/calibration.py`
- `data/calibration/calibration_dataset.csv`
- `docs/calibration_protocol.md`

### Criterios de aceptación

- Existe un dataset con al menos 9 zonas.
- Cada muestra tiene columnas RSSI por torre.
- El orden de las columnas RSSI es estable aunque cambien los IDs dinámicos del Gateway.
- Los datos faltantes están tratados.
- El dataset puede usarse para entrenar un modelo.

---

## Fase 4 — Modelo de clasificación

### Objetivo

Entrenar un modelo capaz de estimar la zona del jugador a partir del vector RSSI.

### Modelos iniciales

Probar:

1. KNN Classifier.
2. Random Forest Classifier.
3. Decision Tree Classifier.

### Entrada del modelo

```text
A1, A2, A3, A4
```

Para 8 torres:

```text
A1, A2, A3, A4, A5, A6, A7, A8
```

### Salida del modelo

```text
zone
```

Ejemplo:

```text
Z5
```

### Salida probabilística

El modelo debe soportar `predict_proba` para permitir interpolación visual.

Ejemplo:

```text
Z1: 0.02
Z2: 0.10
Z3: 0.01
Z4: 0.05
Z5: 0.55
Z6: 0.25
Z7: 0.01
Z8: 0.01
Z9: 0.00
```

### Métricas

Calcular:

- Accuracy general.
- Accuracy por zona.
- Matriz de confusión.
- Reporte de clasificación.
- Zonas más confundidas.

### Tareas

- [ ] Crear `src/model.py`.
- [ ] Implementar entrenamiento KNN.
- [ ] Implementar entrenamiento Random Forest.
- [ ] Separar train/test.
- [ ] Evaluar métricas.
- [ ] Guardar modelo entrenado en `models/`.
- [ ] Crear notebook exploratorio.

### Entregables

- `src/model.py`
- `notebooks/02_train_classifier.ipynb`
- `models/zone_classifier.pkl`
- Reporte de métricas.

### Criterios de aceptación

- El modelo predice una zona válida.
- El modelo genera probabilidades por zona.
- El accuracy inicial es razonable para el MVP.
- Existe matriz de confusión.

Meta orientativa para MVP:

```text
70% a 85% de acierto por zona en área despejada.
```

---

## Fase 5 — Interpolación de posición aproximada

### Objetivo

Convertir probabilidades de zonas en una posición visual aproximada `(x, y)`.

### Centros de zonas

Para una cuadrícula 3x3 normalizada a 100x100:

```python
ZONE_CENTERS = {
    "Z1": (16.7, 16.7),
    "Z2": (50.0, 16.7),
    "Z3": (83.3, 16.7),
    "Z4": (16.7, 50.0),
    "Z5": (50.0, 50.0),
    "Z6": (83.3, 50.0),
    "Z7": (16.7, 83.3),
    "Z8": (50.0, 83.3),
    "Z9": (83.3, 83.3),
}
```

### Fórmula

```python
x = sum(prob[zone] * ZONE_CENTERS[zone][0] for zone in zones)
y = sum(prob[zone] * ZONE_CENTERS[zone][1] for zone in zones)
```

### Ejemplo

Probabilidades:

```text
Z5: 0.60
Z6: 0.30
Z2: 0.10
```

Centros:

```text
Z5 = (50, 50)
Z6 = (83, 50)
Z2 = (50, 17)
```

Resultado aproximado:

```text
x = 59.9
y = 46.7
```

Esto coloca el punto cerca de Z5, desplazado hacia Z6 y Z2.

### Tareas

- [ ] Crear `src/interpolation.py`.
- [ ] Definir centros de zona.
- [ ] Implementar `probabilities_to_position()`.
- [ ] Validar que probabilidades sumen 1.
- [ ] Crear pruebas unitarias.

### Entregables

- `src/interpolation.py`
- `tests/test_interpolation.py`

### Criterios de aceptación

- La función devuelve `(x, y)`.
- Si una zona tiene probabilidad 1.0, devuelve el centro de esa zona.
- Si dos zonas tienen probabilidades similares, devuelve un punto entre ambas.

---

## Fase 6 — Suavizado temporal

### Objetivo

Evitar saltos bruscos en la visualización.

### Método recomendado

Usar suavizado exponencial:

```python
def smooth_position(previous, current, alpha=0.8):
    if previous is None:
        return current

    x = alpha * previous[0] + (1 - alpha) * current[0]
    y = alpha * previous[1] + (1 - alpha) * current[1]
    return x, y
```

### Tareas

- [ ] Crear `src/smoothing.py`.
- [ ] Implementar suavizado exponencial.
- [ ] Permitir configurar `alpha`.
- [ ] Mantener estado por jugador.
- [ ] Crear pruebas unitarias.

### Entregables

- `src/smoothing.py`
- `tests/test_smoothing.py`

### Criterios de aceptación

- El movimiento se ve más estable.
- Cada jugador mantiene su propia posición anterior.
- El suavizado no bloquea actualizaciones nuevas.

---

## Fase 7 — Mapa de calor

### Objetivo

Acumular tiempo o muestras de permanencia por zona o por coordenada aproximada.

### Opción A — Heatmap por zonas

Se suma una muestra o tiempo a la zona predicha.

Ejemplo:

```python
zone_heatmap["Z5"] += delta_time
```

Salida:

```text
Z1: 10 s
Z2: 22 s
Z3: 5 s
Z4: 8 s
Z5: 40 s
Z6: 31 s
Z7: 2 s
Z8: 7 s
Z9: 16 s
```

### Opción B — Heatmap continuo

Se suma calor en una matriz 2D usando la posición interpolada `(x, y)`.

Ejemplo:

```python
heatmap[y_index, x_index] += 1
```

### Recomendación

Implementar ambas:

1. Heatmap por zonas para análisis.
2. Heatmap continuo para visualización.

### Tareas

- [ ] Crear `src/heatmap.py`.
- [ ] Implementar acumulación por zona.
- [ ] Implementar acumulación por coordenada.
- [ ] Generar matriz para visualización.
- [ ] Exportar heatmap como CSV.
- [ ] Exportar heatmap como imagen.

### Entregables

- `src/heatmap.py`
- `notebooks/03_generate_heatmap.ipynb`
- Imagen de heatmap.
- CSV de permanencia por zona.

### Criterios de aceptación

- Se genera un heatmap 3x3.
- Se genera un heatmap continuo.
- Se puede filtrar por jugador.
- Se puede generar heatmap global.

---

## Fase 8 — Visualización en pantalla

### Objetivo

Mostrar el movimiento aproximado de uno o más jugadores sobre un mapa.

### Versión simple

Usar matplotlib en modo animado o una ventana simple con pygame.

### Elementos visuales

- Área de juego.
- Cuadrícula opcional.
- Torres fijas.
- Punto por jugador.
- ID del jugador.
- Rastro opcional.
- Heatmap opcional.

### Tareas

- [ ] Crear `src/visualization.py`.
- [ ] Dibujar área de juego.
- [ ] Dibujar zonas.
- [ ] Dibujar torres.
- [ ] Dibujar jugadores.
- [ ] Actualizar posición en tiempo real o desde archivo.
- [ ] Permitir reproducir una sesión grabada.

### Entregables

- Visualizador básico en Python.
- Demo con datos simulados.
- Demo con datos reales grabados.

### Criterios de aceptación

- Se ve un punto moverse en el mapa.
- El movimiento usa posición interpolada y suavizada.
- Se puede distinguir cada jugador por ID.

---

## Fase 9 — Escalamiento a varios jugadores

### Objetivo

Soportar hasta 10 jugadores transmitiendo al mismo tiempo.

### Consideraciones

Cada jugador debe tener:

```text
player_id único
seq propio
intervalo de transmisión
jitter aleatorio
```

Frecuencia inicial recomendada:

```text
2 paquetes por segundo por jugador
10 jugadores = 20 paquetes por segundo
```

### Prevención de colisiones

Agregar jitter:

```text
intervalo = 500 ms + random(0, 100 ms)
```

### Tareas

- [ ] Configurar IDs únicos para cada jugador.
- [ ] Agregar jitter al firmware del jugador.
- [ ] Agrupar datos por `player_id` y `seq`.
- [ ] Mantener estado de posición por jugador.
- [ ] Mantener heatmap por jugador.
- [ ] Crear heatmap global.
- [ ] Probar con 2 jugadores.
- [ ] Probar con 5 jugadores.
- [ ] Probar con 10 jugadores.

### Entregables

- Sistema multi-jugador.
- Heatmaps individuales.
- Heatmap global.
- Visualización multi-jugador.

### Criterios de aceptación

- El sistema distingue jugadores por ID.
- Cada jugador tiene su propia posición estimada.
- Cada jugador tiene su propio heatmap.
- El sistema no colapsa con 10 jugadores transmitiendo a frecuencia moderada.

---

## Fase 10 — Gateway y predicción en vivo

### Centralización implementada

El Gateway ESP32 ya centraliza los registros desde el MVP. Usa Wi-Fi como estación del hotspot de la PC y ESP-NOW en el mismo canal. Descubre la PC con anuncios UDP broadcast cada 2 s y recibe una respuesta unicast con su sesión y el puerto HTTP. En web Express posee UDP 4210; Python recibe lotes en HTTP 8080. El CLI independiente asume ambos servicios cuando el backend está detenido.

- [x] Protocolo v3, registro de nodos por MAC y asignación dinámica de IDs.
- [x] Registros unicast escalonados de las torres, colas y contadores.
- [x] Descubrimiento UDP y entrega HTTP por lotes con reintentos.
- [x] Receptor CSV y estado real de captura en la interfaz web.

### Ampliación pendiente

- [ ] Inferencia continua sobre las lecturas entrantes.
- [ ] Visualización de posición y mapa sin seleccionar archivos manualmente.
- [ ] Medición de latencia de extremo a extremo y pérdidas bajo la carga objetivo.
- [x] Control PC–Gateway con limpieza por captura, ACK e identidad HTTP; sin cambios de radio en jugador/torres.

Los mapas actuales son resultados de procesar archivos. El panel actualiza estado y conteos de captura, no posiciones predichas en vivo. La comunicación PC–Gateway no utiliza serial como transporte de datos.

---

## 9. Módulos Python propuestos originalmente

Este desglose modular es una propuesta de diseño, no el árbol actual. Los scripts vigentes y sus responsabilidades se enumeran en [docs/contexto.md](docs/contexto.md). `requirements.txt` define las dependencias instalables; pyserial y pandas no son requisitos del receptor actual.

## 9.1 `config.py`

Debe contener configuración general:

```python
ANCHORS = ["A1", "A2", "A3", "A4"]
ZONES = ["Z1", "Z2", "Z3", "Z4", "Z5", "Z6", "Z7", "Z8", "Z9"]
MISSING_RSSI = -100
SMOOTHING_ALPHA = 0.8
```

## 9.2 `data_loader.py`

Responsabilidades:

- Leer CSV crudo.
- Validar columnas.
- Convertir tipos de datos.
- Unir múltiples archivos.

Funciones esperadas:

```python
def load_raw_csv(path):
    pass


def load_multiple_csv(paths):
    pass
```

## 9.3 `preprocessing.py`

Responsabilidades:

- Agrupar por `player_id` y `seq`.
- Convertir filas crudas en vectores RSSI.
- Rellenar torres faltantes.

Funciones esperadas:

```python
def pivot_rssi_records(df, anchors, missing_rssi=-100):
    pass
```

## 9.4 `model.py`

Responsabilidades:

- Entrenar modelos.
- Evaluar modelos.
- Guardar y cargar modelos.
- Generar probabilidades.

Funciones esperadas:

```python
def train_knn_classifier(X_train, y_train):
    pass


def train_random_forest_classifier(X_train, y_train):
    pass


def predict_zone(model, X):
    pass


def predict_zone_probabilities(model, X):
    pass
```

## 9.5 `interpolation.py`

Responsabilidades:

- Convertir probabilidades de zona a posición `(x, y)`.

Funciones esperadas:

```python
def probabilities_to_position(probabilities, zone_centers):
    pass
```

## 9.6 `smoothing.py`

Responsabilidades:

- Suavizar posiciones.
- Mantener estado por jugador.

Funciones esperadas:

```python
def smooth_position(previous, current, alpha=0.8):
    pass


class PlayerPositionSmoother:
    pass
```

## 9.7 `heatmap.py`

Responsabilidades:

- Acumular calor por zona.
- Acumular calor por coordenada.
- Exportar resultados.

Funciones esperadas:

```python
def update_zone_heatmap(heatmap, zone, delta=1):
    pass


def update_continuous_heatmap(matrix, x, y):
    pass
```

## 9.8 `visualization.py`

Responsabilidades:

- Dibujar campo.
- Dibujar torres.
- Dibujar jugadores.
- Dibujar heatmap.

Funciones esperadas:

```python
def plot_zone_heatmap(zone_values, grid_shape=(3, 3)):
    pass


def plot_player_positions(players):
    pass
```

---

## 10. Requisitos técnicos

### 10.1 Firmware

Se puede usar:

- Arduino framework para ESP32.
- PlatformIO.
- ESP-IDF si se requiere mayor control.

Para el MVP se recomienda:

```text
PlatformIO + Arduino framework
```

### 10.2 Python

Dependencias iniciales:

```text
pandas
numpy
scikit-learn
matplotlib
joblib
pyserial
pytest
```

Archivo `requirements.txt` sugerido:

```text
pandas
numpy
scikit-learn
matplotlib
joblib
pyserial
pytest
```

---

## 11. Métricas de evaluación

### 11.1 Métricas del modelo

- Accuracy general.
- Accuracy por zona.
- Matriz de confusión.
- Precisión promedio por jugador.
- Porcentaje de predicciones inestables.

### 11.2 Métricas del sistema

- Paquetes recibidos por segundo.
- Porcentaje de paquetes perdidos.
- Latencia promedio.
- Estabilidad de visualización.
- Tiempo de procesamiento por muestra.

### 11.3 Métricas para mapa de calor

- Tiempo estimado por zona.
- Zona más visitada.
- Zona menos visitada.
- Diferencia entre trayectoria real y estimada durante pruebas controladas.

---

## 12. Riesgos técnicos y mitigaciones

### Riesgo 1 — RSSI muy inestable

Mitigación:

- Usar promedios móviles.
- Usar mediana por ventana temporal.
- Calibrar con varias orientaciones.
- Aumentar número de torres.
- Usar clasificación por zonas en lugar de coordenadas exactas.

### Riesgo 2 — Colisiones con varios jugadores

Mitigación:

- Agregar jitter aleatorio.
- Reducir frecuencia de transmisión.
- Usar paquetes pequeños.
- Empezar con 2 jugadores antes de pasar a 10.

### Riesgo 3 — Torres no reciben todos los paquetes

Mitigación:

- Rellenar valores faltantes con `-100`.
- Agrupar por ventanas temporales además de `seq`.
- Usar más torres.
- Revisar ubicación física de antenas.

### Riesgo 4 — Movimiento visual con saltos

Mitigación:

- Suavizado exponencial.
- Promedio de probabilidades por ventana.
- Limitar velocidad máxima visual.

### Riesgo 5 — Dataset de calibración insuficiente

Mitigación:

- Tomar más muestras por zona.
- Repetir calibración en diferentes momentos.
- Agregar orientación del dispositivo.
- Validar matriz de confusión.

---

## 13. Orden ideal de desarrollo

Implementar en este orden:

```text
1. Un ESP32 jugador transmite ID + secuencia.
2. Una torre recibe y muestra RSSI por serial.
3. Cuatro torres reciben el mismo paquete.
4. Guardar lecturas en CSV.
5. Crear script para agrupar por player_id y seq.
6. Calibrar 9 zonas.
7. Entrenar KNN.
8. Evaluar matriz de confusión.
9. Predecir zona en Python.
10. Generar heatmap 3x3.
11. Usar predict_proba para obtener probabilidades.
12. Interpolar posición x,y.
13. Aplicar suavizado.
14. Dibujar punto en pantalla.
15. Probar con 2 jugadores.
16. Probar con 5 jugadores.
17. Probar con 10 jugadores.
18. Agregar gateway para tiempo real.
19. Mejorar visualización.
20. Documentar resultados finales.
```

---

## 14. Checklist de aceptación experimental del MVP

Esta lista se completa con evidencia de una campaña, no con la mera existencia del código. Para capacidades implementadas consulte la tabla de estado inicial.

El MVP se considera completo cuando se cumpla lo siguiente:

- [ ] Un jugador ESP32 transmite por ESP-NOW.
- [ ] Cuatro torres reciben paquetes.
- [ ] Cada torre obtiene RSSI.
- [ ] Se generan registros CSV.
- [ ] Se calibra una cuadrícula 3x3.
- [ ] Se entrena un modelo KNN.
- [ ] El modelo predice zonas.
- [ ] Se genera matriz de confusión.
- [ ] Se genera mapa de calor 3x3.
- [ ] El sistema puede reproducir una sesión grabada.

---

## 15. Checklist de versión intermedia

- [ ] Se usan 8 torres.
- [ ] El modelo genera probabilidades por zona.
- [ ] Se calcula posición aproximada `(x, y)`.
- [ ] Se aplica suavizado temporal.
- [ ] Se muestra un punto moviéndose en pantalla.
- [ ] Se genera heatmap continuo.
- [ ] Se puede guardar una sesión completa.

---

## 16. Checklist de versión final

- [ ] El sistema soporta hasta 10 jugadores.
- [ ] Cada jugador tiene ID único.
- [ ] El sistema genera posición visual por jugador.
- [ ] El sistema genera heatmap individual.
- [ ] El sistema genera heatmap global.
- [ ] Existe gateway o método centralizado de recolección.
- [ ] La visualización funciona con datos en vivo o casi en vivo.
- [ ] Existe documentación de instalación y uso.
- [ ] Existe documentación de calibración.
- [ ] Existe reporte de precisión del sistema.

---

## 17. Prompt original de planificación (referencia histórica)

Este prompt antecede a la implementación React/Express/Python actual y no es una instrucción vigente para reconstruir el repositorio. Use `docs/arquitectura.md`, `docs/reglas.md` y el código para nuevas tareas.

Usa este proyecto como una especificación técnica. Implementa el repositorio `heatmap-esp32-rssi` siguiendo la estructura propuesta. Prioriza primero el pipeline Python con datos simulados y CSV de ejemplo antes de implementar firmware completo.

Orden de implementación recomendado para Codex:

1. Crear estructura del repositorio.
2. Crear `requirements.txt`.
3. Crear módulos Python en `src/`.
4. Crear datos de ejemplo en `data/examples/`.
5. Implementar carga y preprocesamiento de CSV.
6. Implementar entrenamiento de KNN y Random Forest.
7. Implementar interpolación por probabilidades.
8. Implementar suavizado.
9. Implementar heatmap por zonas y continuo.
10. Crear tests unitarios.
11. Crear README con instrucciones.
12. Crear firmware básico de jugador y torre como plantilla.

No intentes resolver coordenadas exactas por trilateración en la primera versión. La estrategia oficial del proyecto es:

```text
RSSI -> clasificación por zona -> probabilidades -> interpolación -> suavizado -> visualización -> heatmap
```

---

## 18. Definición final del proyecto

El proyecto se define como:

> Sistema experimental de estimación de presencia y movimiento aproximado para múltiples jugadores en una zona despejada, usando ESP32, ESP-NOW, mediciones RSSI, clasificación supervisada por zonas, interpolación probabilística y generación de mapas de calor en Python.

La posición mostrada en pantalla no debe presentarse como coordenada real exacta, sino como:

> Una posición visual aproximada e interpolada a partir de probabilidades de pertenencia a zonas calibradas.

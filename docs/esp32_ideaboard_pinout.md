# Pinout ESP32 CRCibernetica IdeaBoard

## Alimentación

| Función | Rango / Pin |
|---|---|
| Power | 4.5–9 VDC |
| GND | Tierra |

---

## Periféricos integrados

### Driver de motores L9110S Dual Motor Driver

| Función | Pin / GPIO |
|---|---:|
| Motor1_A | 12 |
| Motor1_B | 14 |
| Motor2_A | 13 |
| Motor2_B | 15 |

### LED RGB WS2812B

| Función | Pin / GPIO |
|---|---:|
| RGB LED | 2 |

---

## Pines de comunicación

| Función | Pin / GPIO | Notas |
|---|---:|---|
| I2C SDA | 21 | Datos I2C |
| I2C SCL | 22 | Reloj I2C |
| SPI CS | 5 | Chip Select |
| SPI CLK | 18 | Clock |
| SPI MISO | 19 | Master In Slave Out |
| SPI MOSI | 23 | Master Out Slave In |

---

## Pines analógicos, táctiles y DAC

| Pin / GPIO | Funciones | Restricciones / Notas |
|---:|---|---|
| 4 | Analog In, Touch | No puede usarse como Analog In mientras se usa WiFi |
| 25 | Analog In, DAC | No puede usarse como Analog In mientras se usa WiFi |
| 26 | Analog In, DAC | No puede usarse como Analog In mientras se usa WiFi |
| 27 | Analog In, Touch | No puede usarse como Analog In mientras se usa WiFi |
| 33 | Analog In, Touch | Sin restricción indicada |
| 32 | Analog In, Touch | Sin restricción indicada |
| 35 | Analog In | Solo entrada / Input only |
| 34 | Analog In | Solo entrada / Input only |
| 39 | Analog In | Solo entrada / Input only |
| 36 | Analog In | Solo entrada / Input only |

---

## Advertencias importantes

- Los pines `4`, `25`, `26` y `27` **no pueden funcionar como entrada analógica mientras se usa WiFi**.
- Los pines `35`, `34`, `39` y `36` son **solo de entrada**. No pueden usarse como salidas digitales.
- Los pines `25` y `26` tienen función **DAC**.
- Los pines `4`, `27`, `33` y `32` tienen función **Touch**.
- El LED RGB integrado WS2812B está conectado al pin `2`.
- El driver de motores L9110S integrado usa los pines `12`, `14`, `13` y `15`.

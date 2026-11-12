#pragma once

constexpr uint8_t PIN_LED_RGB = 2;
// Búsqueda automática: escucha cada canal permitido hasta encontrar el Gateway.
constexpr uint32_t ESCUCHA_CANAL_MS = 1200;
constexpr uint32_t VIGENCIA_ANUNCIO_GATEWAY_MS = 5000;
constexpr uint8_t ID_JUGADOR_RESPALDO = 0;  // 0 solicita asignación dinámica.
constexpr uint32_t INTERVALO_BEACON_MS = 500;
constexpr uint16_t JITTER_BEACON_MAX_MS = 100;
constexpr uint32_t INTERVALO_REGISTRO_MS = 3000;

// Desactívalo para juegos sin tarjeta; el pin no se usa en ese modo.
constexpr bool SENSOR_LIGHT_BLOCKING_PRESENTE = true;
constexpr uint8_t PIN_LIGHT_BLOCKING = 27;
constexpr bool LIGHT_BLOCKING_TARJETA_PRESENTE_ALTO = true;
constexpr uint32_t ESTABILIZACION_LIGHT_BLOCKING_MS = 100;
constexpr uint32_t RETARDO_ELIMINACION_TARJETA_MS = 2000;
// GPIO 26 está libre en IdeaBoard; conectar aquí la salida S del buzzer pasivo.
constexpr uint8_t PIN_BUZZER = 26;
constexpr uint16_t FRECUENCIA_BUZZER_HZ = 2200;
constexpr uint32_t DURACION_AVISO_BUZZER_MS = 4000;
constexpr int PIN_I2C_SDA_MPU = 21;
constexpr int PIN_I2C_SCL_MPU = 22;
constexpr uint8_t DIRECCION_MPU6050 = 0x68;
constexpr uint32_t INTERVALO_MUESTREO_MPU_MS = 50;
constexpr uint16_t TIMEOUT_I2C_MPU_MS = 10;
constexpr uint32_t INTERVALO_RECONEXION_MPU_MS = 2000;
constexpr float UMBRAL_MOVIMIENTO_MPU = 0.18f;  // g de variación entre muestras.
constexpr float FACTOR_FILTRO_MPU = 0.25f;

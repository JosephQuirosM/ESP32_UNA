#pragma once

constexpr uint8_t PIN_LED_RGB = 2;
// Búsqueda automática: escucha cada canal permitido hasta encontrar el Gateway.
constexpr uint32_t ESCUCHA_CANAL_MS = 1200;
constexpr uint32_t VIGENCIA_ANUNCIO_GATEWAY_MS = 5000;
constexpr uint8_t ID_TORRE_RESPALDO = 0;  // 0 solicita asignación dinámica.
constexpr uint32_t INTERVALO_REGISTRO_MS = 3000;
constexpr uint8_t CAPACIDAD_COLA_TORRE = 24;
constexpr uint8_t RETARDO_POR_ID_TORRE_MS = 8;
constexpr uint8_t JITTER_REENVIO_MAX_MS = 7;
constexpr uint8_t INTERVALO_REINTENTO_ENVIO_MS = 10;
constexpr uint32_t INTERVALO_REPORTE_TORRE_MS = 5000;

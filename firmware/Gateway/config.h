#pragma once

constexpr uint8_t PIN_LED_RGB = 2;
// El hotspot de la PC debe usar 2.4 GHz y este mismo canal.
// CANAL_ESPNOW también debe coincidir en Torre/config.h y Jugador/config.h.
constexpr uint8_t CANAL_ESPNOW = 6;
// Credenciales del hotspot creado por la PC; el Gateway ya no crea una red.
constexpr char NOMBRE_RED[] = "GF63-Thin-10SC";
constexpr char CLAVE_RED[] = "9876543210";
constexpr uint32_t INTERVALO_RECONEXION_WIFI_MS = 10000;
constexpr uint16_t PUERTO_DESCUBRIMIENTO_UDP = 4210;
// Anuncios ESP-NOW para los nodos y UDP para el backend de la PC.
constexpr uint32_t INTERVALO_ANUNCIO_GATEWAY_MS = 2000;
constexpr uint32_t VIGENCIA_DESTINO_PC_MS = 12000;
constexpr uint8_t CAPACIDAD_COLA_CONTROL = 24;
constexpr uint8_t CAPACIDAD_COLA_REGISTROS = 96;
constexpr uint8_t MAXIMO_NODOS = 20;
constexpr uint8_t TAMANO_LOTE_HTTP = 8;
constexpr uint16_t TIEMPO_ESPERA_HTTP_MS = 400;
constexpr uint16_t INTERVALO_REINTENTO_HTTP_MS = 500;
constexpr uint16_t INTERVALO_REINTENTO_HTTP_MAX_MS = 8000;
constexpr uint8_t MAXIMO_REINTENTOS_HTTP = 5;

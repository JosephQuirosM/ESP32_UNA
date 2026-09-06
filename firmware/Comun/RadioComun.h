#pragma once

#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <cstring>

constexpr uint8_t MAC_BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

// Inicializa ESP-NOW y registra el peer usado por anuncios y control broadcast.
inline bool inicializarEspNow(wifi_interface_t interfaz) {
  if (esp_now_init() != ESP_OK) {
    return false;
  }

  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, MAC_BROADCAST, sizeof(MAC_BROADCAST));
  peer.channel = 0;  // Usa el canal actual de la interfaz Wi-Fi.
  peer.ifidx = interfaz;
  peer.encrypt = false;
  return esp_now_add_peer(&peer) == ESP_OK || esp_now_is_peer_exist(MAC_BROADCAST);
}

// Configura una estación sin asociarla a un AP y fija el canal de ESP-NOW.
inline bool prepararEstacionEnCanal(uint8_t canal) {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  return esp_wifi_set_channel(canal, WIFI_SECOND_CHAN_NONE) == ESP_OK;
}

inline bool enviarBroadcast(const void *paquete, size_t longitud) {
  return esp_now_send(MAC_BROADCAST, static_cast<const uint8_t *>(paquete), longitud) == ESP_OK;
}

// Registra un destino unicast sobre la interfaz y el canal Wi-Fi actuales.
inline bool registrarPeerUnicast(const uint8_t *mac, wifi_interface_t interfaz) {
  if (mac == nullptr) return false;
  if (esp_now_is_peer_exist(mac)) return true;
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, mac, sizeof(peer.peer_addr));
  peer.channel = 0;
  peer.ifidx = interfaz;
  peer.encrypt = false;
  return esp_now_add_peer(&peer) == ESP_OK;
}

inline bool enviarUnicast(const uint8_t *mac, const void *paquete, size_t longitud) {
  if (mac == nullptr || !esp_now_is_peer_exist(mac)) return false;
  return esp_now_send(mac, static_cast<const uint8_t *>(paquete), longitud) == ESP_OK;
}

inline String macATexto(const uint8_t *mac) {
  char texto[18];
  snprintf(texto, sizeof(texto), "%02X:%02X:%02X:%02X:%02X:%02X", mac[0], mac[1],
           mac[2], mac[3], mac[4], mac[5]);
  return String(texto);
}

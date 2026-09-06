#pragma once

#include <Arduino.h>
#include <cstring>

// Todas las estructuras de radio usan el mismo formato para evitar que los
// nodos interpreten paquetes de otra versión del protocolo como válidos.
constexpr uint16_t FIRMA_PAQUETE = 0x484D;  // "HM" de Heat Map.
constexpr uint8_t VERSION_PROTOCOLO = 2;
constexpr uint8_t ID_SIN_ASIGNAR = 0;
constexpr size_t TAMANO_MAC = 6;

enum class TipoPaquete : uint8_t {
  ANUNCIO_GATEWAY = 1,
  REGISTRO_NODO = 2,
  ASIGNACION_ID = 3,
  BEACON_JUGADOR = 4,
  REGISTRO_TORRE = 5,
};

enum class RolNodo : uint8_t {
  JUGADOR = 1,
  TORRE = 2,
};

struct __attribute__((packed)) EncabezadoPaquete {
  uint16_t firma;
  uint8_t version;
  TipoPaquete tipo;
};

struct __attribute__((packed)) PaqueteAnuncioGateway {
  EncabezadoPaquete encabezado;
  uint8_t canal;
  uint32_t sesion_gateway;
};

struct __attribute__((packed)) PaqueteRegistroNodo {
  EncabezadoPaquete encabezado;
  RolNodo rol;
  uint8_t id_preferido;
  uint8_t mac_nodo[TAMANO_MAC];
};

struct __attribute__((packed)) PaqueteAsignacionId {
  EncabezadoPaquete encabezado;
  RolNodo rol;
  uint8_t id_asignado;
  uint8_t mac_destino[TAMANO_MAC];
};

struct __attribute__((packed)) PaqueteBeaconJugador {
  EncabezadoPaquete encabezado;
  uint8_t id_jugador;
  uint32_t sesion_jugador;
  uint32_t secuencia;
  uint32_t tiempo_jugador_ms;
};

struct __attribute__((packed)) PaqueteRegistroTorre {
  EncabezadoPaquete encabezado;
  uint8_t id_torre;
  uint8_t id_jugador;
  uint32_t sesion_jugador;
  uint32_t secuencia;
  int8_t rssi;
  uint32_t tiempo_torre_ms;
};

inline EncabezadoPaquete crearEncabezado(TipoPaquete tipo) {
  return {FIRMA_PAQUETE, VERSION_PROTOCOLO, tipo};
}

// Valida tamaño, firma, versión y tipo antes de convertir bytes a una estructura.
inline bool esPaqueteValido(const uint8_t *datos, int longitud,
                            TipoPaquete tipo_esperado, size_t tamano_esperado) {
  if (datos == nullptr || longitud != static_cast<int>(tamano_esperado)) {
    return false;
  }
  EncabezadoPaquete encabezado = {};
  memcpy(&encabezado, datos, sizeof(encabezado));
  return encabezado.firma == FIRMA_PAQUETE &&
         encabezado.version == VERSION_PROTOCOLO &&
         encabezado.tipo == tipo_esperado;
}

inline bool macEsIgual(const uint8_t *primera, const uint8_t *segunda) {
  return memcmp(primera, segunda, TAMANO_MAC) == 0;
}

inline void copiarMac(uint8_t *destino, const uint8_t *origen) {
  memcpy(destino, origen, TAMANO_MAC);
}

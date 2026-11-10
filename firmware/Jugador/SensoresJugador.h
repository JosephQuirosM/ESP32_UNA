#pragma once
#include <stdint.h>

// Máquina no bloqueante para pausar/reanudar beacons según presencia estable.
struct EstadoTarjeta {
  bool transmitir;
  bool ausenciaPendiente;
  uint32_t inicioAusenciaMs;
};

enum class CambioTarjeta : uint8_t { SIN_CAMBIO, REANUDAR, PAUSAR };

inline CambioTarjeta actualizarEstadoTarjeta(EstadoTarjeta &estado, bool presente,
                                             uint32_t ahora, uint32_t retardoMs) {
  if (presente) {
    const bool reanudar = !estado.transmitir;
    estado.transmitir = true;
    estado.ausenciaPendiente = false;
    return reanudar ? CambioTarjeta::REANUDAR : CambioTarjeta::SIN_CAMBIO;
  }
  if (!estado.transmitir) return CambioTarjeta::SIN_CAMBIO;
  if (!estado.ausenciaPendiente) {
    estado.ausenciaPendiente = true;
    estado.inicioAusenciaMs = ahora;
    return CambioTarjeta::SIN_CAMBIO;
  }
  if (static_cast<uint32_t>(ahora - estado.inicioAusenciaMs) < retardoMs)
    return CambioTarjeta::SIN_CAMBIO;
  estado.transmitir = false;
  estado.ausenciaPendiente = false;
  return CambioTarjeta::PAUSAR;
}

// Suaviza magnitud de aceleración cambiante; alfa en (0,1].
inline float filtrarVariacion(float anterior, float muestra, float alfa) {
  return anterior + alfa * (muestra - anterior);
}

inline bool clasificarMovimiento(float variacion, float umbral) {
  return variacion > umbral;
}

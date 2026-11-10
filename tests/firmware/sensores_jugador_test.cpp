#include <cassert>
#include "../../firmware/Jugador/SensoresJugador.h"

int main() {
  EstadoTarjeta estado{true, false, 0};
  assert(actualizarEstadoTarjeta(estado, false, 100, 2000) == CambioTarjeta::SIN_CAMBIO);
  assert(actualizarEstadoTarjeta(estado, false, 2099, 2000) == CambioTarjeta::SIN_CAMBIO);
  assert(actualizarEstadoTarjeta(estado, true, 2100, 2000) == CambioTarjeta::SIN_CAMBIO);
  assert(estado.transmitir && !estado.ausenciaPendiente);
  assert(actualizarEstadoTarjeta(estado, false, 3000, 2000) == CambioTarjeta::SIN_CAMBIO);
  assert(actualizarEstadoTarjeta(estado, false, 4999, 2000) == CambioTarjeta::SIN_CAMBIO);
  assert(actualizarEstadoTarjeta(estado, false, 5000, 2000) == CambioTarjeta::PAUSAR);
  assert(!estado.transmitir);
  assert(actualizarEstadoTarjeta(estado, false, 6000, 2000) == CambioTarjeta::SIN_CAMBIO);
  assert(!estado.transmitir);
  assert(actualizarEstadoTarjeta(estado, true, 6001, 2000) == CambioTarjeta::REANUDAR);
  assert(estado.transmitir);
  // Resta unsigned conserva el plazo al cruzar el wrap de millis().
  estado = {true, false, 0};
  const uint32_t inicio = 0xfffffff0u;
  actualizarEstadoTarjeta(estado, false, inicio, 32);
  assert(actualizarEstadoTarjeta(estado, false, 0x0fu, 32) == CambioTarjeta::SIN_CAMBIO);
  assert(actualizarEstadoTarjeta(estado, false, 0x10u, 32) == CambioTarjeta::PAUSAR);
  // Filtro y umbral estrictos: igualdad es detenido.
  assert(filtrarVariacion(0.0f, 1.0f, 0.25f) == 0.25f);
  float filtrada = 0.0f;
  for (int i=0;i<20;++i) filtrada=filtrarVariacion(filtrada,0.05f,0.25f);
  assert(!clasificarMovimiento(filtrada,0.18f));
  for (int i=0;i<12;++i) filtrada=filtrarVariacion(filtrada,0.8f,0.25f);
  assert(clasificarMovimiento(filtrada,0.18f));
  for (int i=0;i<24;++i) filtrada=filtrarVariacion(filtrada,0.0f,0.25f);
  assert(!clasificarMovimiento(filtrada,0.18f));
  assert(!clasificarMovimiento(0.18f, 0.18f));
  assert(clasificarMovimiento(0.181f, 0.18f));
}

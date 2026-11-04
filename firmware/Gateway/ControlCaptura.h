#pragma once

#include <stdint.h>
#include <stddef.h>
#include <string.h>

// Control PC–Gateway independiente del contrato ESP-NOW de jugador y torres.
class ControlCaptura {
 public:
  static constexpr uint32_t VIGENCIA_MS = 12000;
  enum Resultado { IGNORADA, NUEVA, RENOVADA };

  // Una misma revisión sólo renueva: jamás reinicia ni reabre una captura cerrada.
  Resultado ordenar(uint64_t revision, const char *id, uint16_t puerto, uint32_t ahora) {
    if (revision == 0 || revision > 9007199254740991ULL || !idValido(id, puerto)) return IGNORADA;
    if (revision < revision_) return IGNORADA;
    if (revision == revision_) {
      if (puerto != puerto_ || strcmp(id, id_) != 0) return IGNORADA;
      if (habilitada_ && activa(ahora)) vence_ = ahora + VIGENCIA_MS;
      return RENOVADA;
    }
    revision_ = revision;
    puerto_ = puerto;
    strcpy(id_, id);
    habilitada_ = puerto != 0;
    vence_ = ahora + VIGENCIA_MS;
    return NUEVA;
  }

  bool activa(uint32_t ahora) const {
    return habilitada_ && static_cast<int32_t>(vence_ - ahora) > 0;
  }
  void cerrar() { habilitada_ = false; }
  uint64_t revision() const { return revision_; }
  const char *id() const { return id_; }
  uint16_t puerto(uint32_t ahora) const { return activa(ahora) ? puerto_ : 0; }

 private:
  static bool idValido(const char *id, uint16_t puerto) {
    if (id == nullptr) return false;
    if (puerto == 0) return strcmp(id, "-") == 0;
    if (strlen(id) != 36) return false;
    for (size_t i = 0; i < 36; ++i) {
      if (i == 8 || i == 13 || i == 18 || i == 23) {
        if (id[i] != '-') return false;
      } else if (!((id[i] >= '0' && id[i] <= '9') || (id[i] >= 'a' && id[i] <= 'f'))) return false;
    }
    return true;
  }
  uint64_t revision_ = 0;
  char id_[37] = "-";
  uint16_t puerto_ = 0;
  uint32_t vence_ = 0;
  bool habilitada_ = false;
};

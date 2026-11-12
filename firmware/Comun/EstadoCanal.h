#pragma once

#include <stdint.h>
#include <string.h>

// Estado de búsqueda independiente de Arduino, comprobable sin placas.
class EstadoCanal {
 public:
  enum Cambio { NINGUNO, ENCONTRADO, REINICIADO, PERDIDO };

  EstadoCanal(uint32_t escuchaMs, uint32_t vigenciaMs)
      : escuchaMs_(escuchaMs), vigenciaMs_(vigenciaMs) {}

  void iniciar(uint8_t primero, uint8_t ultimo, uint32_t ahora) {
    encontrado_ = elegido_ = false;
    sesion_ = ultimoAnuncio_ = 0;
    memset(mac_, 0, sizeof(mac_));
    primero_ = primero;
    ultimo_ = ultimo;
    cambiar(primero, ahora);
  }

  // Un anuncio sólo prueba presencia en el canal donde realmente se recibió.
  Cambio anunciar(const uint8_t *mac, uint8_t canal, uint32_t sesion,
                   uint32_t recibido, uint32_t ahora) {
    if (!mac || !sesion || canal != canal_ || ahora - recibido >= vigenciaMs_ ||
        static_cast<int32_t>(recibido - inicioCanal_) < 0 ||
        (elegido_ && memcmp(mac_, mac, 6) != 0)) return NINGUNO;
    Cambio cambio = !encontrado_ ? ENCONTRADO :
        sesion != sesion_ ? REINICIADO : NINGUNO;
    memcpy(mac_, mac, 6);
    elegido_ = true;
    encontrado_ = true;
    sesion_ = sesion;
    ultimoAnuncio_ = recibido;
    return cambio;
  }

  Cambio actualizar(uint32_t ahora) {
    if (encontrado_ && ahora - ultimoAnuncio_ >= vigenciaMs_) {
      encontrado_ = false;
      inicioCanal_ = ahora - escuchaMs_; // Comienza a buscar inmediatamente.
      return PERDIDO;
    }
    return NINGUNO;
  }

  bool cambiarAhora(uint32_t ahora) const {
    return !encontrado_ && ahora - inicioCanal_ >= escuchaMs_;
  }
  uint8_t siguiente() const { return canal_ >= ultimo_ ? primero_ : canal_ + 1; }
  // Sólo se confirma el cambio después de que el driver lo haya aceptado.
  void cambiar(uint8_t canal, uint32_t ahora) { canal_ = canal; inicioCanal_ = ahora; }
  bool encontrado() const { return encontrado_; }
  uint8_t canal() const { return canal_; }
  uint32_t sesion() const { return sesion_; }
  const uint8_t *mac() const { return mac_; }
  bool aceptaMac(const uint8_t *mac) const {
    return mac && (!elegido_ || memcmp(mac_, mac, 6) == 0);
  }

 private:
  uint32_t escuchaMs_, vigenciaMs_;
  uint32_t inicioCanal_ = 0, ultimoAnuncio_ = 0, sesion_ = 0;
  uint8_t primero_ = 1, ultimo_ = 11, canal_ = 1, mac_[6] = {};
  bool encontrado_ = false, elegido_ = false;
};

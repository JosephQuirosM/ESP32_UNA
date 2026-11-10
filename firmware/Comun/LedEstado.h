#pragma once

#include <Arduino.h>
#include <esp32-hal-rgb-led.h>

struct ColorLed {
  uint8_t rojo;
  uint8_t verde;
  uint8_t azul;
};

constexpr ColorLed APAGADO = {0, 0, 0};
constexpr ColorLed ROJO = {255, 0, 0};
constexpr ColorLed VERDE = {0, 255, 0};
constexpr ColorLed AZUL = {0, 0, 255};
constexpr ColorLed AMARILLO = {255, 150, 0};
constexpr ColorLed CIAN = {0, 180, 180};

// Centraliza colores fijos, intermitentes y pulsos sin bloquear el loop principal.
class ControlLed {
 public:
  explicit ControlLed(uint8_t pin) : pin_(pin) {}

  void iniciar() { aplicar(APAGADO); }

  void fijo(ColorLed color) {
    duracion_latido_ms_ = 0;
    intermitente_ = false;
    color_base_ = color;
    aplicar(color);
  }

  void intermitente(ColorLed color, uint32_t periodo_ms) {
    duracion_latido_ms_ = 0;
    intermitente_ = true;
    color_base_ = color;
    periodo_ms_ = periodo_ms;
  }

  void pulso(ColorLed color, uint32_t duracion_ms = 80) {
    color_pulso_ = color;
    fin_pulso_ms_ = millis() + duracion_ms;
  }

  // Baja y recupera la intensidad del color base sin cambiar su tono.
  void latido(uint32_t duracion_ms) {
    inicio_latido_ms_ = millis();
    duracion_latido_ms_ = duracion_ms;
  }

  void actualizar() {
    const uint32_t ahora = millis();
    if (static_cast<int32_t>(fin_pulso_ms_ - ahora) > 0) {
      aplicar(color_pulso_);
      return;
    }
    const uint32_t transcurrido = ahora - inicio_latido_ms_;
    if (duracion_latido_ms_ > 0 && transcurrido < duracion_latido_ms_) {
      const uint32_t mitad = duracion_latido_ms_ / 2;
      const uint32_t distancia = transcurrido <= mitad ? transcurrido : duracion_latido_ms_ - transcurrido;
      const uint32_t intensidad = 255 - (distancia * 191 / (mitad ? mitad : 1));
      aplicar({static_cast<uint8_t>(color_base_.rojo * intensidad / 255),
              static_cast<uint8_t>(color_base_.verde * intensidad / 255),
              static_cast<uint8_t>(color_base_.azul * intensidad / 255)});
      return;
    }
    if (intermitente_) {
      const bool encendido = (ahora / periodo_ms_) % 2 == 0;
      aplicar(encendido ? color_base_ : APAGADO);
      return;
    }
    aplicar(color_base_);
  }

 private:
  void aplicar(ColorLed color) { rgbLedWrite(pin_, color.rojo, color.verde, color.azul); }

  uint8_t pin_;
  ColorLed color_base_ = APAGADO;
  ColorLed color_pulso_ = APAGADO;
  uint32_t periodo_ms_ = 500;
  uint32_t fin_pulso_ms_ = 0;
  bool intermitente_ = false;
  uint32_t inicio_latido_ms_ = 0;
  uint32_t duracion_latido_ms_ = 0;
};

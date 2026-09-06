#pragma once

#include <Arduino.h>

constexpr uint8_t PINES_DRIVER_MOTORES[] = {12, 13, 14, 15};

// Mantiene apagado el driver L9110S integrado cuando no se usan los motores.
inline void apagarDriverMotores() {
  for (const uint8_t pin : PINES_DRIVER_MOTORES) {
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
  }
}

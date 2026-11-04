#include <cassert>
#include <cstdint>
#include "../../firmware/Gateway/ControlCaptura.h"

// Comprueba la misma máquina de estados que ejecuta el Gateway físico.
int main() {
  const char *a = "11111111-1111-4111-8111-111111111111";
  const char *b = "22222222-2222-4222-8222-222222222222";
  ControlCaptura c;
  assert(!c.activa(0));
  assert(c.ordenar(1, a, 8080, 10) == ControlCaptura::NUEVA);
  assert(c.activa(10));
  assert(c.ordenar(1, a, 8080, 100) == ControlCaptura::RENOVADA);
  assert(c.activa(12050)); // La renovación prolonga la autorización.
  assert(!c.activa(12100));
  assert(c.ordenar(1, a, 8080, 12200) == ControlCaptura::RENOVADA);
  assert(!c.activa(12200)); // Un mensaje retrasado no reabre una autorización vencida.
  assert(c.ordenar(2, b, 8080, 13000) == ControlCaptura::NUEVA);
  assert(c.activa(13000));
  assert(c.ordenar(1, a, 8080, 13010) == ControlCaptura::IGNORADA);
  assert(c.ordenar(2, a, 8080, 13010) == ControlCaptura::IGNORADA);
  assert(c.ordenar(3, "-", 0, 13020) == ControlCaptura::NUEVA);
  assert(!c.activa(13020));
  assert(c.ordenar(2, b, 8080, 13030) == ControlCaptura::IGNORADA);
  assert(c.ordenar(4, a, 8080, 14000) == ControlCaptura::NUEVA);
  c.cerrar(); // Desconexión Wi-Fi o cambio de canal.
  assert(!c.activa(14000));
  assert(c.ordenar(4, a, 8080, 14010) == ControlCaptura::RENOVADA);
  assert(!c.activa(14010));
  assert(c.ordenar(5, b, 8080, UINT32_MAX - 5000) == ControlCaptura::NUEVA);
  assert(c.activa(UINT32_MAX - 100));
  assert(c.activa(6000));
  assert(!c.activa(7000));
  assert(c.ordenar(9007199254740992ULL, a, 8080, 1) == ControlCaptura::IGNORADA);
  assert(c.ordenar(6, "sin-identidad", 8080, 1) == ControlCaptura::IGNORADA);
  assert(c.ordenar(6, a, 0, 1) == ControlCaptura::IGNORADA);
  assert(c.ordenar(6, "-", 8080, 1) == ControlCaptura::IGNORADA);
}

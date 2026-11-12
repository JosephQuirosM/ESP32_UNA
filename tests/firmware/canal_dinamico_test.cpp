#include <cassert>
#include <cstdint>
#include "../../firmware/Comun/EstadoCanal.h"

const uint8_t gateway[] = {2, 3, 4, 5, 6, 7};
const uint8_t otro[] = {2, 3, 4, 5, 6, 8};

void buscar(EstadoCanal &estado, uint32_t ahora) {
  estado.actualizar(ahora);
  if (estado.cambiarAhora(ahora)) estado.cambiar(estado.siguiente(), ahora);
}

int main() {
  EstadoCanal estado(1200, 5000);
  estado.iniciar(1, 11, 0);
  assert(!estado.encontrado());
  assert(!estado.cambiarAhora(1199));
  assert(estado.cambiarAhora(1200));
  // No se confirma un cambio si la radio está ocupada o el driver falló.
  assert(estado.canal() == 1);
  assert(estado.anunciar(gateway, 6, 123, 1200, 1200) == EstadoCanal::NINGUNO);
  buscar(estado, 1200);
  assert(estado.canal() == 2);
  // Ni una sesión nula ni un anuncio de antes de sintonizar fijan el canal.
  assert(estado.anunciar(gateway, 2, 0, 1201, 1201) == EstadoCanal::NINGUNO);
  assert(estado.anunciar(gateway, 2, 123, 1199, 1201) == EstadoCanal::NINGUNO);
  assert(estado.anunciar(gateway, 2, 123, 1201, 1201) == EstadoCanal::ENCONTRADO);
  assert(estado.encontrado());
  assert(!estado.cambiarAhora(10000));
  assert(estado.anunciar(otro, 2, 123, 2000, 2000) == EstadoCanal::NINGUNO);
  assert(estado.actualizar(6201) == EstadoCanal::PERDIDO);
  assert(!estado.encontrado());
  assert(!estado.aceptaMac(otro)); // No migra silenciosamente a otro Gateway.
  assert(estado.anunciar(gateway, 2, 123, 1201, 6202) == EstadoCanal::NINGUNO);
  assert(estado.anunciar(gateway, 2, 123, 6202, 6202) == EstadoCanal::ENCONTRADO);
  assert(estado.anunciar(gateway, 2, 124, 6203, 6203) == EstadoCanal::REINICIADO);
  assert(estado.sesion() == 124);
  assert(estado.anunciar(gateway, 2, 124, 6204, 6204) == EstadoCanal::NINGUNO);
  assert(estado.actualizar(11203) == EstadoCanal::NINGUNO);
  assert(estado.actualizar(11204) == EstadoCanal::PERDIDO);

  // Un Gateway que aparece tarde y cambia 6 -> 11 -> 1 se recupera sin reset.
  EstadoCanal nodo(1200, 5000);
  nodo.iniciar(1, 11, 0);
  bool visto6 = false, visto11 = false, visto1 = false;
  for (uint32_t t = 0; t < 90000; t += 10) {
    const uint8_t canalAp = t < 30000 ? 6 : t < 60000 ? 11 : 1;
    // Sólo entrega por el canal sintonizado. Simula anuncios perdidos y
    // pausas de HTTP: queda un anuncio cada segundo, no cada 250 ms.
    if (t >= 8000 && t % 1000 == 0 && nodo.canal() == canalAp)
      nodo.anunciar(gateway, canalAp, 500, t, t);
    buscar(nodo, t);
    if (nodo.encontrado() && nodo.canal() == canalAp) {
      if (canalAp == 6) visto6 = true;
      if (canalAp == 11) visto11 = true;
      if (canalAp == 1) visto1 = true;
    }
    if (t == 28000 || t == 58000 || t == 88000)
      assert(nodo.encontrado() && nodo.canal() == canalAp);
  }
  assert(visto6 && visto11 && visto1);

  // Desaparición prolongada, recorrido circular y rango regional de 13 canales.
  EstadoCanal regional(1200, 5000);
  regional.iniciar(1, 13, 0);
  for (uint32_t t = 1200; t <= 14400; t += 1200) buscar(regional, t);
  assert(regional.canal() == 13);
  buscar(regional, 15600);
  assert(regional.canal() == 1);

  // millis() puede desbordarse durante búsqueda y durante una sesión.
  EstadoCanal vuelta(1200, 5000);
  vuelta.iniciar(1, 11, UINT32_MAX - 600);
  assert(!vuelta.cambiarAhora(598));
  buscar(vuelta, 599);
  assert(vuelta.canal() == 2);
  assert(vuelta.anunciar(gateway, 2, 9, 600, 600) == EstadoCanal::ENCONTRADO);
  vuelta.iniciar(1, 11, UINT32_MAX - 1000);
  vuelta.anunciar(gateway, 1, 9, UINT32_MAX - 999, UINT32_MAX - 999);
  assert(vuelta.actualizar(3999) == EstadoCanal::NINGUNO);
  assert(vuelta.actualizar(4000) == EstadoCanal::PERDIDO);
}

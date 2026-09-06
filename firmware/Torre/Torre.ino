#include "config.h"
#include <esp_mac.h>
#include "../Comun/LedEstado.h"
#include "../Comun/Paquete.h"
#include "../Comun/RadioComun.h"

struct EventoTorre {
  PaqueteBeaconJugador beacon;
  int8_t rssi;
};

ControlLed led(PIN_LED_RGB);
uint8_t idTorre = ID_TORRE_RESPALDO;
uint8_t macTorre[6] = {};
bool radioLista = false;
uint32_t ultimoRegistroMs = 0;

EventoTorre cola[CAPACIDAD_COLA_TORRE];
volatile uint8_t indiceLectura = 0;
volatile uint8_t indiceEscritura = 0;
volatile uint32_t descartesCola = 0;
portMUX_TYPE mutexCola = portMUX_INITIALIZER_UNLOCKED;

PaqueteAsignacionId asignacionPendiente = {};
volatile bool hayAsignacionPendiente = false;
portMUX_TYPE mutexAsignacion = portMUX_INITIALIZER_UNLOCKED;

// Copia el beacon y su RSSI a una cola; el reenvío se hace posteriormente en loop.
void alRecibir(const esp_now_recv_info_t *info, const uint8_t *datos, int longitud) {
  if (esPaqueteValido(datos, longitud, TipoPaquete::BEACON_JUGADOR,
                      sizeof(PaqueteBeaconJugador))) {
    portENTER_CRITICAL(&mutexCola);
    const uint8_t siguiente = (indiceEscritura + 1) % CAPACIDAD_COLA_TORRE;
    if (siguiente == indiceLectura) {
      ++descartesCola;
    } else {
      PaqueteBeaconJugador beacon = {};
      memcpy(&beacon, datos, sizeof(beacon));
      if (beacon.id_jugador != ID_SIN_ASIGNAR && beacon.sesion_jugador != 0) {
        cola[indiceEscritura].beacon = beacon;
        cola[indiceEscritura].rssi = info->rx_ctrl->rssi;
        indiceEscritura = siguiente;
      }
    }
    portEXIT_CRITICAL(&mutexCola);
    return;
  }

  if (esPaqueteValido(datos, longitud, TipoPaquete::ASIGNACION_ID,
                      sizeof(PaqueteAsignacionId))) {
    PaqueteAsignacionId paquete = {};
    memcpy(&paquete, datos, sizeof(paquete));
    if (paquete.rol == RolNodo::TORRE && macEsIgual(paquete.mac_destino, macTorre)) {
      portENTER_CRITICAL(&mutexAsignacion);
      asignacionPendiente = paquete;
      hayAsignacionPendiente = true;
      portEXIT_CRITICAL(&mutexAsignacion);
    }
  }
}

bool sacarEvento(EventoTorre &evento) {
  bool hayEvento = false;
  portENTER_CRITICAL(&mutexCola);
  if (indiceLectura != indiceEscritura) {
    evento = cola[indiceLectura];
    indiceLectura = (indiceLectura + 1) % CAPACIDAD_COLA_TORRE;
    hayEvento = true;
  }
  portEXIT_CRITICAL(&mutexCola);
  return hayEvento;
}

// Convierte cada medición local en un registro que el Gateway recibe por broadcast.
void reenviarRegistro(const EventoTorre &evento) {
  if (idTorre == ID_SIN_ASIGNAR || evento.beacon.id_jugador == ID_SIN_ASIGNAR ||
      evento.beacon.sesion_jugador == 0) return;
  PaqueteRegistroTorre registro = {crearEncabezado(TipoPaquete::REGISTRO_TORRE),
                                   idTorre,
                                   evento.beacon.id_jugador,
                                   evento.beacon.sesion_jugador,
                                   evento.beacon.secuencia,
                                   evento.rssi,
                                   millis()};
  if (enviarBroadcast(&registro, sizeof(registro))) {
    led.pulso(CIAN);
  }
}

void enviarRegistroNodo() {
  PaqueteRegistroNodo paquete = {crearEncabezado(TipoPaquete::REGISTRO_NODO),
                                 RolNodo::TORRE, idTorre, {0}};
  copiarMac(paquete.mac_nodo, macTorre);
  enviarBroadcast(&paquete, sizeof(paquete));
}

void setup() {
  Serial.begin(115200);
  led.iniciar();
  led.intermitente(AMARILLO, 400);
  esp_read_mac(macTorre, ESP_MAC_WIFI_STA);
  radioLista = prepararEstacionEnCanal(CANAL_ESPNOW) && inicializarEspNow(WIFI_IF_STA);
  if (!radioLista || esp_now_register_recv_cb(alRecibir) != ESP_OK) {
    led.intermitente(ROJO, 200);
    return;
  }
  led.intermitente(AZUL, 500);
  Serial.println("Torre lista");
}

void loop() {
  led.actualizar();
  if (!radioLista) return;
  const uint32_t ahora = millis();
  if (hayAsignacionPendiente) {
    portENTER_CRITICAL(&mutexAsignacion);
    idTorre = asignacionPendiente.id_asignado;
    hayAsignacionPendiente = false;
    portEXIT_CRITICAL(&mutexAsignacion);
    led.fijo(VERDE);
    Serial.printf("ID torre asignado: %u\n", idTorre);
  }
  if (ahora - ultimoRegistroMs >= INTERVALO_REGISTRO_MS) {
    ultimoRegistroMs = ahora;
    enviarRegistroNodo();
  }
  EventoTorre evento;
  while (sacarEvento(evento)) {
    reenviarRegistro(evento);
  }
}

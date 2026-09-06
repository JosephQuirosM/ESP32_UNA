#include "config.h"
#include <esp_mac.h>
#include <esp_system.h>
#include "../Comun/IdeaBoard.h"
#include "../Comun/LedEstado.h"
#include "../Comun/Paquete.h"
#include "../Comun/RadioComun.h"

ControlLed led(PIN_LED_RGB);
uint8_t idJugador = ID_JUGADOR_RESPALDO;
uint32_t secuencia = 0;
uint32_t sesionJugador = 0;
uint32_t proximoBeaconMs = 0;
uint32_t ultimoRegistroMs = 0;
bool radioLista = false;
uint8_t macJugador[6] = {};
PaqueteAsignacionId asignacionPendiente = {};
volatile bool hayAsignacionPendiente = false;
portMUX_TYPE mutexAsignacion = portMUX_INITIALIZER_UNLOCKED;

// Construye y difunde la telemetría que las torres usan para medir RSSI.
void enviarBeacon() {
  PaqueteBeaconJugador paquete = {crearEncabezado(TipoPaquete::BEACON_JUGADOR),
                                  idJugador, sesionJugador, ++secuencia, millis()};
  if (enviarBroadcast(&paquete, sizeof(paquete))) {
    led.pulso(VERDE);
  }
}

void programarProximoBeacon(uint32_t ahora) {
  const uint32_t jitter = esp_random() % (JITTER_BEACON_MAX_MS + 1UL);
  proximoBeaconMs = ahora + INTERVALO_BEACON_MS + jitter;
}

void alRecibir(const esp_now_recv_info_t *info, const uint8_t *datos, int longitud) {
  if (!esPaqueteValido(datos, longitud, TipoPaquete::ASIGNACION_ID,
                        sizeof(PaqueteAsignacionId))) {
    return;
  }
  PaqueteAsignacionId paquete = {};
  memcpy(&paquete, datos, sizeof(paquete));
  (void)info;
  if (paquete.rol == RolNodo::JUGADOR &&
      macEsIgual(paquete.mac_destino, macJugador)) {
    portENTER_CRITICAL(&mutexAsignacion);
    asignacionPendiente = paquete;
    hayAsignacionPendiente = true;
    portEXIT_CRITICAL(&mutexAsignacion);
  }
}

void setup() {
  Serial.begin(115200);
  apagarDriverMotores();
  led.iniciar();
  led.intermitente(AMARILLO, 400);
  esp_read_mac(macJugador, ESP_MAC_WIFI_STA);
  sesionJugador = esp_random();
  if (sesionJugador == 0) sesionJugador = 1;
  radioLista = prepararEstacionEnCanal(CANAL_ESPNOW) && inicializarEspNow(WIFI_IF_STA);
  if (!radioLista || esp_now_register_recv_cb(alRecibir) != ESP_OK) {
    led.intermitente(ROJO, 200);
    return;
  }
  Serial.println("Jugador listo");
}

void loop() {
  led.actualizar();
  if (!radioLista) return;
  const uint32_t ahora = millis();
  if (hayAsignacionPendiente) {
    uint8_t idAsignado = ID_SIN_ASIGNAR;
    portENTER_CRITICAL(&mutexAsignacion);
    idAsignado = asignacionPendiente.id_asignado;
    hayAsignacionPendiente = false;
    portEXIT_CRITICAL(&mutexAsignacion);
    const bool asignacionNueva = idJugador != idAsignado;
    idJugador = idAsignado;
    led.fijo(AZUL);
    Serial.printf("ID jugador asignado: %u\n", idJugador);
    if (asignacionNueva) programarProximoBeacon(ahora);
  }
  if (ahora - ultimoRegistroMs >= INTERVALO_REGISTRO_MS) {
    ultimoRegistroMs = ahora;
    PaqueteRegistroNodo paquete = {crearEncabezado(TipoPaquete::REGISTRO_NODO),
                                   RolNodo::JUGADOR, idJugador, {0}};
    copiarMac(paquete.mac_nodo, macJugador);
    enviarBroadcast(&paquete, sizeof(paquete));
  }
  if (idJugador != ID_SIN_ASIGNAR &&
      static_cast<int32_t>(ahora - proximoBeaconMs) >= 0) {
    enviarBeacon();
    programarProximoBeacon(ahora);
  }
}

#include "config.h"
#include <esp_mac.h>
#include <esp_system.h>
#include "../Comun/IdeaBoard.h"
#include "../Comun/LedEstado.h"
#include "../Comun/Paquete.h"
#include "../Comun/RadioComun.h"
#include "../Comun/EnlaceGateway.h"

struct EventoTorre {
  PaqueteBeaconJugador beacon;
  int8_t rssi;
  uint32_t tiempo_recepcion_ms;
};

ControlLed led(PIN_LED_RGB);
EnlaceGateway enlaceGateway(RolNodo::TORRE, ESCUCHA_CANAL_MS, VIGENCIA_ANUNCIO_GATEWAY_MS);
uint8_t idTorre = ID_SIN_ASIGNAR;
uint8_t macTorre[6] = {};
bool radioLista = false;
uint32_t ultimoRegistroMs = 0;
uint32_t ultimoReporteMs = 0;
uint32_t sesionTorre = 0;
uint32_t secuenciaTorreTx = 0;
uint8_t macGateway[TAMANO_MAC] = {};
volatile bool peerGatewayListo = false;

PaqueteRegistroTorre registroPendiente = {};
bool hayRegistroPendiente = false;
uint32_t tiempoEnvioPendienteMs = 0;
bool envioEnCurso = false;
uint32_t registrosEncolados = 0;
uint32_t transmisionesIntentadas = 0;
uint32_t fallosInicioEnvio = 0;
uint32_t beaconsRecibidos = 0;
uint32_t transmisionesConfirmadas = 0;
uint32_t transmisionesFallidas = 0;
portMUX_TYPE mutexEnvio = portMUX_INITIALIZER_UNLOCKED;

EventoTorre cola[CAPACIDAD_COLA_TORRE];
uint8_t indiceLectura = 0;
uint8_t indiceEscritura = 0;
uint32_t descartesCola = 0;
uint32_t descartesSinGateway = 0;
uint32_t purgadosReconexiones = 0;
bool admitirBeacons = false;
portMUX_TYPE mutexCola = portMUX_INITIALIZER_UNLOCKED;

// Copia el beacon y su RSSI a una cola; el reenvío se hace posteriormente en loop.
void alRecibir(const esp_now_recv_info_t *info, const uint8_t *datos, int longitud) {
  if (!info || !info->rx_ctrl) return;
  if (enlaceGateway.recibir(info, datos, longitud)) return;
  if (esPaqueteValido(datos, longitud, TipoPaquete::BEACON_JUGADOR,
                      sizeof(PaqueteBeaconJugador))) {
    PaqueteBeaconJugador beacon = {};
    memcpy(&beacon, datos, sizeof(beacon));
    if (beacon.id_jugador == ID_SIN_ASIGNAR || beacon.sesion_jugador == 0) return;

    portENTER_CRITICAL(&mutexCola);
    ++beaconsRecibidos;
    if (!admitirBeacons) {
      ++descartesSinGateway;
      portEXIT_CRITICAL(&mutexCola);
      return;
    }
    const uint8_t siguiente = (indiceEscritura + 1) % CAPACIDAD_COLA_TORRE;
    if (siguiente == indiceLectura) {
      ++descartesCola;
    } else {
      cola[indiceEscritura].beacon = beacon;
      cola[indiceEscritura].rssi = info->rx_ctrl->rssi;
      cola[indiceEscritura].tiempo_recepcion_ms = millis();
      indiceEscritura = siguiente;
      ++registrosEncolados;
    }
    portEXIT_CRITICAL(&mutexCola);
    return;
  }

}

// Libera la radio tras cualquier envío y contabiliza solo la telemetría unicast.
void alEnviar(const esp_now_send_info_t *info, esp_now_send_status_t estado) {
  portENTER_CRITICAL(&mutexEnvio);
  if (info != nullptr && peerGatewayListo &&
      macEsIgual(info->des_addr, macGateway)) {
    if (estado == ESP_NOW_SEND_SUCCESS) {
      ++transmisionesConfirmadas;
    } else {
      ++transmisionesFallidas;
    }
  }
  envioEnCurso = false;
  portEXIT_CRITICAL(&mutexEnvio);
}

bool intentarMarcarEnvioEnCurso() {
  bool disponible = false;
  portENTER_CRITICAL(&mutexEnvio);
  if (!envioEnCurso) {
    envioEnCurso = true;
    disponible = true;
  }
  portEXIT_CRITICAL(&mutexEnvio);
  return disponible;
}

bool hayEnvioActivo() {
  portENTER_CRITICAL(&mutexEnvio);
  const bool activo = envioEnCurso;
  portEXIT_CRITICAL(&mutexEnvio);
  return activo;
}

void cancelarEnvioEnCurso() {
  portENTER_CRITICAL(&mutexEnvio);
  envioEnCurso = false;
  portEXIT_CRITICAL(&mutexEnvio);
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

void prepararRegistro(const EventoTorre &evento, uint32_t ahora) {
  registroPendiente = {crearEncabezado(TipoPaquete::REGISTRO_TORRE),
                       idTorre,
                       sesionTorre,
                       ++secuenciaTorreTx,
                       evento.beacon.id_jugador,
                       evento.beacon.sesion_jugador,
                       evento.beacon.secuencia,
                       evento.rssi,
                       evento.tiempo_recepcion_ms,
                       evento.beacon.movimiento};
  const uint32_t retardo = static_cast<uint32_t>(idTorre) * RETARDO_POR_ID_TORRE_MS +
                            esp_random() % (JITTER_REENVIO_MAX_MS + 1UL);
  tiempoEnvioPendienteMs = evento.tiempo_recepcion_ms + retardo;
  if (static_cast<int32_t>(ahora - tiempoEnvioPendienteMs) >= 0) {
    tiempoEnvioPendienteMs = ahora;
  }
  hayRegistroPendiente = true;
}

// Mantiene el orden: solo extrae el siguiente evento cuando no hay otro
// registro pendiente ni una transmisión ESP-NOW esperando confirmación.
void procesarReenvio(uint32_t ahora) {
  if (!peerGatewayListo || idTorre == ID_SIN_ASIGNAR) return;
  if (!hayRegistroPendiente && !hayEnvioActivo()) {
    EventoTorre evento;
    if (sacarEvento(evento)) prepararRegistro(evento, ahora);
  }
  if (!hayRegistroPendiente || hayEnvioActivo() ||
      static_cast<int32_t>(ahora - tiempoEnvioPendienteMs) < 0) return;

  if (!intentarMarcarEnvioEnCurso()) return;
  ++transmisionesIntentadas;
  if (enviarUnicast(macGateway, &registroPendiente, sizeof(registroPendiente))) {
    hayRegistroPendiente = false;
    led.latido(160);
  } else {
    cancelarEnvioEnCurso();
    ++fallosInicioEnvio;
    tiempoEnvioPendienteMs = ahora + INTERVALO_REINTENTO_ENVIO_MS;
  }
}

void enviarRegistroNodo() {
  PaqueteRegistroNodo paquete = {crearEncabezado(TipoPaquete::REGISTRO_NODO),
                                 RolNodo::TORRE, idTorre ? idTorre : ID_TORRE_RESPALDO, {0}};
  copiarMac(paquete.mac_nodo, macTorre);
  if (!intentarMarcarEnvioEnCurso()) return;
  if (!enviarBroadcast(&paquete, sizeof(paquete))) cancelarEnvioEnCurso();
}

void setup() {
  Serial.begin(115200);
  apagarDriverMotores();
  led.iniciar();
  led.intermitente(AMARILLO, 400);
  esp_read_mac(macTorre, ESP_MAC_WIFI_STA);
  sesionTorre = esp_random();
  if (sesionTorre == 0) sesionTorre = 1;
  radioLista = enlaceGateway.iniciar(macTorre) && inicializarEspNow(WIFI_IF_STA);
  if (!radioLista || esp_now_register_recv_cb(alRecibir) != ESP_OK ||
      esp_now_register_send_cb(alEnviar) != ESP_OK) {
    radioLista = false;
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
  const auto cambioCanal = enlaceGateway.actualizar(ahora, hayEnvioActivo());
  if (cambioCanal != EstadoCanal::NINGUNO) {
    // Comparte bloqueo con recepción: no deja acumular lecturas durante búsqueda.
    portENTER_CRITICAL(&mutexCola);
    admitirBeacons = false;
    purgadosReconexiones += (indiceEscritura + CAPACIDAD_COLA_TORRE - indiceLectura) % CAPACIDAD_COLA_TORRE;
    indiceLectura = indiceEscritura = 0;
    portEXIT_CRITICAL(&mutexCola);
    if (hayRegistroPendiente) ++purgadosReconexiones;
    hayRegistroPendiente = false;
    portENTER_CRITICAL(&mutexEnvio);
    peerGatewayListo = false;
    portEXIT_CRITICAL(&mutexEnvio);
    idTorre = ID_SIN_ASIGNAR;
    ultimoRegistroMs = ahora - INTERVALO_REGISTRO_MS + esp_random() % 200;
    led.intermitente(AZUL, 500);
  }
  const uint8_t asignado = enlaceGateway.obtenerAsignacion();
  if (asignado != ID_SIN_ASIGNAR) {
    if (registrarPeerUnicast(enlaceGateway.mac(), WIFI_IF_STA)) {
      idTorre = asignado;
      portENTER_CRITICAL(&mutexEnvio);
      copiarMac(macGateway, enlaceGateway.mac());
      peerGatewayListo = true;
      portEXIT_CRITICAL(&mutexEnvio);
      portENTER_CRITICAL(&mutexCola);
      admitirBeacons = true;
      portEXIT_CRITICAL(&mutexCola);
      led.fijo(VERDE);
      Serial.printf("ID torre asignado: %u; Gateway %s registrado unicast; canal=%u\n",
                    idTorre, macATexto(macGateway).c_str(), enlaceGateway.canal());
    } else {
      Serial.println("No fue posible registrar el Gateway como peer unicast");
    }
  }
  if (enlaceGateway.encontrado() && !hayEnvioActivo() &&
      ahora - ultimoRegistroMs >= INTERVALO_REGISTRO_MS) {
    ultimoRegistroMs = ahora;
    enviarRegistroNodo();
  }
  procesarReenvio(ahora);
  if (ahora - ultimoReporteMs >= INTERVALO_REPORTE_TORRE_MS) {
    ultimoReporteMs = ahora;
    uint32_t beacons = 0;
    uint32_t encolados = 0;
    uint32_t descartes = 0;
    uint32_t sinGateway = 0;
    uint32_t confirmadas = 0;
    uint32_t fallidas = 0;
    portENTER_CRITICAL(&mutexCola);
    beacons = beaconsRecibidos;
    encolados = registrosEncolados;
    descartes = descartesCola;
    sinGateway = descartesSinGateway;
    portEXIT_CRITICAL(&mutexCola);
    portENTER_CRITICAL(&mutexEnvio);
    confirmadas = transmisionesConfirmadas;
    fallidas = transmisionesFallidas;
    portEXIT_CRITICAL(&mutexEnvio);
    Serial.printf(
        "Torre: id=%u sesion=%lu beacons=%lu encolados=%lu descartes_cola=%lu "
        "tx_intentos=%lu tx_confirmadas=%lu tx_fallidas=%lu fallos_inicio=%lu "
        "gateway_unicast=%s canal=%u descartes_sin_gateway=%lu purgados_reconexion=%lu\n",
        idTorre, static_cast<unsigned long>(sesionTorre),
        static_cast<unsigned long>(beacons),
        static_cast<unsigned long>(encolados),
        static_cast<unsigned long>(descartes),
        static_cast<unsigned long>(transmisionesIntentadas),
        static_cast<unsigned long>(confirmadas),
        static_cast<unsigned long>(fallidas),
        static_cast<unsigned long>(fallosInicioEnvio), peerGatewayListo ? "si" : "no", enlaceGateway.canal(),
        static_cast<unsigned long>(sinGateway), static_cast<unsigned long>(purgadosReconexiones));
  }
}

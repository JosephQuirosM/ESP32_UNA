#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiUdp.h>

#include "config.h"
#include "../Comun/LedEstado.h"
#include "../Comun/Paquete.h"
#include "../Comun/RadioComun.h"

struct EventoControl {
  uint8_t mac_origen[TAMANO_MAC];
  PaqueteRegistroNodo registro;
};

struct EventoRegistro {
  uint8_t mac_origen[TAMANO_MAC];
  PaqueteRegistroTorre registro;
  uint32_t tiempo_gateway_recepcion_ms;
};

struct NodoRegistrado {
  bool ocupado;
  RolNodo rol;
  uint8_t id;
  uint8_t mac[TAMANO_MAC];
};

ControlLed led(PIN_LED_RGB);
WiFiUDP udp;
NodoRegistrado nodos[MAXIMO_NODOS] = {};

EventoControl colaControl[CAPACIDAD_COLA_CONTROL];
volatile uint8_t indiceLecturaControl = 0;
volatile uint8_t indiceEscrituraControl = 0;
volatile uint32_t descartesColaControl = 0;
portMUX_TYPE mutexColaControl = portMUX_INITIALIZER_UNLOCKED;

EventoRegistro colaRegistros[CAPACIDAD_COLA_REGISTROS];
volatile uint8_t indiceLecturaRegistros = 0;
volatile uint8_t indiceEscrituraRegistros = 0;
volatile uint32_t descartesColaRegistros = 0;
portMUX_TYPE mutexColaRegistros = portMUX_INITIALIZER_UNLOCKED;

EventoRegistro lotePendiente[TAMANO_LOTE_HTTP];
uint8_t cantidadLotePendiente = 0;
uint8_t reintentosLotePendiente = 0;
uint32_t proximoIntentoHttpMs = 0;

volatile uint32_t controlesRecibidos = 0;
volatile uint32_t registrosRecibidos = 0;
uint32_t registrosDescartadosValidacion = 0;
uint32_t registrosEnviados = 0;
uint32_t registrosDescartadosEntrega = 0;
uint32_t fallosHttp = 0;
uint32_t reintentosHttp = 0;
uint32_t respuestasHttp = 0;
uint32_t latenciaHttpAcumuladaMs = 0;

IPAddress ipPc;
uint16_t puertoHttpPc = 0;
uint32_t venceDestinoPcMs = 0;
uint32_t ultimoAnuncioMs = 0;
uint32_t ultimoReporteMs = 0;
uint32_t sesionGateway = 0;
bool radioLista = false;

// Inserta solo mensajes de registro de nodo desde el callback de ESP-NOW.
void encolarControl(const EventoControl &evento) {
  portENTER_CRITICAL(&mutexColaControl);
  const uint8_t siguiente = (indiceEscrituraControl + 1) % CAPACIDAD_COLA_CONTROL;
  if (siguiente == indiceLecturaControl) {
    ++descartesColaControl;
  } else {
    colaControl[indiceEscrituraControl] = evento;
    indiceEscrituraControl = siguiente;
  }
  portEXIT_CRITICAL(&mutexColaControl);
}

bool sacarControl(EventoControl &evento) {
  bool hayEvento = false;
  portENTER_CRITICAL(&mutexColaControl);
  if (indiceLecturaControl != indiceEscrituraControl) {
    evento = colaControl[indiceLecturaControl];
    indiceLecturaControl = (indiceLecturaControl + 1) % CAPACIDAD_COLA_CONTROL;
    hayEvento = true;
  }
  portEXIT_CRITICAL(&mutexColaControl);
  return hayEvento;
}

// Inserta telemetría sin procesarla; la validación y HTTP ocurren en loop.
void encolarRegistro(const EventoRegistro &evento) {
  portENTER_CRITICAL(&mutexColaRegistros);
  const uint8_t siguiente = (indiceEscrituraRegistros + 1) % CAPACIDAD_COLA_REGISTROS;
  if (siguiente == indiceLecturaRegistros) {
    ++descartesColaRegistros;
  } else {
    colaRegistros[indiceEscrituraRegistros] = evento;
    indiceEscrituraRegistros = siguiente;
  }
  portEXIT_CRITICAL(&mutexColaRegistros);
}

bool sacarRegistro(EventoRegistro &evento) {
  bool hayEvento = false;
  portENTER_CRITICAL(&mutexColaRegistros);
  if (indiceLecturaRegistros != indiceEscrituraRegistros) {
    evento = colaRegistros[indiceLecturaRegistros];
    indiceLecturaRegistros = (indiceLecturaRegistros + 1) % CAPACIDAD_COLA_REGISTROS;
    hayEvento = true;
  }
  portEXIT_CRITICAL(&mutexColaRegistros);
  return hayEvento;
}

void alRecibir(const esp_now_recv_info_t *info, const uint8_t *datos, int longitud) {
  if (esPaqueteValido(datos, longitud, TipoPaquete::REGISTRO_NODO,
                      sizeof(PaqueteRegistroNodo))) {
    EventoControl evento = {};
    copiarMac(evento.mac_origen, info->src_addr);
    memcpy(&evento.registro, datos, sizeof(evento.registro));
    ++controlesRecibidos;
    encolarControl(evento);
    return;
  }

  if (esPaqueteValido(datos, longitud, TipoPaquete::REGISTRO_TORRE,
                      sizeof(PaqueteRegistroTorre))) {
    EventoRegistro evento = {};
    copiarMac(evento.mac_origen, info->src_addr);
    memcpy(&evento.registro, datos, sizeof(evento.registro));
    evento.tiempo_gateway_recepcion_ms = millis();
    ++registrosRecibidos;
    encolarRegistro(evento);
  }
}

bool idEstaOcupado(RolNodo rol, uint8_t id) {
  for (const NodoRegistrado &nodo : nodos) {
    if (nodo.ocupado && nodo.rol == rol && nodo.id == id) return true;
  }
  return false;
}

uint8_t siguienteIdLibre(RolNodo rol) {
  for (uint16_t candidato = 1; candidato < 255; ++candidato) {
    if (!idEstaOcupado(rol, candidato)) return candidato;
  }
  return ID_SIN_ASIGNAR;
}

const NodoRegistrado *buscarNodo(RolNodo rol, const uint8_t *mac) {
  for (const NodoRegistrado &nodo : nodos) {
    if (nodo.ocupado && nodo.rol == rol && macEsIgual(nodo.mac, mac)) return &nodo;
  }
  return nullptr;
}

// Reserva un ID estable mientras el Gateway esté encendido, usando la MAC como identidad.
uint8_t reservarId(const PaqueteRegistroNodo &registro, const uint8_t *macOrigen) {
  const NodoRegistrado *existente = buscarNodo(registro.rol, macOrigen);
  if (existente != nullptr) return existente->id;

  for (NodoRegistrado &nodo : nodos) {
    if (!nodo.ocupado) {
      uint8_t id = registro.id_preferido;
      if (id == ID_SIN_ASIGNAR || idEstaOcupado(registro.rol, id)) {
        id = siguienteIdLibre(registro.rol);
      }
      if (id == ID_SIN_ASIGNAR) return ID_SIN_ASIGNAR;
      nodo.ocupado = true;
      nodo.rol = registro.rol;
      nodo.id = id;
      copiarMac(nodo.mac, macOrigen);
      return id;
    }
  }
  return ID_SIN_ASIGNAR;
}

void procesarRegistroNodo(const EventoControl &evento) {
  const PaqueteRegistroNodo &registro = evento.registro;
  if (!macEsIgual(registro.mac_nodo, evento.mac_origen)) {
    Serial.println("Registro descartado: MAC de payload no coincide");
    return;
  }
  const uint8_t id = reservarId(registro, evento.mac_origen);
  if (id == ID_SIN_ASIGNAR) {
    Serial.println("Sin IDs disponibles para nodo");
    return;
  }
  PaqueteAsignacionId respuesta = {crearEncabezado(TipoPaquete::ASIGNACION_ID),
                                   registro.rol, id, {0}};
  copiarMac(respuesta.mac_destino, evento.mac_origen);
  enviarBroadcast(&respuesta, sizeof(respuesta));
  Serial.printf("Nodo %s asignado ID %u (%s)\n",
                registro.rol == RolNodo::TORRE ? "torre" : "jugador", id,
                macATexto(evento.mac_origen).c_str());
}

void procesarControles() {
  EventoControl evento;
  while (sacarControl(evento)) {
    procesarRegistroNodo(evento);
  }
}

bool registroTorreAutorizado(const EventoRegistro &evento) {
  const PaqueteRegistroTorre &registro = evento.registro;
  const NodoRegistrado *torre = buscarNodo(RolNodo::TORRE, evento.mac_origen);
  return torre != nullptr && torre->id == registro.id_torre &&
         registro.id_torre != ID_SIN_ASIGNAR && registro.id_jugador != ID_SIN_ASIGNAR &&
         registro.sesion_jugador != 0;
}

void anunciarGateway() {
  PaqueteAnuncioGateway paquete = {crearEncabezado(TipoPaquete::ANUNCIO_GATEWAY),
                                   CANAL_ESPNOW, sesionGateway};
  enviarBroadcast(&paquete, sizeof(paquete));
}

void actualizarDestinoPc() {
  const int disponibles = udp.parsePacket();
  if (disponibles <= 0) return;
  char mensaje[64] = {};
  const int leidos = udp.read(mensaje, sizeof(mensaje) - 1);
  if (leidos <= 0) return;
  unsigned int puerto = 0;
  if (sscanf(mensaje, "HEATMAP_PC_V1 %u", &puerto) != 1 || puerto > 65535) return;
  ipPc = udp.remoteIP();
  puertoHttpPc = static_cast<uint16_t>(puerto);
  venceDestinoPcMs = millis() + VIGENCIA_DESTINO_PC_MS;
  led.fijo(VERDE);
  Serial.printf("PC descubierta: %s:%u\n", ipPc.toString().c_str(), puertoHttpPc);
}

bool destinoPcDisponible() {
  return puertoHttpPc != 0 && static_cast<int32_t>(venceDestinoPcMs - millis()) > 0;
}

String registroAJson(const EventoRegistro &evento) {
  const PaqueteRegistroTorre &registro = evento.registro;
  char texto[320];
  snprintf(texto, sizeof(texto),
           "{\"sesion_gateway\":%lu,\"tiempo_gateway_recepcion_ms\":%lu,\"tiempo_torre_ms\":%lu,\"torre_id\":%u,\"mac_torre\":\"%02X:%02X:%02X:%02X:%02X:%02X\",\"jugador_id\":%u,\"sesion_jugador\":%lu,\"secuencia\":%lu,\"rssi\":%d}",
           static_cast<unsigned long>(sesionGateway),
           static_cast<unsigned long>(evento.tiempo_gateway_recepcion_ms),
           static_cast<unsigned long>(registro.tiempo_torre_ms), registro.id_torre,
           evento.mac_origen[0], evento.mac_origen[1], evento.mac_origen[2],
           evento.mac_origen[3], evento.mac_origen[4], evento.mac_origen[5],
           registro.id_jugador, static_cast<unsigned long>(registro.sesion_jugador),
           static_cast<unsigned long>(registro.secuencia), registro.rssi);
  return String(texto);
}

void completarLotePendiente() {
  if (cantidadLotePendiente != 0) return;
  EventoRegistro evento;
  while (cantidadLotePendiente < TAMANO_LOTE_HTTP && sacarRegistro(evento)) {
    if (!registroTorreAutorizado(evento)) {
      ++registrosDescartadosValidacion;
      continue;
    }
    lotePendiente[cantidadLotePendiente++] = evento;
  }
}

uint32_t esperaReintentoMs(uint8_t reintentos) {
  const uint8_t exponente = min<uint8_t>(reintentos - 1, 4);
  const uint32_t espera = INTERVALO_REINTENTO_HTTP_MS * (1UL << exponente);
  return min<uint32_t>(espera, INTERVALO_REINTENTO_HTTP_MAX_MS);
}

bool esHoraDeReintentar(uint32_t ahora) {
  return static_cast<int32_t>(ahora - proximoIntentoHttpMs) >= 0;
}

void descartarLotePendiente() {
  registrosDescartadosEntrega += cantidadLotePendiente;
  cantidadLotePendiente = 0;
  reintentosLotePendiente = 0;
  proximoIntentoHttpMs = 0;
}

// Conserva el lote hasta recibir respuesta HTTP 2xx o agotar sus reintentos.
void enviarLotePendiente() {
  if (!destinoPcDisponible()) return;
  completarLotePendiente();
  if (cantidadLotePendiente == 0 || !esHoraDeReintentar(millis())) return;

  String cuerpo = "[";
  for (uint8_t i = 0; i < cantidadLotePendiente; ++i) {
    if (i > 0) cuerpo += ',';
    cuerpo += registroAJson(lotePendiente[i]);
  }
  cuerpo += ']';

  HTTPClient cliente;
  const String url = "http://" + ipPc.toString() + ":" + String(puertoHttpPc) + "/v1/registros";
  cliente.setConnectTimeout(TIEMPO_ESPERA_HTTP_MS);
  cliente.setTimeout(TIEMPO_ESPERA_HTTP_MS);
  cliente.begin(url);
  cliente.addHeader("Content-Type", "application/json");
  const uint32_t inicioHttpMs = millis();
  const int estado = cliente.POST(cuerpo);
  latenciaHttpAcumuladaMs += millis() - inicioHttpMs;
  ++respuestasHttp;
  cliente.end();
  if (estado >= 200 && estado < 300) {
    registrosEnviados += cantidadLotePendiente;
    cantidadLotePendiente = 0;
    reintentosLotePendiente = 0;
    proximoIntentoHttpMs = 0;
    return;
  }

  ++fallosHttp;
  ++reintentosLotePendiente;
  ++reintentosHttp;
  if (reintentosLotePendiente >= MAXIMO_REINTENTOS_HTTP) {
    Serial.printf("HTTP descartó lote tras %u reintentos, estado=%d\n",
                  reintentosLotePendiente, estado);
    descartarLotePendiente();
    return;
  }
  proximoIntentoHttpMs = millis() + esperaReintentoMs(reintentosLotePendiente);
  Serial.printf("HTTP falló, estado=%d; reintento %u programado\n", estado,
                reintentosLotePendiente);
}

void setup() {
  Serial.begin(115200);
  led.iniciar();
  led.intermitente(AMARILLO, 400);
  sesionGateway = esp_random();
  if (sesionGateway == 0) sesionGateway = 1;
  WiFi.mode(WIFI_AP);
  if (!WiFi.softAP(NOMBRE_RED, CLAVE_RED, CANAL_ESPNOW)) {
    led.intermitente(ROJO, 200);
    return;
  }
  radioLista = inicializarEspNow(WIFI_IF_AP);
  if (!radioLista || esp_now_register_recv_cb(alRecibir) != ESP_OK ||
      !udp.begin(PUERTO_DESCUBRIMIENTO_UDP)) {
    led.intermitente(ROJO, 200);
    return;
  }
  led.fijo(CIAN);
  Serial.printf("Gateway listo. AP %s en %s; sesión=%lu\n", NOMBRE_RED,
                WiFi.softAPIP().toString().c_str(), static_cast<unsigned long>(sesionGateway));
}

void loop() {
  led.actualizar();
  if (!radioLista) return;
  actualizarDestinoPc();
  procesarControles();
  const uint32_t ahora = millis();
  if (ahora - ultimoAnuncioMs >= INTERVALO_ANUNCIO_GATEWAY_MS) {
    ultimoAnuncioMs = ahora;
    anunciarGateway();
  }
  enviarLotePendiente();
  if (ahora - ultimoReporteMs >= 5000) {
    ultimoReporteMs = ahora;
    Serial.printf(
        "Gateway: control=%lu datos=%lu enviados=%lu descartes_control=%lu "
        "descartes_datos=%lu inválidos=%lu descartes_entrega=%lu fallos_http=%lu "
        "reintentos=%lu latencia_http_media_ms=%lu destino_pc=%s\n",
        static_cast<unsigned long>(controlesRecibidos),
        static_cast<unsigned long>(registrosRecibidos),
        static_cast<unsigned long>(registrosEnviados),
        static_cast<unsigned long>(descartesColaControl),
        static_cast<unsigned long>(descartesColaRegistros),
        static_cast<unsigned long>(registrosDescartadosValidacion),
        static_cast<unsigned long>(registrosDescartadosEntrega),
        static_cast<unsigned long>(fallosHttp), static_cast<unsigned long>(reintentosHttp),
        respuestasHttp == 0 ? 0UL
                            : static_cast<unsigned long>(latenciaHttpAcumuladaMs / respuestasHttp),
        destinoPcDisponible() ? "si" : "no");
  }
}

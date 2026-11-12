#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiUdp.h>

#include "config.h"
#include "ControlCaptura.h"
#include "../Comun/IdeaBoard.h"
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
uint8_t indiceLecturaControl = 0;
uint8_t indiceEscrituraControl = 0;
uint32_t descartesColaControl = 0;
portMUX_TYPE mutexColaControl = portMUX_INITIALIZER_UNLOCKED;

EventoRegistro colaRegistros[CAPACIDAD_COLA_REGISTROS];
uint8_t indiceLecturaRegistros = 0;
uint8_t indiceEscrituraRegistros = 0;
uint32_t descartesColaRegistros = 0;
uint32_t descartesInactivos = 0;
uint32_t registrosPurgados = 0;
ControlCaptura controlCaptura;
portMUX_TYPE mutexColaRegistros = portMUX_INITIALIZER_UNLOCKED;

EventoRegistro lotePendiente[TAMANO_LOTE_HTTP];
uint8_t cantidadLotePendiente = 0;
uint8_t reintentosLotePendiente = 0;
uint32_t proximoIntentoHttpMs = 0;

uint32_t controlesRecibidos = 0;
uint32_t registrosRecibidos = 0;
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
uint32_t ultimoAnuncioRadioMs = 0;
uint32_t proximoInicioServiciosMs = 0;
uint32_t ultimoReporteMs = 0;
uint32_t sesionGateway = 0;
bool radioLista = false;
bool wifiConectada = false;
bool udpLista = false;
uint8_t canalRadioActual = 0;
uint32_t ultimoIntentoWifiMs = 0;

// Inserta solo mensajes de registro de nodo desde el callback de ESP-NOW.
void encolarControl(const EventoControl &evento) {
  portENTER_CRITICAL(&mutexColaControl);
  ++controlesRecibidos;
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
  ++registrosRecibidos;
  if (!controlCaptura.activa(millis())) {
    ++descartesInactivos;
    portEXIT_CRITICAL(&mutexColaRegistros);
    return;
  }
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
    encolarControl(evento);
    return;
  }

  if (esPaqueteValido(datos, longitud, TipoPaquete::REGISTRO_TORRE,
                      sizeof(PaqueteRegistroTorre))) {
    EventoRegistro evento = {};
    copiarMac(evento.mac_origen, info->src_addr);
    memcpy(&evento.registro, datos, sizeof(evento.registro));
    evento.tiempo_gateway_recepcion_ms = millis();
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
         registro.sesion_torre != 0 && registro.secuencia_torre_tx != 0 &&
         registro.sesion_jugador != 0;
}

void anunciarGateway() {
  PaqueteAnuncioGateway paquete = {crearEncabezado(TipoPaquete::ANUNCIO_GATEWAY),
                                   canalRadioActual, sesionGateway};
  enviarBroadcast(&paquete, sizeof(paquete));
}

// Vacía telemetría y lote; nunca modifica la cola de registro de nodos.
void limpiarCaptura(bool cerrar) {
  portENTER_CRITICAL(&mutexColaRegistros);
  if (cerrar) controlCaptura.cerrar();
  registrosPurgados += (indiceEscrituraRegistros + CAPACIDAD_COLA_REGISTROS -
                       indiceLecturaRegistros) % CAPACIDAD_COLA_REGISTROS;
  indiceLecturaRegistros = 0;
  indiceEscrituraRegistros = 0;
  portEXIT_CRITICAL(&mutexColaRegistros);
  registrosPurgados += cantidadLotePendiente;
  cantidadLotePendiente = 0;
  reintentosLotePendiente = 0;
  proximoIntentoHttpMs = 0;
}

// Anuncia presencia y capacidad de captura al broadcast calculado por DHCP.
void anunciarGatewayPc() {
  uint32_t recibidos = 0;
  uint32_t inactivos = 0;
  portENTER_CRITICAL(&mutexColaRegistros);
  recibidos = registrosRecibidos;
  inactivos = descartesInactivos;
  portEXIT_CRITICAL(&mutexColaRegistros);
  const bool pcConfirmada = static_cast<int32_t>(venceDestinoPcMs - millis()) > 0;
  char mensaje[640];
  snprintf(mensaje, sizeof(mensaje),
           "HEATMAP_GATEWAY_V1 {\"mac\":\"%s\",\"sesion\":%lu,\"canal\":%u,"
           "\"uptimeMs\":%lu,\"registrosRecibidos\":%lu,\"registrosEnviados\":%lu,"
           "\"fallosHttp\":%lu,\"pcConfirmada\":%s,\"controlCaptura\":1,"
           "\"revisionControl\":%llu,\"capturaId\":\"%s\",\"capturando\":%s,"
           "\"descartesInactivos\":%lu,\"registrosPurgados\":%lu}",
           WiFi.macAddress().c_str(), static_cast<unsigned long>(sesionGateway),
           WiFi.channel(), static_cast<unsigned long>(millis()),
           static_cast<unsigned long>(recibidos), static_cast<unsigned long>(registrosEnviados),
           static_cast<unsigned long>(fallosHttp), pcConfirmada ? "true" : "false",
           static_cast<unsigned long long>(controlCaptura.revision()), controlCaptura.id(),
           controlCaptura.activa(millis()) ? "true" : "false",
           static_cast<unsigned long>(inactivos), static_cast<unsigned long>(registrosPurgados));
  if (!udp.beginPacket(WiFi.broadcastIP(), PUERTO_DESCUBRIMIENTO_UDP)) return;
  udp.write(reinterpret_cast<const uint8_t *>(mensaje), strlen(mensaje));
  if (!udp.endPacket()) Serial.println("No se pudo enviar el anuncio UDP del Gateway");
}

// Sólo acepta control V3 de la PC del hotspot y de esta sesión de Gateway.
void actualizarDestinoPc() {
  const int disponibles = udp.parsePacket();
  if (disponibles <= 0) return;
  if (udp.remoteIP() != WiFi.gatewayIP() || disponibles >= 192) {
    udp.flush();
    return;
  }
  char mensaje[192] = {};
  if (udp.read(mensaje, sizeof(mensaje) - 1) <= 0) return;
  unsigned long sesion = 0;
  unsigned long long revision = 0;
  unsigned int puerto = 0;
  char id[37] = {};
  int final = 0;
  if (sscanf(mensaje, "HEATMAP_PC_V3 %lu %llu %36s %u %n", &sesion, &revision,
             id, &puerto, &final) != 4 || final == 0 || mensaje[final] != '\0' ||
      sesion != static_cast<unsigned long>(sesionGateway) || puerto > 65535) return;
  portENTER_CRITICAL(&mutexColaRegistros);
  const ControlCaptura::Resultado resultado = controlCaptura.ordenar(revision, id, puerto, millis());
  if (resultado == ControlCaptura::NUEVA) {
    // El callback usa el mismo bloqueo: no puede encolar entre limpieza y apertura.
    registrosPurgados += (indiceEscrituraRegistros + CAPACIDAD_COLA_REGISTROS -
                         indiceLecturaRegistros) % CAPACIDAD_COLA_REGISTROS;
    indiceLecturaRegistros = 0;
    indiceEscrituraRegistros = 0;
  }
  portEXIT_CRITICAL(&mutexColaRegistros);
  if (resultado == ControlCaptura::IGNORADA) return;
  if (resultado == ControlCaptura::NUEVA) {
    registrosPurgados += cantidadLotePendiente;
    cantidadLotePendiente = 0;
    reintentosLotePendiente = 0;
    proximoIntentoHttpMs = 0;
    Serial.printf("Control captura: revision=%llu id=%s puerto=%u; cola y lote limpios\n",
                  revision, id, puerto);
  }
  ipPc = udp.remoteIP();
  puertoHttpPc = controlCaptura.puerto(millis());
  venceDestinoPcMs = millis() + VIGENCIA_DESTINO_PC_MS;
  led.fijo(VERDE);
  led.latido(250);
  char confirmacion[128];
  snprintf(confirmacion, sizeof(confirmacion), "HEATMAP_ACK_V3 %lu %llu %s %u",
           static_cast<unsigned long>(sesionGateway),
           static_cast<unsigned long long>(controlCaptura.revision()),
           controlCaptura.id(), puertoHttpPc);
  if (udp.beginPacket(ipPc, udp.remotePort())) {
    udp.write(reinterpret_cast<const uint8_t *>(confirmacion), strlen(confirmacion));
    udp.endPacket();
  }
}

bool destinoPcDisponible() {
  return wifiConectada && udpLista && WiFi.status() == WL_CONNECTED &&
         controlCaptura.activa(millis()) && puertoHttpPc != 0 &&
         static_cast<int32_t>(venceDestinoPcMs - millis()) > 0;
}

void conectarWifiPc() {
  ultimoIntentoWifiMs = millis();
  WiFi.begin(NOMBRE_RED, CLAVE_RED);
  Serial.printf("Conectando al hotspot de la PC: %s (canal automático)\n", NOMBRE_RED);
}

// El driver sigue al AP; ESP-NOW usa ese mismo canal mediante peers con canal 0.
// Una pérdida de Wi-Fi cierra la autorización (la PC la recupera para el mismo
// CSV con una revisión nueva). Un cambio de canal sin
// desconexión sólo purga telemetría pendiente y conserva la autorización vigente.
bool actualizarConexionWifi() {
  const uint32_t ahora = millis();
  if (WiFi.status() != WL_CONNECTED) {
    if (wifiConectada) {
      limpiarCaptura(true);
      wifiConectada = false;
      udpLista = false;
      canalRadioActual = 0;
      puertoHttpPc = 0;
      venceDestinoPcMs = 0;
      udp.stop();
      led.intermitente(AMARILLO, 400);
      Serial.println("Hotspot de la PC desconectado; buscando automáticamente su canal");
    }
    if (ahora - ultimoIntentoWifiMs >= INTERVALO_RECONEXION_WIFI_MS) {
      WiFi.disconnect();
      conectarWifiPc();
    }
    return false;
  }

  const uint8_t canalActual = WiFi.channel();
  if (!wifiConectada) {
    wifiConectada = true;
    canalRadioActual = canalActual;
    proximoInicioServiciosMs = ahora;
    // No responde a registros que hayan quedado de antes de la desconexión.
    portENTER_CRITICAL(&mutexColaControl);
    indiceLecturaControl = indiceEscrituraControl = 0;
    portEXIT_CRITICAL(&mutexColaControl);
    Serial.printf("Wi-Fi PC conectado: IP=%s canal=%u (automático)\n",
                  WiFi.localIP().toString().c_str(), canalActual);
  } else if (canalActual != canalRadioActual) {
    const uint8_t anterior = canalRadioActual;
    limpiarCaptura(false);
    canalRadioActual = canalActual;
    ultimoAnuncioRadioMs = ahora - INTERVALO_ANUNCIO_RADIO_MS;
    ultimoAnuncioMs = ahora - INTERVALO_ANUNCIO_GATEWAY_MS;
    Serial.printf("Hotspot cambió de canal: %u -> %u; ESP-NOW actualizado, anunciando a los nodos\n",
                  anterior, canalActual);
  }

  if ((!radioLista || !udpLista) && static_cast<int32_t>(ahora - proximoInicioServiciosMs) >= 0) {
    proximoInicioServiciosMs = ahora + 2000;
    if (!radioLista) {
      radioLista = inicializarEspNow(WIFI_IF_STA) &&
                   esp_now_register_recv_cb(alRecibir) == ESP_OK;
      if (!radioLista) esp_now_deinit();
    }
    if (radioLista && !udpLista) udpLista = udp.begin(PUERTO_DESCUBRIMIENTO_UDP);
    if (!radioLista || !udpLista) {
      led.intermitente(ROJO, 200);
      Serial.println("No se pudo iniciar ESP-NOW o UDP; se reintentará automáticamente");
    } else {
      led.fijo(VERDE);
      ultimoAnuncioRadioMs = ahora - INTERVALO_ANUNCIO_RADIO_MS;
      ultimoAnuncioMs = ahora - INTERVALO_ANUNCIO_GATEWAY_MS;
      Serial.printf("Gateway listo; UDP en %s:%u; sesión=%lu; canal=%u\n",
                    WiFi.broadcastIP().toString().c_str(), PUERTO_DESCUBRIMIENTO_UDP,
                    static_cast<unsigned long>(sesionGateway), canalRadioActual);
    }
  }
  return radioLista && udpLista;
}

String registroAJson(const EventoRegistro &evento) {
  const PaqueteRegistroTorre &registro = evento.registro;
  char texto[384];
  snprintf(texto, sizeof(texto),
           "{\"sesion_gateway\":%lu,\"tiempo_gateway_recepcion_ms\":%lu,\"tiempo_torre_ms\":%lu,\"torre_id\":%u,\"sesion_torre\":%lu,\"secuencia_torre_tx\":%lu,\"mac_torre\":\"%02X:%02X:%02X:%02X:%02X:%02X\",\"jugador_id\":%u,\"sesion_jugador\":%lu,\"secuencia\":%lu,\"rssi\":%d,\"movimiento\":%u}",
           static_cast<unsigned long>(sesionGateway),
           static_cast<unsigned long>(evento.tiempo_gateway_recepcion_ms),
           static_cast<unsigned long>(registro.tiempo_torre_ms), registro.id_torre,
           static_cast<unsigned long>(registro.sesion_torre),
           static_cast<unsigned long>(registro.secuencia_torre_tx),
           evento.mac_origen[0], evento.mac_origen[1], evento.mac_origen[2],
           evento.mac_origen[3], evento.mac_origen[4], evento.mac_origen[5],
           registro.id_jugador, static_cast<unsigned long>(registro.sesion_jugador),
           static_cast<unsigned long>(registro.secuencia), registro.rssi, registro.movimiento);
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
  cliente.addHeader("X-Heatmap-Captura", controlCaptura.id());
  const uint32_t inicioHttpMs = millis();
  const int estado = cliente.POST(cuerpo);
  latenciaHttpAcumuladaMs += millis() - inicioHttpMs;
  ++respuestasHttp;
  cliente.end();
  if (estado >= 200 && estado < 300) {
    led.latido(250);
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
  apagarDriverMotores();
  led.iniciar();
  led.intermitente(AMARILLO, 400);
  sesionGateway = esp_random();
  if (sesionGateway == 0) sesionGateway = 1;
  if (!WiFi.mode(WIFI_STA)) {
    led.intermitente(ROJO, 200);
    return;
  }
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(false);  // Los reintentos se controlan desde loop.
  conectarWifiPc();
}

void loop() {
  led.actualizar();
  if (!actualizarConexionWifi()) {
    limpiarCaptura(true);
    if (WiFi.status() == WL_CONNECTED && millis() - ultimoReporteMs >= 5000) {
      ultimoReporteMs = millis();
      Serial.printf("Gateway: canal_wifi=%u radio=%s udp=%s\n",
                    static_cast<unsigned int>(WiFi.channel()), radioLista ? "lista" : "no lista",
                    udpLista ? "listo" : "no listo");
    }
    return;
  }
  if (!controlCaptura.activa(millis())) limpiarCaptura(true);
  actualizarDestinoPc();
  procesarControles();
  const uint32_t ahora = millis();
  if (ahora - ultimoAnuncioRadioMs >= INTERVALO_ANUNCIO_RADIO_MS) {
    ultimoAnuncioRadioMs = ahora;
    anunciarGateway();
  }
  if (ahora - ultimoAnuncioMs >= INTERVALO_ANUNCIO_GATEWAY_MS) {
    ultimoAnuncioMs = ahora;
    anunciarGatewayPc();
  }
  enviarLotePendiente();
  if (ahora - ultimoReporteMs >= 5000) {
    ultimoReporteMs = ahora;
    uint32_t controles = 0;
    uint32_t datos = 0;
    uint32_t descartesControl = 0;
    uint32_t descartesDatos = 0;
    uint32_t inactivos = 0;
    portENTER_CRITICAL(&mutexColaControl);
    controles = controlesRecibidos;
    descartesControl = descartesColaControl;
    portEXIT_CRITICAL(&mutexColaControl);
    portENTER_CRITICAL(&mutexColaRegistros);
    datos = registrosRecibidos;
    descartesDatos = descartesColaRegistros;
    inactivos = descartesInactivos;
    portEXIT_CRITICAL(&mutexColaRegistros);
    Serial.printf(
        "Gateway: control=%lu datos=%lu enviados=%lu descartes_control=%lu "
        "descartes_datos=%lu inválidos=%lu descartes_entrega=%lu fallos_http=%lu "
        "reintentos=%lu latencia_http_media_ms=%lu canal_wifi=%u destino_pc=%s "
        "descartes_inactivos=%lu purgados=%lu captura=%s\n",
        static_cast<unsigned long>(controles),
        static_cast<unsigned long>(datos),
        static_cast<unsigned long>(registrosEnviados),
        static_cast<unsigned long>(descartesControl),
        static_cast<unsigned long>(descartesDatos),
        static_cast<unsigned long>(registrosDescartadosValidacion),
        static_cast<unsigned long>(registrosDescartadosEntrega),
        static_cast<unsigned long>(fallosHttp), static_cast<unsigned long>(reintentosHttp),
        respuestasHttp == 0 ? 0UL
                            : static_cast<unsigned long>(latenciaHttpAcumuladaMs / respuestasHttp),
        static_cast<unsigned int>(WiFi.channel()),
        destinoPcDisponible() ? "si" : "no",
        static_cast<unsigned long>(inactivos), static_cast<unsigned long>(registrosPurgados),
        controlCaptura.id());
  }
}

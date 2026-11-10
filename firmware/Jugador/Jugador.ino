#include "config.h"
#include <esp_mac.h>
#include <esp_system.h>
#include <Wire.h>
#include <math.h>
#include "../Comun/IdeaBoard.h"
#include "../Comun/LedEstado.h"
#include "../Comun/Paquete.h"
#include "../Comun/RadioComun.h"
#include "SensoresJugador.h"

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
bool mpuDisponible = false;
bool enMovimiento = false;
EstadoTarjeta estadoTarjeta = {!SENSOR_LIGHT_BLOCKING_PRESENTE, false, 0};
uint32_t ultimoMuestreoMpuMs = 0;
uint32_t ultimaImpresionMpuMs = 0;
float variacionFiltrada = 0.0f;
float aceleracionAnterior[3] = {};
bool aceleracionAnteriorLista = false;
int ultimoNivelTarjeta = -1;
uint32_t ultimoDiagnosticoTarjetaMs = 0;
int nivelTarjetaCandidato = -1;
int nivelTarjetaEstable = -1;
uint32_t inicioNivelCandidatoMs = 0;
bool ledTarjetaPausada = SENSOR_LIGHT_BLOCKING_PRESENTE;
bool ledJugadorListo = false;

bool leerRegistroMpu(uint8_t registro, uint8_t *datos, size_t cantidad) {
  Wire.beginTransmission(DIRECCION_MPU6050);
  Wire.write(registro);
  if (Wire.endTransmission(false) != 0 || Wire.requestFrom(DIRECCION_MPU6050, cantidad) != cantidad) return false;
  for (size_t i=0; i<cantidad; ++i) datos[i]=Wire.read();
  return true;
}

void actualizarTarjeta(uint32_t ahora) {
  if (!SENSOR_LIGHT_BLOCKING_PRESENTE) {
    estadoTarjeta.transmitir = true;
    return;
  }
  const int nivel = digitalRead(PIN_LIGHT_BLOCKING);
  if (nivel != nivelTarjetaCandidato) {
    nivelTarjetaCandidato = nivel;
    inicioNivelCandidatoMs = ahora;
  }
  if (nivelTarjetaEstable != nivelTarjetaCandidato &&
      ahora - inicioNivelCandidatoMs >= ESTABILIZACION_LIGHT_BLOCKING_MS) {
    nivelTarjetaEstable = nivelTarjetaCandidato;
  }
  const bool presente = nivelTarjetaEstable != -1 &&
      ((nivelTarjetaEstable == HIGH) == LIGHT_BLOCKING_TARJETA_PRESENTE_ALTO);
  const CambioTarjeta cambio = actualizarEstadoTarjeta(
      estadoTarjeta, presente, ahora, RETARDO_ELIMINACION_TARJETA_MS);
  if (nivel != ultimoNivelTarjeta || ahora - ultimoDiagnosticoTarjetaMs >= 2000) {
    ultimoNivelTarjeta = nivel;
    ultimoDiagnosticoTarjetaMs = ahora;
    Serial.printf("Tarjeta: GPIO%u=%s, estable=%s, %s, beacons=%s, ID=%u, radio=%s\n",
                  PIN_LIGHT_BLOCKING, nivel == HIGH ? "HIGH" : "LOW",
                  nivelTarjetaEstable == -1 ? "sin confirmar" :
                    (nivelTarjetaEstable == HIGH ? "HIGH" : "LOW"),
                  presente ? "presente" : "ausente",
                  estadoTarjeta.transmitir ? "activos" : "pausados",
                  idJugador, radioLista ? "lista" : "no lista");
  }
  if (cambio == CambioTarjeta::REANUDAR) {
    Serial.println("Tarjeta reinsertada: beacons reanudados");
  }
  if (cambio == CambioTarjeta::PAUSAR) {
    Serial.println("Tarjeta ausente: beacons pausados; jugador sigue registrado");
  }
}

// Reconcilia el patrón base con la admisión real de beacons. Solo cambia el
// patrón cuando cambia el estado, para no tapar los pulsos verdes de envío.
void actualizarLedJugador() {
  if (!estadoTarjeta.transmitir) {
    if (!ledTarjetaPausada) {
      led.intermitente(ROJO, 500);
      ledTarjetaPausada = true;
      ledJugadorListo = false;
    }
  } else if (idJugador != ID_SIN_ASIGNAR && !ledJugadorListo) {
    led.fijo(AZUL);
    ledJugadorListo = true;
    ledTarjetaPausada = false;
  }
}

void actualizarMpu(uint32_t ahora) {
  if (!mpuDisponible || ahora-ultimoMuestreoMpuMs < INTERVALO_MUESTREO_MPU_MS) return;
  ultimoMuestreoMpuMs=ahora;
  uint8_t datos[6];
  if (!leerRegistroMpu(0x3B,datos,sizeof(datos))) {
    mpuDisponible=false;
    enMovimiento=false;
    Serial.println("MPU6050: se perdió la comunicación; movimiento no disponible");
    return;
  }
  float a[3];
  for (int i=0;i<3;++i) { int16_t bruto=(int16_t)((datos[2*i]<<8)|datos[2*i+1]); a[i]=bruto/16384.0f; }
  if (aceleracionAnteriorLista) {
    float suma=0;
    for (int i=0;i<3;++i) { float d=a[i]-aceleracionAnterior[i]; suma+=d*d; aceleracionAnterior[i]=a[i]; }
    float magnitud=sqrtf(suma);
    variacionFiltrada = filtrarVariacion(variacionFiltrada,magnitud,FACTOR_FILTRO_MPU);
    enMovimiento=clasificarMovimiento(variacionFiltrada,UMBRAL_MOVIMIENTO_MPU);
  } else { memcpy(aceleracionAnterior,a,sizeof(a)); aceleracionAnteriorLista=true; }

  // Mostrar el valor filtrado para poder evaluar el umbral durante las pruebas.
  if (ahora - ultimaImpresionMpuMs >= 1000) {
    ultimaImpresionMpuMs = ahora;
    Serial.printf("MPU6050: %s | x=%.3f g | umbral k=%.3f g\n",
                  enMovimiento ? "Caminando" : "Detenido",
                  variacionFiltrada, UMBRAL_MOVIMIENTO_MPU);
  }
}

// Construye y difunde la telemetría que las torres usan para medir RSSI.
void enviarBeacon() {
  PaqueteBeaconJugador paquete = {crearEncabezado(TipoPaquete::BEACON_JUGADOR),
                                  idJugador, sesionJugador, ++secuencia, millis(), static_cast<uint8_t>(mpuDisponible ? (enMovimiento ? 2 : 1) : 0)};
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
  if (SENSOR_LIGHT_BLOCKING_PRESENTE) { pinMode(PIN_LIGHT_BLOCKING, INPUT_PULLUP); estadoTarjeta.transmitir=false; led.intermitente(ROJO, 500); }
  Wire.begin(PIN_I2C_SDA_MPU, PIN_I2C_SCL_MPU);
  Wire.setTimeOut(TIMEOUT_I2C_MPU_MS);
  Wire.beginTransmission(DIRECCION_MPU6050);
  mpuDisponible = Wire.endTransmission() == 0;
  if (mpuDisponible) { Wire.beginTransmission(DIRECCION_MPU6050); Wire.write(0x6B); Wire.write(0); Wire.endTransmission(); }
  Serial.printf("MPU6050: %s; sensor tarjeta: %s\n", mpuDisponible ? "presente" : "ausente", SENSOR_LIGHT_BLOCKING_PRESENTE ? "habilitado" : "deshabilitado");
  if (mpuDisponible) {
    Serial.printf("Movimiento se reporta cada 1 s; umbral k=%.3f g, filtro alfa=%.2f\n",
                  UMBRAL_MOVIMIENTO_MPU, FACTOR_FILTRO_MPU);
  } else {
    Serial.println("Movimiento: no disponible; el jugador continuará funcionando");
  }
  esp_read_mac(macJugador, ESP_MAC_WIFI_STA);
  sesionJugador = esp_random();
  if (sesionJugador == 0) sesionJugador = 1;
  radioLista = prepararEstacionEnCanal(CANAL_ESPNOW) && inicializarEspNow(WIFI_IF_STA);
  if (!radioLista || esp_now_register_recv_cb(alRecibir) != ESP_OK) {
    led.intermitente(ROJO, 200);
    Serial.println("Error: radio ESP-NOW no disponible; no se pueden enviar beacons");
    return;
  }
  Serial.println("Jugador listo");
}

void loop() {
  led.actualizar();
  if (!radioLista) return;
  const uint32_t ahora = millis();
  actualizarTarjeta(ahora);
  actualizarMpu(ahora);
  if (hayAsignacionPendiente) {
    uint8_t idAsignado = ID_SIN_ASIGNAR;
    portENTER_CRITICAL(&mutexAsignacion);
    idAsignado = asignacionPendiente.id_asignado;
    hayAsignacionPendiente = false;
    portEXIT_CRITICAL(&mutexAsignacion);
    const bool asignacionNueva = idJugador != idAsignado;
    idJugador = idAsignado;
    Serial.printf("ID jugador asignado: %u\n", idJugador);
    if (asignacionNueva) programarProximoBeacon(ahora);
  }
  actualizarLedJugador();
  if (ahora - ultimoRegistroMs >= INTERVALO_REGISTRO_MS) {
    ultimoRegistroMs = ahora;
    PaqueteRegistroNodo paquete = {crearEncabezado(TipoPaquete::REGISTRO_NODO),
                                   RolNodo::JUGADOR, idJugador, {0}};
    copiarMac(paquete.mac_nodo, macJugador);
    enviarBroadcast(&paquete, sizeof(paquete));
  }
  if (estadoTarjeta.transmitir && idJugador != ID_SIN_ASIGNAR &&
      static_cast<int32_t>(ahora - proximoBeaconMs) >= 0) {
    enviarBeacon();
    programarProximoBeacon(ahora);
  }
}

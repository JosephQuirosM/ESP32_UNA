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
#include "../Comun/EnlaceGateway.h"

ControlLed led(PIN_LED_RGB);
constexpr ColorLed ERROR_RADIO_JUGADOR = {180, 0, 255};
EnlaceGateway enlaceGateway(RolNodo::JUGADOR, ESCUCHA_CANAL_MS, VIGENCIA_ANUNCIO_GATEWAY_MS);
uint8_t idJugador = ID_SIN_ASIGNAR;
uint32_t secuencia = 0;
uint32_t sesionJugador = 0;
uint32_t proximoBeaconMs = 0;
uint32_t ultimoRegistroMs = 0;
bool radioLista = false;
uint8_t macJugador[6] = {};
bool envioEnCurso = false;
portMUX_TYPE mutexEnvio = portMUX_INITIALIZER_UNLOCKED;
bool mpuDisponible = false;
bool mpuDetectadoAlgunaVez = false;
bool enMovimiento = false;
EstadoTarjeta estadoTarjeta = {!SENSOR_LIGHT_BLOCKING_PRESENTE, false, 0};
uint32_t ultimoMuestreoMpuMs = 0;
uint32_t ultimoIntentoMpuMs = 0;
uint32_t ultimaImpresionMpuMs = 0;
float variacionFiltrada = 0.0f;
float aceleracionAnterior[3] = {};
bool aceleracionAnteriorLista = false;
bool buzzerDisponible = false;
bool avisoBuzzerActivo = false;
uint32_t inicioAvisoBuzzerMs = 0;
int faseBuzzer = -1;
int ultimoNivelTarjeta = -1;
uint32_t ultimoDiagnosticoTarjetaMs = 0;
int nivelTarjetaCandidato = -1;
int nivelTarjetaEstable = -1;
uint32_t inicioNivelCandidatoMs = 0;
enum class PatronJugador : uint8_t { INICIO, SIN_TARJETA, ESPERANDO_ID, LISTO, MPU_DESCONECTADO };
PatronJugador patronJugador = PatronJugador::INICIO;

bool leerRegistroMpu(uint8_t registro, uint8_t *datos, size_t cantidad) {
  Wire.beginTransmission(DIRECCION_MPU6050);
  Wire.write(registro);
  if (Wire.endTransmission(false) != 0 || Wire.requestFrom(DIRECCION_MPU6050, cantidad) != cantidad) return false;
  for (size_t i=0; i<cantidad; ++i) datos[i]=Wire.read();
  return true;
}

bool iniciarMpu() {
  Wire.beginTransmission(DIRECCION_MPU6050);
  Wire.write(0x6B); // PWR_MGMT_1: salir del modo de suspensión.
  Wire.write(0);
  if (Wire.endTransmission() != 0) return false;
  uint8_t aceleracion[6];
  return leerRegistroMpu(0x3B, aceleracion, sizeof(aceleracion));
}

// Emite tres tonos durante una ventana de cuatro segundos sin detener el loop.
void actualizarBuzzer(uint32_t ahora) {
  if (!avisoBuzzerActivo) return;
  const uint32_t transcurrido = ahora - inicioAvisoBuzzerMs;
  if (transcurrido >= DURACION_AVISO_BUZZER_MS) {
    ledcWriteTone(PIN_BUZZER, 0);
    digitalWrite(PIN_BUZZER, LOW);
    avisoBuzzerActivo = false;
    faseBuzzer = -1;
    return;
  }

  // Tres pitidos de 800 ms separados por pausas de 400 ms; luego queda
  // silencioso hasta completar los cuatro segundos del aviso.
  const bool tono = transcurrido < 800 ||
      (transcurrido >= 1200 && transcurrido < 2000) ||
      (transcurrido >= 2400 && transcurrido < 3200);
  const int nuevaFase = tono ? 1 : 0;
  if (nuevaFase == faseBuzzer) return;
  faseBuzzer = nuevaFase;
  if (tono) ledcWriteTone(PIN_BUZZER, FRECUENCIA_BUZZER_HZ);
  else {
    ledcWriteTone(PIN_BUZZER, 0);
    digitalWrite(PIN_BUZZER, LOW);
  }
}

// Inicia el aviso una sola vez cuando vence el plazo de ausencia de tarjeta.
void iniciarAvisoBuzzer(uint32_t ahora) {
  if (!buzzerDisponible) return;
  inicioAvisoBuzzerMs = ahora;
  avisoBuzzerActivo = true;
  faseBuzzer = -1;
  actualizarBuzzer(ahora);
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
    iniciarAvisoBuzzer(ahora);
  }
}

// Reconcilia el patrón base con la admisión real de beacons. Solo cambia el
// patrón cuando cambia el estado, para no tapar los pulsos verdes de envío.
void actualizarLedJugador() {
  const PatronJugador deseado = mpuDetectadoAlgunaVez && !mpuDisponible
      ? PatronJugador::MPU_DESCONECTADO
      : SENSOR_LIGHT_BLOCKING_PRESENTE && nivelTarjetaEstable == -1
      ? PatronJugador::INICIO
      : !estadoTarjeta.transmitir ? PatronJugador::SIN_TARJETA
      : idJugador == ID_SIN_ASIGNAR ? PatronJugador::ESPERANDO_ID : PatronJugador::LISTO;
  if (deseado == patronJugador) return;
  patronJugador = deseado;
  if (deseado == PatronJugador::SIN_TARJETA) led.intermitente(ROJO, 500);
  else if (deseado == PatronJugador::MPU_DESCONECTADO) led.intermitente(AZUL, 250);
  else if (deseado == PatronJugador::LISTO) led.fijo(VERDE);
  else led.intermitente(AMARILLO, 400);
}

void actualizarMpu(uint32_t ahora) {
  if (!mpuDisponible) {
    if (ahora - ultimoIntentoMpuMs < INTERVALO_RECONEXION_MPU_MS) return;
    ultimoIntentoMpuMs = ahora;
    Wire.end();
    Wire.begin(PIN_I2C_SDA_MPU, PIN_I2C_SCL_MPU);
    Wire.setTimeOut(TIMEOUT_I2C_MPU_MS);
    if (iniciarMpu()) {
      mpuDisponible = true;
      mpuDetectadoAlgunaVez = true;
      aceleracionAnteriorLista = false;
      variacionFiltrada = 0.0f;
      enMovimiento = false;
      ultimoMuestreoMpuMs = ahora;
      Serial.println("MPU6050: comunicación recuperada; movimiento disponible");
    }
    return;
  }
  if (ahora-ultimoMuestreoMpuMs < INTERVALO_MUESTREO_MPU_MS) return;
  ultimoMuestreoMpuMs=ahora;
  uint8_t datos[6];
  if (!leerRegistroMpu(0x3B,datos,sizeof(datos))) {
    mpuDisponible=false;
    enMovimiento=false;
    ultimoIntentoMpuMs = ahora;
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
bool enviarBeacon() {
  PaqueteBeaconJugador paquete = {crearEncabezado(TipoPaquete::BEACON_JUGADOR),
                                  idJugador, sesionJugador, ++secuencia, millis(), static_cast<uint8_t>(mpuDisponible ? (enMovimiento ? 2 : 1) : 0)};
  return enviarPaqueteJugador(&paquete, sizeof(paquete));
}

uint32_t programarProximoBeacon(uint32_t ahora) {
  const uint32_t jitter = esp_random() % (JITTER_BEACON_MAX_MS + 1UL);
  const uint32_t intervalo = INTERVALO_BEACON_MS + jitter;
  proximoBeaconMs = ahora + intervalo;
  return intervalo;
}

// El callback conserva sólo anuncios y asignaciones válidos para este nodo.
void alRecibir(const esp_now_recv_info_t *info, const uint8_t *datos, int longitud) {
  enlaceGateway.recibir(info, datos, longitud);
}

void alEnviar(const esp_now_send_info_t *, esp_now_send_status_t) {
  portENTER_CRITICAL(&mutexEnvio);
  envioEnCurso = false;
  portEXIT_CRITICAL(&mutexEnvio);
}

bool hayEnvioActivo() {
  portENTER_CRITICAL(&mutexEnvio);
  const bool activo = envioEnCurso;
  portEXIT_CRITICAL(&mutexEnvio);
  return activo;
}

// Serializa beacons y registro para no cambiar de canal durante un envío.
bool enviarPaqueteJugador(const void *paquete, size_t longitud) {
  portENTER_CRITICAL(&mutexEnvio);
  if (envioEnCurso) {
    portEXIT_CRITICAL(&mutexEnvio);
    return false;
  }
  envioEnCurso = true;
  portEXIT_CRITICAL(&mutexEnvio);
  if (enviarBroadcast(paquete, longitud)) return true;
  alEnviar(nullptr, ESP_NOW_SEND_FAIL);
  return false;
}

void setup() {
  Serial.begin(115200);
  apagarDriverMotores();
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);
  buzzerDisponible = ledcAttach(PIN_BUZZER, FRECUENCIA_BUZZER_HZ, 8);
  if (!buzzerDisponible) Serial.println("Buzzer: no se pudo iniciar; el jugador continuará normalmente");
  led.iniciar();
  led.intermitente(AMARILLO, 400);
  if (SENSOR_LIGHT_BLOCKING_PRESENTE) { pinMode(PIN_LIGHT_BLOCKING, INPUT_PULLUP); estadoTarjeta.transmitir=false; }
  Wire.begin(PIN_I2C_SDA_MPU, PIN_I2C_SCL_MPU);
  Wire.setTimeOut(TIMEOUT_I2C_MPU_MS);
  mpuDisponible = iniciarMpu();
  mpuDetectadoAlgunaVez = mpuDisponible;
  ultimoIntentoMpuMs = millis();
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
  radioLista = enlaceGateway.iniciar(macJugador) && inicializarEspNow(WIFI_IF_STA);
  if (!radioLista || esp_now_register_recv_cb(alRecibir) != ESP_OK ||
      esp_now_register_send_cb(alEnviar) != ESP_OK) {
    radioLista = false;
    led.intermitente(ERROR_RADIO_JUGADOR, 200);
    Serial.println("Error: radio ESP-NOW no disponible; no se pueden enviar beacons");
    return;
  }
  Serial.println("Jugador listo");
}

void loop() {
  led.actualizar();
  if (!radioLista) return;
  const uint32_t ahora = millis();
  actualizarBuzzer(ahora);
  actualizarTarjeta(ahora);
  actualizarMpu(ahora);
  const auto cambioCanal = enlaceGateway.actualizar(ahora, hayEnvioActivo());
  if (cambioCanal != EstadoCanal::NINGUNO) {
    idJugador = ID_SIN_ASIGNAR;
    // Desfase corto para que los nodos encontrados juntos no se registren a la vez.
    ultimoRegistroMs = ahora - INTERVALO_REGISTRO_MS + esp_random() % 200;
  }
  const uint8_t asignado = enlaceGateway.obtenerAsignacion();
  if (asignado != ID_SIN_ASIGNAR) {
    const bool nueva = idJugador != asignado;
    idJugador = asignado;
    Serial.printf("ID jugador asignado: %u; canal=%u\n", idJugador, enlaceGateway.canal());
    if (nueva) programarProximoBeacon(ahora);
  }
  actualizarLedJugador();
  if (enlaceGateway.encontrado() && !hayEnvioActivo() &&
      ahora - ultimoRegistroMs >= INTERVALO_REGISTRO_MS) {
    ultimoRegistroMs = ahora;
    PaqueteRegistroNodo paquete = {crearEncabezado(TipoPaquete::REGISTRO_NODO),
                                   RolNodo::JUGADOR, idJugador ? idJugador : ID_JUGADOR_RESPALDO, {0}};
    copiarMac(paquete.mac_nodo, macJugador);
    enviarPaqueteJugador(&paquete, sizeof(paquete));
  }
  if (enlaceGateway.encontrado() && !hayEnvioActivo() &&
      estadoTarjeta.transmitir && idJugador != ID_SIN_ASIGNAR &&
      static_cast<int32_t>(ahora - proximoBeaconMs) >= 0) {
    const bool enviado = enviarBeacon();
    const uint32_t intervalo = programarProximoBeacon(ahora);
    if (enviado) led.latido(intervalo);
  }
}

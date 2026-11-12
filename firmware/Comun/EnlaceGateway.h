#pragma once

#include "EstadoCanal.h"
#include "Paquete.h"
#include "RadioComun.h"

// Descubrimiento común a jugador y torre. Los callbacks sólo copian control;
// la selección del canal y el procesamiento del estado se hacen desde loop.
class EnlaceGateway {
 public:
  EnlaceGateway(RolNodo rol, uint32_t escuchaMs, uint32_t vigenciaMs)
      : estado_(escuchaMs, vigenciaMs), rol_(rol) {}

  bool iniciar(const uint8_t *mac) {
    copiarMac(macNodo_, mac);
    if (!WiFi.mode(WIFI_STA)) return false;
    WiFi.setAutoReconnect(false);
    WiFi.disconnect();
    WiFi.setSleep(false);
    wifi_country_t pais = {};
    if (esp_wifi_get_country(&pais) != ESP_OK || pais.nchan == 0) return false;
    const uint8_t ultimo = pais.schan + pais.nchan - 1;
    // Este proyecto usa ESP-NOW de 2,4 GHz y los canales admitidos por el driver.
    if (pais.schan < 1 || ultimo > 13) return false;
    estado_.iniciar(pais.schan, ultimo, millis());
    Serial.printf("Buscando Gateway en canales %u..%u; inicio=%u\n",
                  pais.schan, ultimo, estado_.canal());
    return esp_wifi_set_channel(estado_.canal(), WIFI_SECOND_CHAN_NONE) == ESP_OK;
  }

  bool recibir(const esp_now_recv_info_t *info, const uint8_t *datos, int longitud) {
    if (!info || !info->rx_ctrl) return false;
    if (esPaqueteValido(datos, longitud, TipoPaquete::ANUNCIO_GATEWAY,
                       sizeof(PaqueteAnuncioGateway))) {
      PaqueteAnuncioGateway paquete;
      memcpy(&paquete, datos, sizeof(paquete));
      portENTER_CRITICAL(&mutex_);
      if (paquete.sesion_gateway != 0 && paquete.canal == info->rx_ctrl->channel &&
          paquete.canal == estado_.canal() && estado_.aceptaMac(info->src_addr)) {
        anuncio_ = paquete;
        copiarMac(origenAnuncio_, info->src_addr);
        recibidoMs_ = millis();
        hayAnuncio_ = true;
      }
      portEXIT_CRITICAL(&mutex_);
      return true;
    }
    if (esPaqueteValido(datos, longitud, TipoPaquete::ASIGNACION_ID,
                       sizeof(PaqueteAsignacionId))) {
      PaqueteAsignacionId paquete;
      memcpy(&paquete, datos, sizeof(paquete));
      portENTER_CRITICAL(&mutex_);
      if (estado_.encontrado() && estado_.aceptaMac(info->src_addr) &&
          estado_.canal() == info->rx_ctrl->channel && paquete.rol == rol_ &&
          paquete.id_asignado != ID_SIN_ASIGNAR && macEsIgual(paquete.mac_destino, macNodo_)) {
        idPendiente_ = paquete.id_asignado;
      }
      portEXIT_CRITICAL(&mutex_);
      return true;
    }
    return false;
  }

  // Nunca mueve el canal mientras hay una transmisión esperando su callback.
  EstadoCanal::Cambio actualizar(uint32_t ahora, bool envioEnCurso) {
    portENTER_CRITICAL(&mutex_);
    // El callback pudo recibir durante la lectura de sensores de este loop.
    ahora = millis();
    EstadoCanal::Cambio cambio = EstadoCanal::NINGUNO;
    if (hayAnuncio_) {
      hayAnuncio_ = false;
      cambio = estado_.anunciar(origenAnuncio_, anuncio_.canal,
                                anuncio_.sesion_gateway, recibidoMs_, ahora);
    }
    const auto vencimiento = estado_.actualizar(ahora);
    if (vencimiento != EstadoCanal::NINGUNO) cambio = vencimiento;
    if (cambio != EstadoCanal::NINGUNO) idPendiente_ = 0;
    const bool mover = estado_.cambiarAhora(ahora) && !envioEnCurso;
    const uint8_t siguiente = estado_.siguiente();
    portEXIT_CRITICAL(&mutex_);

    if (mover && esp_wifi_set_channel(siguiente, WIFI_SECOND_CHAN_NONE) == ESP_OK) {
      portENTER_CRITICAL(&mutex_);
      estado_.cambiar(siguiente, millis());
      hayAnuncio_ = false;
      idPendiente_ = 0;
      portEXIT_CRITICAL(&mutex_);
      Serial.printf("Buscando Gateway: canal=%u\n", siguiente);
    }
    if (cambio == EstadoCanal::PERDIDO) {
      Serial.println("Sin anuncios del Gateway: buscando canal; telemetría pausada");
    } else if (cambio != EstadoCanal::NINGUNO) {
      Serial.printf("Gateway encontrado: MAC=%s canal=%u sesión=%lu; solicitando ID\n",
                    macATexto(estado_.mac()).c_str(), estado_.canal(),
                    static_cast<unsigned long>(estado_.sesion()));
    }
    return cambio;
  }

  uint8_t obtenerAsignacion() {
    portENTER_CRITICAL(&mutex_);
    const uint8_t id = idPendiente_;
    idPendiente_ = 0;
    portEXIT_CRITICAL(&mutex_);
    return id;
  }
  // Estos accesores sólo se consultan desde loop, donde cambia el estado.
  bool encontrado() const { return estado_.encontrado(); }
  uint8_t canal() const { return estado_.canal(); }
  const uint8_t *mac() const { return estado_.mac(); }

 private:
  EstadoCanal estado_;
  RolNodo rol_;
  uint8_t macNodo_[TAMANO_MAC] = {}, origenAnuncio_[TAMANO_MAC] = {};
  PaqueteAnuncioGateway anuncio_ = {};
  uint32_t recibidoMs_ = 0;
  bool hayAnuncio_ = false;
  uint8_t idPendiente_ = 0;
  portMUX_TYPE mutex_ = portMUX_INITIALIZER_UNLOCKED;
};

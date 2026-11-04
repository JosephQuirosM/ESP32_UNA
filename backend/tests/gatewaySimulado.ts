import { createSocket, type Socket } from "node:dgram";

/** Emula la radio/UDP del Gateway sin sustituir el receptor Python real. */
export class GatewaySimulado {
  private socket: Socket = createSocket("udp4");
  private timer?: ReturnType<typeof setInterval>;
  private puertoPc = 0;
  sesion = 456;
  revision = 0;
  capturaId = "-";
  puertoHttp = 0;
  confirmar = true;
  controlCaptura = true;
  purgas = 0;
  cola: string[] = [];
  ordenes: string[] = [];
  ultimoAck = "";
  demoraAck = 0;

  async iniciar(puertoPc: number) {
    this.puertoPc = puertoPc;
    await new Promise<void>(r => this.socket.bind(0, "127.0.0.1", r));
    this.socket.on("message", mensaje => {
      const texto = mensaje.toString(); this.ordenes.push(texto);
      const m = /^HEATMAP_PC_V3 (\d+) (\d+) ([0-9a-f-]+) (\d+)$/.exec(texto);
      if (!m || Number(m[1]) !== this.sesion || Number(m[2]) < this.revision) return;
      if (Number(m[2]) === this.revision && (m[3] !== this.capturaId || Number(m[4]) !== this.puertoHttp)) return;
      if (Number(m[2]) > this.revision) {
        this.revision = Number(m[2]); this.capturaId = m[3]; this.puertoHttp = Number(m[4]);
        this.cola = []; ++this.purgas;
      }
      this.ultimoAck = `HEATMAP_ACK_V3 ${this.sesion} ${this.revision} ${this.capturaId} ${this.puertoHttp}`;
      if (this.confirmar) {
        const ack = this.ultimoAck;
        if (this.demoraAck) setTimeout(() => { try { this.enviar(ack); } catch { /* Cerrado por la prueba. */ } }, this.demoraAck);
        else this.enviar(ack);
      }
    });
    this.timer = setInterval(() => this.anunciar(), 100);
    this.anunciar();
  }

  enviar(mensaje: string) { this.socket.send(mensaje, this.puertoPc, "127.0.0.1"); }
  anunciar() {
    this.enviar("HEATMAP_GATEWAY_V1 " + JSON.stringify({ mac: "AA:BB:CC:DD:EE:01", sesion: this.sesion,
      canal: 6, uptimeMs: 100, registrosRecibidos: 0, registrosEnviados: 0, fallosHttp: 0,
      pcConfirmada: this.revision > 0, ...(this.controlCaptura ? { controlCaptura: 1,
        revisionControl: this.revision, capturaId: this.capturaId, capturando: this.puertoHttp > 0,
        descartesInactivos: 0, registrosPurgados: this.purgas } : {}),
    }));
  }
  async cerrar() {
    clearInterval(this.timer);
    await new Promise<void>(r => this.socket.close(() => r()));
  }
}

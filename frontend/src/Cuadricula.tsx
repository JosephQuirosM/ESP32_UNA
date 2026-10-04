import { useId, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { Check, GripVertical } from "lucide-react";
import { intercambiarZonas } from "./cuadricula";

type Propiedades = {
  filas: number;
  columnas: number;
  zonas: number[];
  actual: number;
  completas: number[];
  ejecutando: boolean;
  onReordenar?: (zonas: number[]) => void;
};

/** Matriz de zonas que permite intercambiar posiciones con ratón, tacto o teclado. */
export default function Cuadricula({
  filas,
  columnas,
  zonas,
  actual,
  completas,
  ejecutando,
  onReordenar,
}: Propiedades) {
  const ayudaId = useId();
  const matrizRef = useRef<HTMLDivElement>(null);
  const gestoRef = useRef<{
    zona: number;
    x: number;
    y: number;
    movido: boolean;
  } | null>(null);
  const [tomada, setTomada] = useState<number | null>(null);
  const [destino, setDestino] = useState<number | null>(null);
  const [anuncio, setAnuncio] = useState("");

  function intercambiar(origen: number, destinoZona: number) {
    onReordenar?.(intercambiarZonas(zonas, origen, destinoZona));
    setAnuncio(
      `Zona ${origen} intercambiada con zona ${destinoZona}. El orden del recorrido no cambia.`,
    );
  }

  function destinoEnPunto(x: number, y: number) {
    const elemento = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-zona]");
    return elemento && matrizRef.current?.contains(elemento)
      ? Number(elemento.dataset.zona)
      : null;
  }

  function iniciarArrastre(
    evento: PointerEvent<HTMLButtonElement>,
    zona: number,
  ) {
    if (!onReordenar || evento.button !== 0) return;
    gestoRef.current = {
      zona,
      x: evento.clientX,
      y: evento.clientY,
      movido: false,
    };
    evento.currentTarget.setPointerCapture(evento.pointerId);
  }

  function moverArrastre(evento: PointerEvent<HTMLButtonElement>) {
    const gesto = gestoRef.current;
    if (!gesto) return;
    if (
      Math.hypot(evento.clientX - gesto.x, evento.clientY - gesto.y) < 5 &&
      !gesto.movido
    )
      return;
    gesto.movido = true;
    setTomada(gesto.zona);
    setDestino(destinoEnPunto(evento.clientX, evento.clientY));
  }

  function terminarArrastre(evento: PointerEvent<HTMLButtonElement>) {
    const gesto = gestoRef.current;
    const hasta = destinoEnPunto(evento.clientX, evento.clientY);
    if (gesto?.movido && hasta !== null && hasta !== gesto.zona)
      intercambiar(gesto.zona, hasta);
    cancelarArrastre();
  }

  function cancelarArrastre() {
    gestoRef.current = null;
    setTomada(null);
    setDestino(null);
  }

  /** Permite recoger una zona con Espacio y moverla con las flechas. */
  function moverConTeclado(
    evento: KeyboardEvent<HTMLButtonElement>,
    zona: number,
  ) {
    if (evento.key === "Escape") {
      cancelarArrastre();
      setAnuncio("Movimiento cancelado.");
      return;
    }
    if (tomada !== zona || !onReordenar) return;
    const indice = zonas.indexOf(zona);
    const movimientos: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columnas,
      ArrowDown: columnas,
    };
    const salto = movimientos[evento.key];
    if (salto === undefined) return;
    evento.preventDefault();
    const hasta = indice + salto;
    if (
      hasta < 0 ||
      hasta >= zonas.length ||
      (evento.key === "ArrowLeft" && indice % columnas === 0) ||
      (evento.key === "ArrowRight" && indice % columnas === columnas - 1)
    )
      return;
    intercambiar(zona, zonas[hasta]);
    requestAnimationFrame(() =>
      matrizRef.current
        ?.querySelector<HTMLButtonElement>(`[data-zona="${zona}"]`)
        ?.focus(),
    );
  }

  return (
    <>
      {onReordenar && (
        <p className="ayuda-arrastre" id={ayudaId}>
          <GripVertical size={17} />
          Arrastra una zona sobre otra para intercambiar sus posiciones. Con
          teclado: Espacio para tomar, flechas para mover y Espacio para soltar.
        </p>
      )}
      <div className="contenedor-cuadricula">
        <div
          ref={matrizRef}
          className="cuadricula"
          style={{
            gridTemplateColumns: `repeat(${columnas}, minmax(90px, 1fr))`,
          }}
          aria-label={`Cuadrícula de zonas ${filas} por ${columnas}`}
        >
          {zonas.map((zona) => {
            const completa = completas.includes(zona),
              seleccionada = zona === actual && !completa;
            const estado = completa
              ? "completada"
              : seleccionada
                ? ejecutando
                  ? "en curso"
                  : "seleccionada"
                : "pendiente";
            return (
              <button
                key={zona}
                type="button"
                data-zona={zona}
                className={`zona zona-arrastrable ${completa ? "completa" : seleccionada ? (ejecutando ? "ejecutando" : "actual") : ""} ${tomada === zona ? "tomada" : ""} ${destino === zona && tomada !== zona ? "destino-arrastre" : ""}`}
                disabled={!onReordenar}
                aria-label={`Zona ${zona}: ${estado}`}
                aria-describedby={onReordenar ? ayudaId : undefined}
                aria-pressed={tomada === zona}
                onPointerDown={(evento) => iniciarArrastre(evento, zona)}
                onPointerMove={moverArrastre}
                onPointerUp={terminarArrastre}
                onPointerCancel={cancelarArrastre}
                onKeyDown={(evento) => moverConTeclado(evento, zona)}
                onClick={(evento) => {
                  if (evento.detail !== 0) return;
                  setTomada(tomada === zona ? null : zona);
                  setAnuncio(
                    tomada === zona
                      ? `Zona ${zona} soltada.`
                      : `Zona ${zona} tomada. Usa las flechas para moverla.`,
                  );
                }}
              >
                <div className="zona-superior">
                  <span>ZONA</span>
                  {completa ? (
                    <Check size={18} />
                  ) : seleccionada ? (
                    <span className="indicador-zona" />
                  ) : (
                    <GripVertical size={16} />
                  )}
                </div>
                <strong>{zona}</strong>
                <small>
                  {completa
                    ? "Completada"
                    : seleccionada
                      ? ejecutando
                        ? "En curso"
                        : "Seleccionada"
                      : "Pendiente"}
                </small>
              </button>
            );
          })}
        </div>
      </div>
      <span className="solo-lector" role="status">
        {anuncio}
      </span>
    </>
  );
}

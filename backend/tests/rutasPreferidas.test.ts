import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { leerRutasPreferidas, recordarRutas } from "../src/rutasPreferidas.js";

test("Las rutas empiezan vacías, persisten y se omiten si desaparecen", () => {
  const datos = mkdtempSync(join(tmpdir(), "esp32-rutas-"));
  const csv = join(datos, "entrada.csv");
  writeFileSync(csv, "zona,rssi\n1,-60\n");
  try {
    assert.deepEqual(leerRutasPreferidas(datos), {});
    recordarRutas(datos, { recoleccionSalida: datos, entrenamientoEntrada: csv });
    assert.deepEqual(leerRutasPreferidas(datos), { recoleccionSalida: datos, entrenamientoEntrada: csv });
    rmSync(csv);
    assert.deepEqual(leerRutasPreferidas(datos), { recoleccionSalida: datos });
  } finally {
    rmSync(datos, { recursive: true, force: true });
  }
});

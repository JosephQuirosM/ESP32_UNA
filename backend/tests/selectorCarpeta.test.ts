import assert from "node:assert/strict";
import { test } from "node:test";
import { comandoSelector } from "../src/selectorCarpeta.js";

test("El selector usa el diálogo nativo y pasa la ruta como dato separado", () => {
  const ruta = '/tmp/mi carpeta $(no-ejecutar)';
  const [comando, args] = comandoSelector(ruta, "linux");
  assert.equal(comando, "zenity");
  assert.ok(args.includes("--directory"));
  assert.ok(args.includes(`--filename=${ruta}/`));
  assert.equal(comandoSelector("/tmp", "darwin")[0], "osascript");
  const rutaWindows = "C:\\Datos de calibración";
  const [comandoWindows, argsWindows] = comandoSelector(rutaWindows, "win32");
  assert.equal(comandoWindows, "powershell.exe");
  assert.deepEqual(argsWindows.slice(0, -1), ["-NoProfile", "-STA", "-EncodedCommand"]);
  const script = Buffer.from(argsWindows[3], "base64").toString("utf16le");
  assert.match(script, /dialogo\.SetOptions\(opciones \| FOS_PICKFOLDERS \| FOS_FORCEFILESYSTEM\)/);
  assert.ok(script.includes("$env:ESP32_CARPETA_INICIAL"));
  assert.ok(!script.includes(rutaWindows));
  assert.throws(() => comandoSelector("/tmp", "freebsd"), /No hay un selector/);
});

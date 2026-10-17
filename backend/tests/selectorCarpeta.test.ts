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
  assert.equal(comandoSelector("C:\\Datos", "win32")[0], "powershell.exe");
  assert.throws(() => comandoSelector("/tmp", "freebsd"), /No hay un selector/);
});

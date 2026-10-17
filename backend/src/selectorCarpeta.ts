import { spawn } from "node:child_process";
import { sep } from "node:path";
import { ErrorPeticion } from "./gestor.js";

/** Usa el selector de carpetas del escritorio, sin interpretar rutas en un shell. */
export function comandoSelector(ruta: string, plataforma: NodeJS.Platform = process.platform): [string, string[]] {
  if (plataforma === "linux") return ["zenity", ["--file-selection", "--directory", "--title=Seleccionar carpeta para guardar el CSV etiquetado", `--filename=${ruta.endsWith(sep) ? ruta : ruta + sep}`]];
  if (plataforma === "darwin") return ["osascript", ["-e", 'on run argv\ntry\nreturn POSIX path of (choose folder with prompt "Seleccionar carpeta para guardar el CSV etiquetado" default location (POSIX file (item 1 of argv)))\non error number -128\nreturn ""\nend try\nend run', ruta]];
  if (plataforma === "win32") return ["powershell.exe", ["-NoProfile", "-STA", "-Command", 'Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = "Seleccionar carpeta para guardar el CSV etiquetado"; $dialog.SelectedPath = $env:ESP32_CARPETA_INICIAL; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::Write($dialog.SelectedPath) }; $dialog.Dispose()']];
  throw new ErrorPeticion(503, "No hay un selector de carpetas disponible para este sistema operativo.");
}

export function seleccionarCarpeta(ruta: string): Promise<string | null> {
  const [comando, argumentos] = comandoSelector(ruta);
  return new Promise((resolve, reject) => {
    const hijo = spawn(comando, argumentos, { env: { ...process.env, ESP32_CARPETA_INICIAL: ruta }, stdio: ["ignore", "pipe", "pipe"] });
    let salida = "";
    const temporizador = setTimeout(() => { hijo.kill(); reject(new ErrorPeticion(408, "Se cerró el selector por tiempo de espera. Puedes volver a abrirlo.")); }, 300000);
    hijo.stdout.on("data", (chunk) => { salida += chunk; });
    hijo.stderr.on("data", () => { /* Los avisos del escritorio no son datos de salida. */ });
    hijo.on("error", () => { clearTimeout(temporizador); reject(new ErrorPeticion(503, "No se pudo abrir el selector de carpetas del sistema. En Linux requiere Zenity y una sesión de escritorio activa.")); });
    hijo.on("close", (codigo) => {
      clearTimeout(temporizador);
      if (codigo === 0) resolve(salida.trim() || null);
      else if (codigo === 1) resolve(null); // Cancelar en Zenity.
      else reject(new ErrorPeticion(503, "No se pudo abrir el selector de carpetas del sistema operativo."));
    });
  });
}

import { spawn } from "node:child_process";
import { sep } from "node:path";
import { ErrorPeticion } from "./gestor.js";

/** Usa el selector de carpetas del escritorio, sin interpretar rutas en un shell. */
export function comandoSelector(ruta: string, plataforma: NodeJS.Platform = process.platform): [string, string[]] {
  if (plataforma === "linux") return ["zenity", ["--file-selection", "--directory", "--title=Seleccionar carpeta de salida", `--filename=${ruta.endsWith(sep) ? ruta : ruta + sep}`]];
  if (plataforma === "darwin") return ["osascript", ["-e", 'on run argv\ntry\nreturn POSIX path of (choose folder with prompt "Seleccionar carpeta de salida" default location (POSIX file (item 1 of argv)))\non error number -128\nreturn ""\nend try\nend run', ruta]];
  if (plataforma === "win32") return ["powershell.exe", ["-NoProfile", "-STA", "-Command", 'Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = "Seleccionar carpeta de salida"; $dialog.SelectedPath = $env:ESP32_CARPETA_INICIAL; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::Write($dialog.SelectedPath) }; $dialog.Dispose()']];
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

/** Selecciona un CSV local con el gestor de archivos del sistema. */
export function seleccionarCsv(ruta: string): Promise<string | null> {
  let comando: string, argumentos: string[];
  if (process.platform === "linux") {
    comando = "zenity";
    argumentos = ["--file-selection", "--title=Seleccionar CSV etiquetado para entrenar", "--file-filter=Archivos CSV | *.csv *.CSV", `--filename=${ruta.endsWith(sep) ? ruta : ruta + sep}`];
  } else if (process.platform === "darwin") {
    comando = "osascript";
    argumentos = ["-e", 'on run argv\ntry\nreturn POSIX path of (choose file with prompt "Seleccionar CSV etiquetado" of type {"csv"} default location (POSIX file (item 1 of argv)))\non error number -128\nreturn ""\nend try\nend run', ruta];
  } else if (process.platform === "win32") {
    comando = "powershell.exe";
    argumentos = ["-NoProfile", "-STA", "-Command", 'Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Filter="CSV (*.csv)|*.csv"; $d.InitialDirectory=$env:ESP32_CARPETA_INICIAL; if($d.ShowDialog() -eq "OK"){[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; [Console]::Write($d.FileName)}; $d.Dispose()'];
  } else throw new ErrorPeticion(503, "Selector de archivos no disponible en este sistema.");
  return new Promise((resolve, reject) => {
    const child = spawn(comando, argumentos, { env: { ...process.env, ESP32_CARPETA_INICIAL: ruta }, stdio: ["ignore", "pipe", "pipe"] });
    let salida = "";
    const timer = setTimeout(() => { child.kill(); reject(new ErrorPeticion(408, "El selector agotó su tiempo de espera.")); }, 300000);
    child.stdout.on("data", c => { salida += c; }); child.stderr.on("data", () => {});
    child.on("error", () => { clearTimeout(timer); reject(new ErrorPeticion(503, "No se pudo abrir el gestor de archivos del sistema.")); });
    child.on("close", code => { clearTimeout(timer); if (code === 0 || code === 1) resolve(code === 0 ? salida.trim() || null : null); else reject(new ErrorPeticion(503, "No se pudo abrir el gestor de archivos.")); });
  });
}

/** Selector nativo para varios CSV o un modelo .joblib. */
export function seleccionarArchivosLocales(ruta: string, tipo: "csv" | "joblib"): Promise<string[]> {
  const multiple = tipo === "csv";
  const titulo = multiple ? "Seleccionar CSV para mapas de calor" : "Seleccionar modelo entrenado .joblib";
  let comando: string, argumentos: string[];
  if (process.platform === "linux") {
    comando = "zenity";
    argumentos = ["--file-selection", `--title=${titulo}`, `--file-filter=Archivos ${tipo} | *.${tipo} *.${tipo.toUpperCase()}`, `--filename=${ruta.endsWith(sep) ? ruta : ruta + sep}`];
    if (multiple) argumentos.push("--multiple", "--separator=\n");
  } else if (process.platform === "darwin") {
    comando = "osascript";
    argumentos = ["-e", `on run argv\ntry\nset elegidos to choose file with prompt (item 2 of argv) default location (POSIX file (item 1 of argv)) ${multiple ? "with multiple selections allowed" : ""}\n${multiple ? 'set salida to ""\nrepeat with f in elegidos\nset salida to salida & POSIX path of f & linefeed\nend repeat\nreturn salida' : "return POSIX path of elegidos"}\non error number -128\nreturn ""\nend try\nend run`, ruta, titulo];
  } else if (process.platform === "win32") {
    comando = "powershell.exe";
    argumentos = ["-NoProfile", "-STA", "-Command", `Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Filter="${tipo} (*.${tipo})|*.${tipo}"; $d.Multiselect=$${multiple ? "true" : "false"}; $d.InitialDirectory=$env:ESP32_CARPETA_INICIAL; if($d.ShowDialog() -eq "OK"){[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; [Console]::Write(($d.FileNames -join [Environment]::NewLine))}; $d.Dispose()`];
  } else throw new ErrorPeticion(503, "Selector de archivos no disponible en este sistema.");
  return new Promise((resolve, reject) => {
    const child = spawn(comando, argumentos, { env: { ...process.env, ESP32_CARPETA_INICIAL: ruta }, stdio: ["ignore", "pipe", "pipe"] });
    let salida = "";
    const timer = setTimeout(() => { child.kill(); reject(new ErrorPeticion(408, "El selector agotó su tiempo de espera.")); }, 300000);
    child.stdout.on("data", c => { salida += c; }); child.stderr.on("data", () => {});
    child.on("error", () => { clearTimeout(timer); reject(new ErrorPeticion(503, "No se pudo abrir el gestor de archivos del sistema.")); });
    child.on("close", code => { clearTimeout(timer); if (code === 0 || code === 1) resolve(code === 0 ? salida.split(/\r?\n/).filter(Boolean) : []); else reject(new ErrorPeticion(503, "No se pudo abrir el gestor de archivos.")); });
  });
}

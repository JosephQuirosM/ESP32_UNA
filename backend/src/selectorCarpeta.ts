import { spawn } from "node:child_process";
import { sep } from "node:path";
import { ErrorPeticion } from "./gestor.js";

// IFileDialog con FOS_PICKFOLDERS usa el cuadro del Explorador para elegir carpetas.
const SELECTOR_CARPETA_WINDOWS = String.raw`
$ErrorActionPreference = 'Stop'
try {
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;

public static class SelectorCarpeta
{
    [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileDialog
    {
        // El orden de los métodos corresponde a la interfaz COM de Windows.
        [PreserveSig] int Show(IntPtr owner);
        void SetFileTypes(uint count, IntPtr filters);
        void SetFileTypeIndex(uint index);
        void GetFileTypeIndex(out uint index);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(uint options);
        void GetOptions(out uint options);
        void SetDefaultFolder(IShellItem folder);
        void SetFolder(IShellItem folder);
        void GetFolder(out IShellItem folder);
        void GetCurrentSelection(out IShellItem item);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName(out IntPtr name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem item);
    }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        void BindToHandler(IntPtr context, ref Guid handler, ref Guid iid, out IntPtr result);
        void GetParent(out IShellItem parent);
        void GetDisplayName(uint type, out IntPtr name);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int SHCreateItemFromParsingName(
        string path, IntPtr context, ref Guid iid, out IShellItem item);

    public static string Elegir(string rutaInicial)
    {
        const uint FOS_PICKFOLDERS = 0x20;
        const uint FOS_FORCEFILESYSTEM = 0x40;
        const uint SIGDN_FILESYSPATH = 0x80058000;
        const int ERROR_CANCELLED_HRESULT = unchecked((int)0x800704C7);
        var clase = Type.GetTypeFromCLSID(new Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7"));
        var dialogo = (IFileDialog)Activator.CreateInstance(clase);
        IShellItem inicial = null;
        IShellItem elegido = null;
        IntPtr ruta = IntPtr.Zero;
        try
        {
            uint opciones;
            dialogo.GetOptions(out opciones);
            dialogo.SetOptions(opciones | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
            dialogo.SetTitle("Seleccionar carpeta de salida");
            if (Directory.Exists(rutaInicial))
            {
                Guid iid = typeof(IShellItem).GUID;
                if (SHCreateItemFromParsingName(rutaInicial, IntPtr.Zero, ref iid, out inicial) >= 0)
                    dialogo.SetFolder(inicial);
            }
            int estado = dialogo.Show(IntPtr.Zero);
            if (estado == ERROR_CANCELLED_HRESULT) return null;
            Marshal.ThrowExceptionForHR(estado);
            dialogo.GetResult(out elegido);
            elegido.GetDisplayName(SIGDN_FILESYSPATH, out ruta);
            return Marshal.PtrToStringUni(ruta);
        }
        finally
        {
            if (ruta != IntPtr.Zero) Marshal.FreeCoTaskMem(ruta);
            if (elegido != null) Marshal.ReleaseComObject(elegido);
            if (inicial != null) Marshal.ReleaseComObject(inicial);
            Marshal.ReleaseComObject(dialogo);
        }
    }
}
'@
    $ruta = [SelectorCarpeta]::Elegir($env:ESP32_CARPETA_INICIAL)
    if ($ruta) {
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        [Console]::Write($ruta)
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 2
}
`;

/** Usa el selector de carpetas del escritorio, sin interpretar rutas en un shell. */
export function comandoSelector(ruta: string, plataforma: NodeJS.Platform = process.platform): [string, string[]] {
  if (plataforma === "linux") return ["zenity", ["--file-selection", "--directory", "--title=Seleccionar carpeta de salida", `--filename=${ruta.endsWith(sep) ? ruta : ruta + sep}`]];
  if (plataforma === "darwin") return ["osascript", ["-e", 'on run argv\ntry\nreturn POSIX path of (choose folder with prompt "Seleccionar carpeta de salida" default location (POSIX file (item 1 of argv)))\non error number -128\nreturn ""\nend try\nend run', ruta]];
  if (plataforma === "win32") {
    const script = Buffer.from(SELECTOR_CARPETA_WINDOWS, "utf16le").toString("base64");
    return ["powershell.exe", ["-NoProfile", "-STA", "-EncodedCommand", script]];
  }
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
      else if (codigo === 1 && comando === "zenity") resolve(null);
      else reject(new ErrorPeticion(503, "No se pudo abrir el selector de carpetas del sistema operativo."));
    });
  });
}

/** Selecciona un CSV local con el gestor de archivos del sistema. */
export function seleccionarCsv(ruta: string, titulo = "Seleccionar CSV etiquetado para entrenar"): Promise<string | null> {
  let comando: string, argumentos: string[];
  if (process.platform === "linux") {
    comando = "zenity";
    argumentos = ["--file-selection", `--title=${titulo}`, "--file-filter=Archivos CSV | *.csv *.CSV", `--filename=${ruta.endsWith(sep) ? ruta : ruta + sep}`];
  } else if (process.platform === "darwin") {
    comando = "osascript";
    argumentos = ["-e", 'on run argv\ntry\nreturn POSIX path of (choose file with prompt (item 2 of argv) of type {"csv"} default location (POSIX file (item 1 of argv)))\non error number -128\nreturn ""\nend try\nend run', ruta, titulo];
  } else if (process.platform === "win32") {
    comando = "powershell.exe";
    argumentos = ["-NoProfile", "-STA", "-Command", 'Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Title=$env:ESP32_TITULO_SELECTOR; $d.Filter="CSV (*.csv)|*.csv"; $d.InitialDirectory=$env:ESP32_CARPETA_INICIAL; if($d.ShowDialog() -eq "OK"){[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; [Console]::Write($d.FileName)}; $d.Dispose()'];
  } else throw new ErrorPeticion(503, "Selector de archivos no disponible en este sistema.");
  return new Promise((resolve, reject) => {
    const child = spawn(comando, argumentos, { env: { ...process.env, ESP32_CARPETA_INICIAL: ruta, ESP32_TITULO_SELECTOR: titulo }, stdio: ["ignore", "pipe", "pipe"] });
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

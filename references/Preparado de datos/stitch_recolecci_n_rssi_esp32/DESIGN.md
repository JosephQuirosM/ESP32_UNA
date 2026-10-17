---
name: ESP32 RSSI Precision Grid
colors:
  surface: '#f8f9ff'
  surface-dim: '#cddbf2'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e6eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d6e3fb'
  on-surface: '#0f1c2d'
  on-surface-variant: '#434654'
  inverse-surface: '#243143'
  inverse-on-surface: '#eaf1ff'
  outline: '#737686'
  outline-variant: '#c3c5d7'
  surface-tint: '#1353d8'
  primary: '#003fb1'
  on-primary: '#ffffff'
  primary-container: '#1a56db'
  on-primary-container: '#d4dcff'
  inverse-primary: '#b5c4ff'
  secondary: '#006c49'
  on-secondary: '#ffffff'
  secondary-container: '#7ef6be'
  on-secondary-container: '#00714c'
  tertiary: '#694100'
  on-tertiary: '#ffffff'
  tertiary-container: '#895600'
  on-tertiary-container: '#ffd6a8'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b5c4ff'
  on-primary-fixed: '#00174d'
  on-primary-fixed-variant: '#003dab'
  secondary-fixed: '#81f9c1'
  secondary-fixed-dim: '#63dca6'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#f8f9ff'
  on-background: '#0f1c2d'
  surface-variant: '#d6e3fb'
typography:
  display-timer:
    fontFamily: Inter
    fontSize: 56px
    fontWeight: '700'
    lineHeight: 64px
    letterSpacing: -0.03em
  display-timer-mobile:
    fontFamily: Inter
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  title-sm:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  code-filename:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-desktop: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

## Brand & Style
The design system embodies a modern, technical, laboratory-grade utility with immediate visual clarity for field technicians, researchers, and non-programming operators. It balances the rigor of embedded hardware metrics with the accessibility of modern web tools.

The design movement is **Modern Technical / Functional Laboratory**:
- Crisp, clean surfaces prioritizing high legibility and rapid signal-status comprehension.
- Light-mode dominant with neutral-slate backgrounds that eliminate glare during in-field deployment on laptops and mobile devices.
- Direct, unmistakable tactile feedback: touch targets calibrated for mobile field measurements, paired with structured data density for desktop analysis.
- Unambiguous tri-factor state signaling: every operational status must simultaneously communicate via explicit label text, distinct SVG iconography, and calibrated semantic color tokens.

## Colors
The palette is built for precision, legibility, and high situational awareness:

- **Primary (`#1A56DB`)**: Deep corporate cobalt blue. Used for primary controls, active recording zone highlights, structural headers, and focused states.
- **Secondary / Success (`#0E9F6E`)**: Calibrated telemetry green. Communicates "Ready", "ESP32 Connected", "Data Synchronized", and completed collection cycles.
- **Tertiary / Warning (`#F59E0B`)**: Industrial amber. Indicates low packet counts, RSSI threshold warnings, or pending transitions.
- **Destructive / Recording Alert (`#E02424`)**: Signal red. Reserved for the active "Recording / Capturing" pulse state, hardware disconnections, and critical capture errors.
- **Neutral Core (`#475467`)**: Cool slate spectrum:
  - Surface base: `#F8FAFC` (Canvas background)
  - Surface container: `#FFFFFF` (Card surfaces, clean white)
  - Surface muted: `#F1F5F9` (Grid zone inactive fill, table alternate rows)
  - Border subtle: `#E2E8F0` (Default borders, container dividers)
  - Border active: `#CBD5E1` (Interactive outlines)
  - Text primary: `#0F172A` (900-slate for maximum contrast ratio > 12:1 against white)
  - Text secondary: `#475467` (600-slate for descriptive metadata and units)

## Typography
Inter delivers supreme legibility for technical telemetry through its tall x-height, clear numeric distinction, and balanced weights.

- **Numeric Telemetry & Timers**: All metrics, packet counts, dBm figures, and countdown timers enforce tabular numbers (`font-variant-numeric: tabular-nums`) to prevent horizontal jitter during high-frequency data ingestion.
- **Hierarchy Rules**:
  - `display-timer` and `display-timer-mobile`: Large countdown display ensuring visibility from a 2-meter physical distance during manual collection walks.
  - `title-sm` & `label-lg`: Power the 9-cell tactile grid zone numbers and sensor module titles.
  - `code-filename`: Styled with subtle background encapsulation for dynamic `.csv` export generation.

## Layout & Spacing
The layout model employs a responsive structured container framework designed for dual workflows: single-column touch capture in mobile viewports, and multi-column telemetry control on desktop.

- **Breakpoints**:
  - Mobile: `< 768px` (Single column stacked flow, sticky action bar at base, oversized grid buttons).
  - Desktop: `>= 768px` (Split layout: 4-column side configuration panel, 8-column main operational console).
- **Physical 9-Zone Matrix Layout**:
  - Arranged in the physical serpentine scanning pattern:
    - Row 1: `[ Zone 1 ] [ Zone 2 ] [ Zone 3 ]`
    - Row 2: `[ Zone 6 ] [ Zone 5 ] [ Zone 4 ]`
    - Row 3: `[ Zone 7 ] [ Zone 8 ] [ Zone 9 ]`
  - Maintains strict aspect ratio (square 1:1 on mobile, minimum height of 96px per cell on desktop).
  - Uses `space-md` gaps between grid zones to eliminate accidental edge taps.

## Elevation & Depth
Depth is created through clean surface layering paired with crisp low-contrast outlines:

- **Surface Base**: `#F8FAFC` represents the physical board background.
- **Surface Elevation 1 (Cards, Modules, Grid Cells)**: Pure `#FFFFFF` enclosed in a 1px solid border (`#E2E8F0`) with a diffused ambient drop shadow: `0 1px 3px 0 rgba(15, 23, 42, 0.06), 0 1px 2px -1px rgba(15, 23, 42, 0.04)`.
- **Surface Elevation 2 (Active Recording State & Floating Action Modals)**: Pure `#FFFFFF` elevated with a double-tier shadow: `0 10px 15px -3px rgba(15, 23, 42, 0.08), 0 4px 6px -4px rgba(15, 23, 42, 0.03)` and a saturated semantic border matching the operational state (`#1A56DB` or `#E02424`).
- **Interactive Focus & Active Depress**: Active touch presses collapse elevation to 0, shifting border color and filling the cell with an interactive tint (`rgba(26, 86, 219, 0.04)`).

## Shapes
Roundedness token level `2` sets a 0.5rem (8px) baseline radius:

- **Buttons, Text Inputs, and Selectors**: 0.5rem (8px) for comfortable touch boundaries.
- **Physical Grid Cells (Zonas 1-9)**: 0.75rem (12px) outer radius to convey distinct, standalone tactile pads.
- **Cards, ESP32 Module Status Tiles**: 1rem (16px) radius (`rounded-lg`) offering structural separation between collection forms and metrics.
- **Badges and Status Pills**: Fully rounded pill shapes (`9999px`) for fast visual recognition of operational states.

## Components

### 1. 9-Zone Spatial Matrix (Zonas 1 a 9)
- **Arrangement**: Strict 3x3 layout ordered `1-2-3` (top), `6-5-4` (middle), `7-8-9` (bottom).
- **Default State**: White surface, 1.5px `#CBD5E1` border, large centered numeral (`title-sm` or `headline-md`), and sub-label showing packet count (`0 pkts`).
- **Selected / Queued State**: `#EFF6FF` background, 2px solid `#1A56DB` border, `#1A56DB` text.
- **Recording State**: Solid `#FEF2F2` background, 2px solid `#E02424` border, pulsating red ping indicator in top-right corner.
- **Completed State**: `#F0FDF4` background, 1.5px solid `#0E9F6E` border, checkmark icon with finalized sample count.

### 2. State Badges & Indicators
Always combine icon + text label + token color:
- **Recording (`Grabando`)**: Animated dot badge (`#E02424`), text "GRABANDO", subtle 1.5s gentle pulse opacity.
- **Standby / Ready (`En espera`)**: Static circle checkmark (`#0E9F6E`), text "LISTO / EN ESPERA".
- **Warning (`Advertencia`)**: Triangle alert icon (`#F59E0B`), text accompanied by issue summary (e.g., "RSSI Débil < -85 dBm").
- **Error (`Desconectado`)**: Octagon exclamation icon (`#E02424`), text accompanied by diagnostic ("ESP32 Sin Respuesta").

### 3. Primary & Action Buttons
- **Touch-Optimized Height**: Minimum 48px on mobile, 44px on desktop.
- **Primary ("Iniciar Captura")**: Solid `#1A56DB`, white text, bold label, right-aligned action icon.
- **Stop / Abort ("Detener")**: Solid `#E02424`, white text, high contrast.
- **Export CSV**: Outlined secondary style with clean document icon and instant download feedback.

### 4. Compact Forms & Dynamic CSV Preview
- Input groups stack labels strictly above inputs with explicit helper text.
- **Dynamic File Name Box**: Enclosed in `#F1F5F9` with a subtle dashed border (`#CBD5E1`). Renders the live formatted string:
  `[entorno]_[esp32_id]_[grid_zone]_[timestamp].csv`
  with highlighting tokens on active variables as the user types.

### 5. Big Timer & Progress Bar
- **Timer**: Monospaced tabular numeral counter (`00:15.0`) styled with `display-timer`. Accompanied by a sub-label "Muestreando a 10 Hz".
- **Progress Bar**: 8px height, rounded pill track (`#E2E8F0`), filled with smooth linear gradient (`#1A56DB` to `#2563EB`) animated at 60fps without lag.

### 6. ESP32 Hardware Status Tile
- Compact hardware card listing: Device MAC/IP, Last RSSI average, Active Packets/sec, and a real-time mini signal bar meter.
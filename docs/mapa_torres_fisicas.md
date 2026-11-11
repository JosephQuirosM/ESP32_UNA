# Mapa físico de torres

Este archivo es la fuente de verdad para convertir una MAC de torre en una columna RSSI estable. `torre_id` es lógico, dinámico y no representa una posición física.

## Configuración física documentada: zona 6 m × 2,5 m

Antes de cada campaña, confirme que estas placas se coloquen en las mismas esquinas indicadas. Si cambia una posición, actualice esta tabla antes de entrenar.

| Torre | Ubicación física | MAC de la torre | Columna del modelo |
|---|---|---|---|
| I | Esquina superior izquierda | `10:06:1C:D5:95:04` | `rssi_sup_izq` |
| II | Esquina superior derecha | `90:15:06:5A:30:D0` | `rssi_sup_der` |
| III | Esquina inferior izquierda | `10:06:1C:D5:95:8C` | `rssi_inf_izq` |
| IV | Esquina inferior derecha | `10:06:1C:D4:8F:C4` | `rssi_inf_der` |

## Preset de cuadrícula 3×3

```text
| 1 | 2 | 3 |
| 6 | 5 | 4 |
| 7 | 8 | 9 |
```

El vector de entrada debe conservar este orden:

```text
[rssi_sup_izq, rssi_sup_der, rssi_inf_izq, rssi_inf_der]
```

Si una MAC no coincide con la tabla, esa lectura no debe entrar al entrenamiento hasta resolver la identidad física.

La tabla se utiliza en ejecución mediante `MAC_A_CARACTERISTICA` de `python/config_rssi.py`; el código no lee este Markdown. Si cambia una MAC o ubicación, actualice ambos archivos y separe o invalide la calibración anterior. El acomodo editable de zonas de la cuadrícula web se conserva en el CSV/modelo y determina las coordenadas del mapa Python; no modifica esta tabla de las cuatro torres ni el orden de sus características RSSI.

Para otras cantidades de zonas, configure filas y columnas desde Recolección. El vector mantiene las mismas cuatro RSSI independientemente del número de zonas; no se necesita añadir una torre por zona.

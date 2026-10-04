# Mapa físico de torres

Este archivo es la fuente de verdad para convertir una MAC de torre en una columna RSSI estable. `torre_id` es lógico, dinámico y no representa una posición física.

## Configuración objetivo: zona 6 m × 2,5 m

Antes de la nueva captura, confirme que estas placas se coloquen en las mismas esquinas indicadas. Si cambia una posición, actualice esta tabla antes de entrenar.

| Ubicación física | MAC de la torre | Columna del modelo |
|---|---|---|
| Esquina superior izquierda | `10:06:1C:D5:95:8C` | `rssi_sup_izq` |
| Esquina superior derecha | `10:06:1C:D5:95:04` | `rssi_sup_der` |
| Esquina inferior izquierda | `10:06:1C:D4:8F:C4` | `rssi_inf_izq` |
| Esquina inferior derecha | `90:15:06:5A:30:D0` | `rssi_inf_der` |

## Cuadrícula

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

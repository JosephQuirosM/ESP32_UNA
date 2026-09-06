# Mapa físico de torres

Este archivo es la fuente de verdad para convertir la identidad física de una torre en una columna estable del dataset de calibración. La MAC es la identidad del dispositivo; `torre_id` es solamente un ID lógico asignado durante una sesión del Gateway.

## Estado

La tabla debe completarse antes de iniciar la calibración. No se deben inventar posiciones a partir del orden de asignación observado en el Gateway.

## MAC observadas en captura v3_1

Estas MAC fueron observadas como las cuatro torres de `data/raw/captura_v3_1.csv`. Su ubicación física sigue pendiente de verificación:

```text
10:06:1C:D5:95:04
90:15:06:5A:30:D0
10:06:1C:D5:95:8C
10:06:1C:D4:8F:C4
```

| Ubicación física | MAC de la torre | Columna KNN propuesta | Verificada el | Observaciones |
|---|---|---|---|---|
| Esquina superior izquierda | PENDIENTE | `rssi_sup_izq` | PENDIENTE | |
| Esquina superior derecha | PENDIENTE | `rssi_sup_der` | PENDIENTE | |
| Esquina inferior izquierda | PENDIENTE | `rssi_inf_izq` | PENDIENTE | |
| Esquina inferior derecha | PENDIENTE | `rssi_inf_der` | PENDIENTE | |

## Procedimiento de identificación

1. Coloque una etiqueta física única en cada torre.
2. Lea su MAC desde el registro serial o desde `mac_torre` en el CSV.
3. Coloque la torre en la ubicación correspondiente y registre la relación MAC→ubicación.
4. Verifique la tabla después de reiniciar el Gateway; el `torre_id` puede cambiar, pero la MAC debe permanecer igual.
5. Conserve una copia de esta tabla junto con cada dataset de calibración.

## Regla de procesamiento

El pipeline debe leer `mac_torre`, buscar su ubicación en esta tabla y construir siempre el mismo orden de características:

```text
[rssi_sup_izq, rssi_sup_der, rssi_inf_izq, rssi_inf_der]
```

Si una MAC no está en la tabla, la fila no debe entrar al entrenamiento ni a la predicción hasta resolver la identidad. El `torre_id` no puede sustituir esta búsqueda.

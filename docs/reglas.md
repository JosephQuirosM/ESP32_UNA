# Reglas del proyecto

1. Código, comentarios, mensajes seriales y documentación se escriben en español.
2. Cada función tiene una única responsabilidad y las funciones principales incluyen un comentario descriptivo.
3. `firmware/Comun/Paquete.h` es la única fuente de verdad del protocolo. Cualquier cambio incompatible exige incrementar `VERSION_PROTOCOLO`.
4. Todos los dispositivos del MVP usan ESP-NOW y Wi‑Fi de 2.4 GHz en el mismo canal, configurado en los `config.h`.
5. Los callbacks de ESP-NOW solo validan y copian información a una cola. No deben realizar HTTP, serial, archivos, demoras ni cálculos pesados.
6. Las colas son acotadas; los descartes y errores de entrega se informan por serial para no ocultar pérdida de datos.
7. Se validan firma, versión, tipo y tamaño antes de interpretar bytes recibidos como paquetes.
8. El enlace ESP-NOW del MVP no se cifra y solo debe utilizarse en el entorno de pruebas autorizado. La clave del hotspot debe modificarse antes de pruebas fuera del laboratorio.
9. Los IDs dinámicos se asocian a MAC solamente en memoria. No se asume persistencia después de reiniciar el Gateway.
10. No se fijan tareas de aplicación a núcleos durante este MVP. Esta decisión se revisará con métricas de cola, latencia y descartes.
11. Toda prueba física debe conservar CSV, logs seriales y un informe reproducible. Los hallazgos deben documentar por separado los hechos medidos, las hipótesis y la siguiente decisión técnica.
12. Los beacons y el control usan broadcast; los registros RSSI de Torre a Gateway usan unicast al peer aprendido desde `ASIGNACION_ID`.
13. Cada proceso reiniciable que genere secuencias debe incluir una sesión no nula. En v3 son obligatorias `sesion_gateway`, `sesion_torre` y `sesion_jugador`.
14. Todos los firmwares de una prueba deben usar la misma `VERSION_PROTOCOLO`; no se mezclan binarios v2 y v3 ni se anexan filas v3 a un CSV v2.
15. Al iniciar cualquier IdeaBoard, los GPIO 12, 13, 14 y 15 del driver L9110S se configuran como salida baja mientras los motores no formen parte de la prueba.
16. `torre_id` es lógico y dinámico; no representa por sí mismo una esquina o coordenada física.
17. Toda calibración o predicción KNN debe convertir `mac_torre` mediante una tabla MAC→ubicación física antes de formar el vector RSSI. No se permite entrenar con columnas `T1..T4` cuyo significado físico cambie entre capturas.
18. La tabla de ubicaciones debe conservarse junto con el dataset y versionarse cuando se cambie la posición de una torre. Un cambio de posición invalida o separa el dataset de calibración anterior.

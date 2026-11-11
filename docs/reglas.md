# Reglas del proyecto

1. Código, comentarios, mensajes seriales y documentación se escriben en español.
2. Cada función tiene una única responsabilidad y las funciones principales incluyen un comentario descriptivo.
3. `firmware/Comun/Paquete.h` es la única fuente de verdad del protocolo. Cualquier cambio incompatible exige incrementar `VERSION_PROTOCOLO`.
4. Todos los dispositivos usan ESP-NOW y Wi‑Fi de 2.4 GHz en el mismo canal, configurado en los `config.h`.
5. Los callbacks de ESP-NOW solo validan y copian información a una cola. No deben realizar HTTP, serial, archivos, demoras ni cálculos pesados.
6. Las colas son acotadas; los descartes y errores de entrega se informan por serial para no ocultar pérdida de datos.
7. Se validan firma, versión, tipo y tamaño antes de interpretar bytes recibidos como paquetes.
8. El enlace ESP-NOW no se cifra. La clave del hotspot debe ser propia de cada instalación y el acceso remoto requiere el código de autorización del backend.
9. Los IDs dinámicos se asocian a MAC solamente en memoria. No se asume persistencia después de reiniciar el Gateway.
10. No se fijan tareas de aplicación a núcleos; esta decisión se revisará con métricas de cola, latencia y descartes.
11. Toda prueba física debe conservar CSV, logs seriales y un informe reproducible. Los hallazgos deben documentar por separado los hechos medidos, las hipótesis y la siguiente decisión técnica.
12. Los beacons y el control usan broadcast; los registros RSSI de Torre a Gateway usan unicast al peer aprendido desde `ASIGNACION_ID`.
13. Cada proceso reiniciable que genere secuencias debe incluir una sesión no nula. En v3 son obligatorias `sesion_gateway`, `sesion_torre` y `sesion_jugador`.
14. Todos los firmwares de una prueba deben usar la misma `VERSION_PROTOCOLO`; no se mezclan binarios v2 y v3 ni se anexan filas v3 a un CSV v2.
15. Al iniciar cualquier IdeaBoard, los GPIO 12, 13, 14 y 15 del driver L9110S se configuran como salida baja mientras los motores no formen parte de la prueba.
16. `torre_id` es lógico y dinámico; no representa por sí mismo una esquina o coordenada física.
17. Toda calibración o predicción KNN debe convertir `mac_torre` mediante una tabla MAC→ubicación física antes de formar el vector RSSI. No se permite entrenar con columnas `T1..T4` cuyo significado físico cambie entre capturas.
18. La tabla de ubicaciones debe conservarse junto con el dataset y versionarse cuando se cambie la posición de una torre. Un cambio de posición invalida o separa el dataset de calibración anterior.
19. La PC ofrece el hotspot; el Gateway se conecta como estación y comienza el descubrimiento por UDP broadcast. En modo web el backend responde por unicast y Python no ocupa UDP 4210. La alternativa CLI independiente no se ejecuta a la vez que el backend.
20. El Gateway sólo admite RSSI durante una autorización UDP V3 vigente. Cada captura nueva limpia cola, lote y reintentos antes de confirmar; fuera de captura descarta telemetría. El receptor exige el ID HTTP de su captura. El inicio del plazo espera el ACK; jugador y torres no reciben órdenes nuevas y sus relojes/colas no se sincronizan.
21. La preparación asigna zona explícita por archivo, conserva incompletos y no aplica recortes temporales automáticos. La geometría de recolección (preset 3×3, hasta 20×20) debe conservarse en CSV, preparación, modelo y mapa. Deben rechazarse mezclas de geometrías incompatibles; el administrador configura las dimensiones desde el frontend.
22. La documentación del estado actual se mantiene en `docs/arquitectura.md` y los README. El roadmap y los materiales originales deben distinguir propuestas de capacidades implementadas. La existencia de artefactos locales ignorados por Git no constituye por sí sola evidencia de precisión.

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

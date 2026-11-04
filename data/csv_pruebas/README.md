# CSV de prueba

Los nueve `zona_N_entrenamiento.csv` son datos sintéticos preparados: 30 vectores completos por zona y cuatro RSSI en el orden físico documentado. Úsalos en Entrenamiento para crear un modelo de nueve zonas. Las señales se simularon con perfiles RSSI distintos por esquina; no son mediciones reales ni demuestran precisión.

Luego carga `prueba_modelo_jugador_1.csv` o `prueba_modelo_10_jugadores.csv` en Mapas con ese modelo. Son registros crudos con las columnas v3 del Gateway, MAC de las cuatro torres e IDs de sesión independientes. El archivo de diez jugadores contiene escenarios desde recepción completa y alta hasta huecos, lecturas parciales y un jugador sin vectores completos.

Para el jugador 3 se generan exactamente 100 secuencias esperadas (1–100), 75 paquetes RSSI recibidos y 60 vectores completos: 75 % de recepción de paquetes y 60 % de vectores completos. El jugador 9 ejemplifica el límite del cálculo por rango: sólo cuatro secuencias recibidas, pero el intervalo 1–100 implica muchas secuencias ausentes.

Todos los valores son inventados para probar rutas de entrenamiento, predicción, separación y estadísticas. No deben presentarse como datos experimentales.

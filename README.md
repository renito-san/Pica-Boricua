# Pica Boricua

El juego de las **picas de Puerto Rico** en tu teléfono: la mesa circular de 24 caballitos tallados, el piquero cantando la carrera y la regla de oro de la caseta — **gana el caballo más cerca de la línea final sin pasarse**.

Apuesta a un número, a la línea, a la cuarta o bajando; acumula tu récord de dinero, sube de nivel (Novato → Apostador → Conocedor → Piquero Mayor) y corre la Copa de la semana contra metas.

## Dinero ficticio

Todo el dinero del juego es **ficticio**: un saldo virtual que se repone solo y marcas que viven únicamente en tu teléfono.

**Se juega sin dinero real.** No hay apuestas de verdad, ni pagos, ni premios en dinero — es la tradición de las fiestas patronales, para jugar y recordar.

## Archivos

- `index.html` — el juego completo en un solo archivo.
- `logo.webp` — el logo oficial «Una sola línea» (desde la v15 vive como archivo; antes viajaba incrustado en base64 cuatro veces dentro del HTML).
- `sonidos/*.wav` — los sonidos aprobados del motor PicaSnd (manigueta variante C, tac, moneda, toc, victoria, derrota), byte a byte los mismos de siempre; desde la v15 se cargan por ruta en vez de incrustados en base64.
- `manifest.webmanifest` + `sw.js` — instalación como app (PWA) y juego sin conexión.
- `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` — iconos desde el logo oficial «Una sola línea».
- `tests/verificar-juez.mjs` — verificación automática del juez y de las liquidaciones (ver abajo).

## Notas técnicas (para developers)

**Arquitectura.** Un solo `index.html` autocontenido (HTML + CSS + JS, sin build ni dependencias de runtime) servido por GitHub Pages. La pista se dibuja en SVG: 4 carriles que son círculos concéntricos perfectos (radios 120/97/74/51, centro 200,150) y los caballitos son sprites SVG animados con `requestAnimationFrame` sobre un reloj virtual de carrera. El estado del jugador (saldo, historial, estadísticas, Copa, Torneo) vive en `localStorage` con claves versionadas `picaspr_*_v1` — no cambiarlas nunca sin migración, o los jugadores pierden su progreso.

**El juez.** `judgeFinals(finals)` es la única fuente de verdad del resultado: mide la punta de la nariz *tal como se dibuja* (TIP_X/TIP_Y en el marco rotado de cada sprite), la proyecta al arco de su carril con refinamiento por sección dorada hasta 0.00005 de arco, y declara ganador al más cerca de la línea sin cruzarla (empate bit a bit: gana el número menor). Los resultados se fijan *antes* de la animación: la presentación (incluida la cámara lenta del photo finish, que solo escala el reloj virtual de dibujo) no puede cambiar ganador, pasados ni liquidación. Liquidación: `credit = round2(monto × mult)` si la selección incluye al ganador (mult por tipo: número 20, línea 4, cuarta 5, bajando 5), con tope de saldo de $1,000.

**PWA y caché.** `sw.js` es cache-first con caché versionada por nombre (`pica-boricua-vNN`). Al publicar una versión nueva hay que subir el número: es lo que hace que los teléfonos suelten el HTML viejo. Todo lo que el juego necesite sin conexión (hoy: HTML, manifest, iconos, `logo.webp` y los 6 WAV) va en `PRECACHE_URLS`.

**Torneo en línea.** Backend Supabase: el cliente solo envía el delta de puntos y el servidor valida (función `submit_points`: solo semana en curso, tope 5,000 pts/semana y ritmo 600 pts/hora por dispositivo; `close_week` corona solo semanas pasadas). El saldo y las marcas locales nunca salen del teléfono.

**Medición.** GoatCounter cuenta visitas y eventos por espacio de auspiciador y por carrera; los eventos `instalar` e `instalada-apertura` deben aparecer exactamente una vez cada uno en el código.

**Verificar el juez antes de publicar:**

```sh
node tests/verificar-juez.mjs
```

Extrae la lógica real del juez desde `index.html` (sin copiarla a mano), corre 1,000 carreras sorteadas con la misma fórmula del juego, comprueba cada resultado contra un juicio independiente por barrido denso, verifica la tabla de pagos y las liquidaciones, y — si se le pasa la ruta de un `index.html` de la versión anterior como argumento — comprueba que los resultados sean idénticos entre versiones para las mismas carreras.

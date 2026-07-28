# Gestor de Cuentas

App móvil (PWA) para gestionar gastos e ingresos: cuánto te queda del sueldo,
qué te van a cobrar y cuándo, gastos recurrentes y préstamos con intereses,
histórico por semanas y meses, y proyección a años vista.

**Cero dependencias.** No hay `npm install`, ni `node_modules`, ni build. Es HTML,
CSS y JavaScript con módulos ES nativos. Nada que actualizar y ninguna superficie
de ataque de cadena de suministro.

**Tus datos no salen del dispositivo.** Todo se guarda en el `localStorage` del
navegador. No hay cuentas, ni analítica, ni una sola petición de red más allá de
descargar la propia app.

> Matiz importante, porque "sin servidor" a secas se malinterpreta: **no hay
> backend que guarde tus datos**. Pero como toda web, los archivos hay que
> servirlos desde algún sitio — `tools/serve.py` ya es un servidor, solo que es
> el tuyo. La pregunta nunca es *servidor sí o no*, sino **de quién**.
> Ver [Instalar en el móvil](#instalar-en-el-móvil).

---

## Arrancar

```bash
python tools/serve.py
```

Y abre <http://localhost:5178>.

El script imprime también la IP de tu red local, para abrir la app desde el móvil
estando en la misma wifi.

> ¿Por qué no `python -m http.server`? Porque no manda cabeceras de caché y el
> navegador se queda con versiones viejas de los `.js` al editarlos.
> `tools/serve.py` añade `Cache-Control: no-store` y los tipos MIME correctos.

## Pruebas

```bash
python tools/serve.py
```

Y abre <http://localhost:5178/tests/test.html>. Son 63 comprobaciones del motor
financiero (fechas, recurrencias, amortización, TAE, proyección, confirmación de
cobros, presupuesto del mes) que corren en el navegador. Salen en verde o en
rojo, sin instalar nada.

## Instalar en el móvil

Para que se instale como app (icono en el escritorio, pantalla completa, modo
offline) el navegador exige un **contexto seguro**: `https://` o `localhost`. Por
`http://192.168.x.x` la app funciona igual en el navegador, pero no se instala.

El conflicto es ese: **local sin instalar** siempre se puede; **local e
instalada** choca con esa regla. HTTPS exige un certificado, que exige un dominio
y una autoridad certificadora, y ahí aparece alguien externo — no por la app,
sino por el candado.

| Opción | Icono + offline | Terceros | Hace falta |
|---|---|---|---|
| **1. Por la IP de tu wifi** | No | **Ninguno** | `python tools/serve.py`, PC encendido |
| **2. Hosting estático** (Netlify, GitHub Pages…) | Sí | Sí, sirven tu código | Arrastrar la carpeta |
| **3. Servidor en el propio móvil** (Termux) | Sí | **Ninguno** | Termux + toquetear |

**Opción 1** — lo que llevas usando en desarrollo, pero desde el móvil. Cero
terceros, pero sin icono ni offline y con el PC encendido.

**Opción 2** — la práctica. Se sube la carpeta tal cual, sin build. Publicar el
código no expone nada: lo que se sube es el programa; tus datos siguen en tu
móvil. Contrapartida honesta: quien sirve tu JavaScript podría alterarlo. Lo
mitiga el service worker, que tras la primera carga sirve todo desde la caché del
móvil.

**Opción 3** — un servidor HTTP en el propio Android (Termux + `python -m
http.server`). Como `http://localhost` **sí** es contexto seguro, se instala y
funciona offline sin que intervenga nadie. Es la única forma de tenerlo todo sin
terceros. No está probada aquí, y es la más incómoda de montar.

Una vez servida por HTTPS, en Android Chrome: menú ⋮ → *Instalar aplicación*. En
iPhone Safari: *Compartir* → *Añadir a pantalla de inicio*.

> ⚠️ **`localStorage` va por origen.** Si pruebas en una URL y luego cambias a
> otra, los datos NO te siguen: hay que exportar en la vieja e importar en la
> nueva. Elige dónde va a vivir antes de meter datos de verdad.

## Copias de seguridad

Los datos viven en el navegador. **Si borras los datos de navegación, se borran.**
Desde *Ajustes → Exportar copia de seguridad* se descarga un JSON con todo. Es
también la forma de pasar los datos a otro dispositivo (exportar aquí, importar
allí).

---

## Qué hace

### Resumen
**Te queda para gastar**: el dinero que tienes menos lo que ya está comprometido
este mes. Barra de cuánto llevas gastado del sueldo. Avisos de los cobros que
llegan y de los que ya han pasado sin confirmar.

### Movimientos puntuales
Gastos e ingresos sueltos, con categoría, fecha y concepto. **El motivo es
obligatorio** (categoría o concepto), para que el calendario y el histórico
siempre puedan decir en qué fue el dinero. Se ven en **lista** o en un
**calendario** mensual: tocas un día y sale el resumen de ingresos y gastos de
ese día con su motivo.

### Recurrentes
Dos tipos:

- **Fijo / periódico** — nómina, alquiler, suscripciones. Frecuencia semanal,
  quincenal, mensual, bimestral, trimestral, semestral o anual. Puede ser
  indefinido, durar N pagos o terminar en una fecha. Admite **revalorización
  anual** (%), para lo que sube con el IPC.
- **Préstamo** — capital, TIN, plazo, seguro mensual y comisión de apertura.
  Calcula cuota, cuadro de amortización completo, intereses totales y **TAE**.

Cada vencimiento se puede **marcar como cobrado**, corrigiendo el importe si te
cobraron otra cosa, o marcarlo como no cobrado. Ver
[Confirmación de cobros](#confirmación-de-cobros).

### Cartera (inversiones)
Sigue tu inversión (MyInvestor u otra), **aparte del día a día**. Registras lo
que **aportas** de tu bolsillo y anotas cada par de días el **valor total** que
te marca el broker. La app calcula **aportado / ganado / valor total** y dibuja
una **gráfica de puntos** de cómo sube y baja, por semanas o por meses.

Detalle importante: la **ganancia** es `valor − aportado`, así que meter dinero
no cuenta como haber ganado (la gráfica de ganancia es neutral a las
aportaciones — enseña solo lo que hace el mercado). No toca tu "te queda para
gastar": es una sección independiente.

### Histórico
Cuánto has ganado y gastado **por semana** (de lunes a domingo) y **por mes**,
en qué se te va, y **consejos concretos para recortar**: reglas sobre tus
propias cifras, con el número que las dispara y una estimación de ahorro. Nada
de "controla tus gastos hormiga".

### Proyección
Evolución del saldo a 1, 2, 5 o 10 años, con el detalle por año o mes a mes.
Avisa si el saldo se te va a negativo y en qué mes.

---

## Avisos de cobro

Hay un límite técnico que conviene conocer antes de esperar nada:

> **Una PWA no puede programar una notificación para una fecha futura.**
> La API que lo permitía (Notification Triggers) se quedó en experimento y nunca
> llegó a producción. Sin un servidor, el navegador solo puede notificar mientras
> hay código ejecutándose.

De ahí salen las dos vías que hay:

| | Cuándo avisa | Coste | Datos fuera del móvil |
|---|---|---|---|
| **Avisos al abrir la app** | Cada vez que abres la app | 0 € | No |
| **Calendario (.ics)** | A la hora exacta, con la app cerrada | 0 € | Solo a tu calendario |

**Avisos al abrir la app.** Cada vez que la abres —y al volver a ella tras un
rato en segundo plano— te notifica si hay cobros próximos o vencidos sin
confirmar. Si no hay nada que decir, calla. La app enseña además un banner con
los pendientes y un botón para confirmarlos de golpe.

Lo que no hace, y no puede hacer: avisarte si no abres la app.

**Calendario.** Para eso está esta. Exportas un `.ics` desde *Ajustes → Avisos de
cobro*, lo importas una vez en Google Calendar y ya está: notificación real a la
hora exacta aunque no toques la app. Los eventos llevan `RRULE`, así que el
calendario los proyecta solo hacia el futuro y no hay que volver a exportar
nunca.

> Hubo un servidor push (VAPID + Web Push) y se quitó a propósito: exigía una
> máquina encendida 24/7 con HTTPS, dependencias de criptografía y guardar tus
> cobros fuera del móvil, y a cambio solo conseguía que la notificación la
> mandara la app en vez del calendario. No compensaba.

---

## Criterio de cálculo del saldo

Esto es lo único que conviene entender para que los números tengan sentido:

```
saldo en una fecha  =  saldo inicial
                     + Σ movimientos puntuales   ⎤ entre trackingStart
                     + Σ vencimientos recurrentes ⎦ y esa fecha
```

Es decir: **los recurrentes se dan por cobrados/pagados en su fecha**. Son las
facturas que sabes que van a pasar; no hay que anotar el alquiler todos los meses.
Los movimientos puntuales son los extras que registras a mano.

`trackingStart` (*Ajustes → Punto de partida*) es la fecha desde la que se cuenta.
Existe para que un recurrente antiguo ("alquiler desde 2019") no arrastre años de
histórico inventado a tu saldo de hoy. El saldo inicial es el que tenías **ese
día**.

La consecuencia práctica: el saldo de hoy y la proyección de dentro de 5 años
salen de la misma fórmula, así que nunca se contradicen.

### Confirmación de cobros

Un vencimiento recurrente puede estar en cuatro estados:

| Estado | Cuándo | ¿Cuenta para el saldo? |
|---|---|---|
| `previsto` | Aún no ha llegado la fecha | Solo en la proyección |
| `asumido` | Pasó la fecha, no lo has confirmado | **Sí**, por el importe previsto |
| `cobrado` | Lo has confirmado | Sí, por el importe real que indiques |
| `omitido` | Has marcado que no te lo cobraron | No |

**Los vencidos se descuentan solos**, sin esperar a que los confirmes. Es
deliberado: si hiciera falta confirmarlos para que contasen, bastaría con no
abrir la app durante un mes para que el saldo mintiera. Confirmar sirve para
**cerrarlos** y para **corregir** lo que de verdad pasó (te cobraron 60 en vez de
45, o te lo cobraron tres días tarde).

Corolario: confirmar un cobro por su importe previsto **no mueve el saldo**. Si
lo moviera, sería que estaba mal contado antes.

Una confirmación puede cambiar la fecha del cargo, y eso puede sacarlo de su mes.
Por eso `flowsBetween()` genera las ocurrencias con 45 días de margen a cada lado
y filtra después por la fecha efectiva: si no, un cobro previsto el 30 de junio y
confirmado el 2 de julio se perdería en los dos meses.

### Detalles financieros

- **Préstamos**: sistema francés de cuota constante,
  `cuota = P·i / (1 − (1+i)⁻ⁿ)`, con `i = TIN/12` (la convención española).
  La última cuota se ajusta unos céntimos para liquidar el saldo exacto y que el
  cuadro cierre en cero.
- **TAE**: se resuelve por bisección el tipo interno que iguala el neto recibido
  con el valor actual de los pagos, incluyendo comisión de apertura y seguro;
  luego se anualiza. Es una estimación: tu banco puede incluir otros gastos.
- **Revalorización**: se aplica por años completos desde el primer pago, no
  prorrateada.

Es una herramienta de orientación, no asesoramiento financiero.

---

## Estructura

```
index.html              Esqueleto y barra de navegación
manifest.webmanifest    Metadatos de instalación (PWA)
sw.js                   Service worker: caché offline, clic en notificación, push
css/styles.css          Toda la hoja de estilos (tema claro/oscuro automático)
js/
  app.js                Arranque y router por hash
  state.js              Estado, persistencia en localStorage, import/export
  finance.js            Motor: recurrencias, amortización, TAE, proyección, saldos
  format.js             Formato de dinero y fechas (fechas como "YYYY-MM-DD")
  ui.js                 h(), modales, toasts, helpers de DOM
  charts.js             Gráficos SVG dibujados a mano
  forms.js              Formularios de movimiento, recurrente y confirmación
  advice.js             Reglas de los consejos para recortar gasto
  calendar.js           Generador de .ics (RFC 5545)
  notify.js             Notificaciones al abrir la app
  views/                Una pestaña por archivo
icons/                  icon.svg + los PNG del manifest
tools/
  serve.py              Servidor de desarrollo (sin caché)
  make_icons.py         Regenera los PNG a partir del diseño
tests/test.html         Pruebas del motor financiero (63)
```

### Al tocar el código

- **Fechas**: siempre cadenas `"YYYY-MM-DD"`, parseadas a mano.
  Nunca `new Date("2026-01-31")`: ese constructor las trata como UTC y en husos al
  oeste de Greenwich devuelve el día anterior.
- **Importes**: se guardan siempre en positivo. El signo lo pone `kind`
  (`'ingreso'` / `'gasto'`), y `signed()` es el único sitio que lo aplica.
- **`setChildren()` en vez de `replaceChildren()`** cuando algún hijo pueda ser
  `null`: `replaceChildren(null)` pinta literalmente el texto "null".
- **Al editar cualquier archivo de `PRECACHE`, sube `VERSION` en `sw.js`**, o los
  navegadores con la app ya instalada seguirán sirviendo la versión vieja.
  (En desarrollo, si un cambio no aparece: el service worker sirve la copia
  cacheada y refresca por detrás, así que la segunda recarga ya la trae.)
- **Iconos**: se editan en `icons/icon.svg`; luego `python tools/make_icons.py`
  regenera los PNG con el mismo diseño.
- **`.ics`**: el texto se escribe con saltos de línea reales y es `esc()` quien
  los convierte al `\n` de iCalendar. Escaparlos a mano los rompe (doble escape).
  Y el plegado de líneas se mide en **octetos**, no en caracteres: partir por
  caracteres rompería un UTF-8 multibyte y el archivo quedaría corrupto.

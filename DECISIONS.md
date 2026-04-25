# Econ Studio — Decision Log

> Este archivo registra las decisiones técnicas y de arquitectura del proyecto,
> con el razonamiento detrás de cada una. Su propósito es que cualquier
> desarrollador (o el propio autor meses después) entienda *por qué* se hizo
> algo así, no solo *qué* se hizo.
>
> Formato: cada entrada tiene contexto, decisión, y alternativas descartadas.

---

## Tabla de contenidos

1. [Stack base: React + Vite](#1-stack-base-react--vite)
2. [Sin librerías de charting externas — SVG puro](#2-sin-librerías-de-charting-externas--svg-puro)
3. [Sin librerías de UI externas](#3-sin-librerías-de-ui-externas)
4. [Pipeline no-destructivo](#4-pipeline-no-destructivo)
5. [Motor de cómputo: JS puro con fallback, DuckDB-WASM diferido](#5-motor-de-cómputo-js-puro-con-fallback-duckdb-wasm-diferido)
6. [Geocoding: Photon/Komoot en lugar de Nominatim](#6-geocoding-photonkomoot-en-lugar-de-nominatim)
7. [Egreso de datos: choke point único en AIService.js](#7-egreso-de-datos-choke-point-único-en-aiservicejs)
8. [Tipografía: IBM Plex Mono](#8-tipografía-ibm-plex-mono)
9. [Persistencia: localStorage para pipeline, IndexedDB diferido](#9-persistencia-localstorage-para-pipeline-indexeddb-diferido)
10. [Desktop target: Tauri diferido](#10-desktop-target-tauri-diferido)
11. [Parsing de Excel/CSV: SheetJS vía CDN](#11-parsing-de-excelcsv-sheetjs-vía-cdn)
12. [Idioma de la UI: inglés](#12-idioma-de-la-ui-inglés)
13. [Documentación técnica: diferida hasta engine estable](#13-documentación-técnica-diferida-hasta-engine-estable)

---

## 1. Stack base: React + Vite

**Contexto:**
Econ Studio corre enteramente en el browser. Necesitábamos un framework de UI
moderno que permitiera componentes reutilizables, manejo de estado local, y un
entorno de desarrollo rápido. El proyecto apunta eventualmente a un instalador
desktop nativo.

**Decisión:** React 18 + Vite.

**Por qué React:**
React es el framework de UI más adoptado del ecosistema JavaScript. Eso implica
ecosistema maduro, documentación abundante, y que cualquier desarrollador
contratado en el futuro ya lo conoce. Para una aplicación con decenas de
componentes interactivos (tablas, controles de modelos, plots) es la opción
con menor fricción.

**Por qué Vite y no Create React App (CRA) u otros:**
CRA está deprecado desde 2023. Vite ofrece hot-module replacement casi
instantáneo y builds significativamente más rápidos. Es el estándar de facto
para nuevos proyectos React.

**Alternativas descartadas:**
- *Vue / Svelte:* ecosistemas más chicos, menor disponibilidad de desarrolladores
  con experiencia en computación científica.
- *Vanilla JS:* inmanejable a la escala de componentes que tiene el proyecto.
- *Next.js:* diseñado para aplicaciones server-side. Econ Studio es 100% cliente,
  el modelo server-side agrega complejidad sin beneficio.

---

## 2. Sin librerías de charting externas — SVG puro

**Contexto:**
La aplicación necesita gráficos estadísticos: scatter plots, histogramas,
Q-Q plots, RDD binned scatter, forest plots. Las opciones habituales son
D3.js, Recharts, Chart.js, o Plotly.

**Decisión:** SVG generado directamente en React. Sin dependencias de charting.

**Por qué:**
Las librerías de charting de propósito general (Recharts, Chart.js) están
optimizadas para dashboards de negocio — barras, líneas, tortas. Los gráficos
estadísticos que necesitamos (residuals vs. fitted, Q-Q con banda de confianza,
RDD binned scatter con CI) o no existen en esas librerías o requieren tanto
customización que escribirlos desde cero es más rápido.

D3.js es poderoso pero introduce un paradigma de manipulación del DOM que choca
con el modelo declarativo de React. La integración correcta es compleja y
propensa a bugs de sincronización.

SVG puro en React es: predecible, sin dependencias, sin conflictos de versiones,
y los gráficos quedan exactamente como los necesitamos.

**Costo:** más código inicial por gráfico. Beneficio: control total, cero
dependencias, bundle más chico.

---

## 3. Sin librerías de UI externas

**Contexto:**
Existen librerías de componentes UI para React: Material UI, Ant Design,
Shadcn/ui, Chakra UI, etc.

**Decisión:** Estilos inline con un objeto de constantes de color (`C`). Sin
librerías de componentes.

**Por qué:**
Econ Studio tiene una estética deliberada — herramienta científica, no app
corporativa. Las librerías de UI imponen un lenguaje visual que es difícil
de sobreescribir sin pelear contra sus defaults. Además, cada librería agrega
entre 50-300KB al bundle y un ciclo de actualizaciones externo que puede
introducir breaking changes.

El objeto `C` centraliza todos los colores del proyecto. Cualquier cambio de
paleta es un cambio en un solo lugar.

**Alternativa considerada:** Tailwind CSS (solo clases utilitarias, sin
componentes). No descartado permanentemente — podría incorporarse si el equipo
crece y la consistencia visual se vuelve difícil de mantener manualmente.

---

## 4. Pipeline no-destructivo

**Contexto:**
El módulo de wrangling aplica transformaciones secuenciales sobre datos:
limpieza, creación de variables, joins, etc.

**Decisión:** El pipeline almacena un array de *steps* serializables (JSON).
Cada ejecución parte del `rawData` original y reproduce todos los steps en
orden. El dataset original nunca se mutado.

**Por qué:**
Este es el mismo modelo que usan herramientas como dplyr (R) o el Query Editor
de Power BI. Sus ventajas son:

1. *Reproducibilidad:* dado el mismo `rawData` y el mismo array de steps,
   el resultado es siempre idéntico. Esto es un requisito para el replication
   package que journals académicos exigen.
2. *Auditabilidad:* el pipeline JSON es legible por humanos. Un supervisor puede
   revisar qué transformaciones se aplicaron sin leer código.
3. *Undo/redo gratuito:* revertir un step es simplemente removerlo del array
   y re-ejecutar. No hay que "deshacer" transformaciones en el dataset.
4. *Persistencia trivial:* el array JSON se guarda en localStorage sin
   serialización especial.

**Alternativa descartada:** mutar el dataset en memoria (el modelo de Stata con
`replace`, `generate`, `drop`). Más rápido de implementar inicialmente, pero
imposible de auditar, reproducir, o deshacer de forma confiable.

**Invariante crítico:** ningún step puede mutar `rawData`. Todo step recibe
una copia y devuelve una copia transformada.

---

## 5. Motor de cómputo: JS puro en el MVP, DuckDB-WASM como destino final

**Contexto:**
Las operaciones de pipeline (filter, groupBy, join, agregaciones) y los
estimadores econométricos corren enteramente en el browser, sin servidor.
El objetivo es soportar datasets de hasta varios millones de filas — tamaños
reales en datos de panel con variables geográficas.

**Por qué el browser puede con esto (explicación no-técnica):**
JavaScript, el lenguaje que corre en el browser, fue diseñado originalmente
para hacer páginas web interactivas — no para analizar datos masivos. Con
100k filas funciona bien. Con 2 millones, empieza a ser lento porque procesa
los datos fila por fila en la memoria del tab del browser.

DuckDB-WASM resuelve esto de raíz. DuckDB es una base de datos analítica
usada por data engineers profesionales para procesar cientos de millones de
filas en segundos. WebAssembly (WASM) es un formato que permite correr ese
motor de base de datos *dentro del browser*, con rendimiento cercano al de
una aplicación nativa. En términos simples: en lugar de que JavaScript haga
el trabajo fila por fila, DuckDB lo hace en bloques columna por columna, que
es órdenes de magnitud más eficiente para operaciones analíticas.

**Decisión:**
- **MVP:** JS puro. Suficiente para datasets < ~200k filas con velocidad aceptable.
- **Destino final:** DuckDB-WASM para todas las operaciones de pipeline,
  con JS puro como fallback de emergencia. No hay razón para mantener dos
  motores en paralelo a largo plazo — DuckDB es superior en todos los tamaños.

**Por qué diferir la integración de DuckDB:**
Integrar DuckDB requiere manejar conversiones de formato de datos (JS arrays →
Apache Arrow → DuckDB y de vuelta), inicialización asíncrona, y reescribir
todas las operaciones de pipeline en SQL o en la API de DuckDB. Es trabajo
correcto pero significativo. Hacerlo mientras el feature set todavía está
cambiando multiplica el retrabajo. La arquitectura ya tiene prevista la
separación `core/engine/duckdb/` vs `core/engine/fallback/` para que
cuando se integre, el resto de la aplicación no necesite cambiar.

**Criterio de activación:** cuando el feature set de wrangling y estimadores
esté estable, o antes si usuarios reales reportan lag con sus datasets.

**Nota importante — instalación local con Tauri:**
Todo lo anterior aplica mientras la aplicación corre en el browser. Cuando
se empaquete como instalable nativo (Tauri), el modelo de cómputo cambia
completamente. Tauri provee un backend en Rust que corre fuera del sandbox
del browser, con acceso directo al hardware. En ese contexto:
- DuckDB corre en su versión nativa (no WASM), significativamente más rápida
  al no tener la capa de traducción de WebAssembly.
- El procesador puede usar todos sus núcleos en paralelo.
- El límite de memoria es la RAM del sistema, no la del tab del browser.
- Datasets de decenas de millones de filas se vuelven manejables sin problema.

La arquitectura: React (UI) le pide al backend Rust que ejecute una operación
→ Rust corre DuckDB nativo → devuelve el resultado a React para mostrarlo.
El usuario ve exactamente la misma interfaz. Esta es una de las razones
principales por las que Tauri es el target correcto para una herramienta
científica seria, y por qué el salto de browser a instalable no es solo
cosmético — es un cambio sustancial en capacidad de cómputo.

---

## 6. Geocoding: Photon/Komoot como default, endpoints compatibles como opción

**Contexto:**
El módulo de wrangling incluye geocoding de direcciones (columna de texto →
latitud/longitud). El proveedor más conocido de geocoding open-source es
Nominatim (OpenStreetMap).

**Decisión:** arquitectura de dos niveles configurable desde Settings:
- **Default (sin configuración):** Photon API de Komoot — gratuito, funciona
  out-of-the-box para todos los usuarios.
- **Avanzado (opt-in):** endpoint compatible con Nominatim — el usuario ingresa
  su propia URL y API key en Settings.

**Por qué no Nominatim público como default:**
El servidor público gratuito de Nominatim (nominatim.openstreetmap.org) bloquea
requests desde el browser por política CORS. CORS es un mecanismo de seguridad
del browser que impide que una aplicación web llame a servidores externos que
no lo autoricen explícitamente. Nominatim público no lo autoriza, por lo que
es técnicamente imposible usarlo directamente sin un servidor intermediario
propio — lo que contradice el principio de instalación local sin infraestructura.

**Por qué Photon como default:**
Photon (Komoot) tiene CORS habilitado, está basado en datos de OpenStreetMap
(misma calidad geográfica que Nominatim), es gratuito para uso razonable, y
soporta parámetros de bounding box para restringir resultados por región
(presets incluidos: CABA, München). Cero configuración para el usuario final.

**Por qué el nivel avanzado:**
Proveedores compatibles con la API de Nominatim (Geoapify, LocationIQ, o un
servidor Nominatim propio como podría tener LMU Munich) sí tienen CORS
habilitado y ofrecen mayor cuota de requests, mayor precisión en regiones
específicas, o privacidad total de las queries. Un departamento universitario
con servidor propio puede apuntar la aplicación a ese servidor.

**UI propuesta en Settings:**
```
Geocoding Provider
  ● Photon/Komoot  (default — no configuration needed)
  ○ Custom endpoint  [ URL ________________ ]  [ API Key _______ ]
```

**Limitación conocida de Photon:** no tiene SLA de disponibilidad garantizado.
Si Komoot discontinúa el servicio público, el fallback es activar un endpoint
propio. La arquitectura ya lo contempla.

---

## 7. Egreso de datos: choke point único en AIService.js

**Contexto:**
Econ Studio procesa datos de investigación que pueden contener información
sensible (IDs de personas, variables económicas confidenciales). La aplicación
hace llamadas externas a la API de Anthropic para narrativas y análisis AI.

**Decisión:** `AIService.js` es el único punto donde datos salen del browser.
Toda llamada a API externa pasa por este archivo. Un módulo `privacyFilter.js`
sanitiza los datos antes de cualquier egreso.

**Por qué:**
La privacidad no es una feature, es una propiedad arquitectural. Si el filtro
de privacidad está distribuido en múltiples componentes, inevitablemente alguno
lo omite. Un único choke point garantiza que *es imposible* enviar datos sin
pasar por el filtro.

Esto también facilita auditoría: para saber qué datos salen de la aplicación,
hay exactamente un archivo que leer.

**Implicación de diseño:** los componentes de UI nunca llaman a APIs externas
directamente. Siempre delegan a `AIService.js`.

---

## 8. Tipografía: IBM Plex Mono

**Contexto:**
Decisión de diseño visual para toda la interfaz.

**Decisión:** IBM Plex Mono como tipografía única del proyecto.

**Por qué:**
Econ Studio es una herramienta científica, no una app de consumo. IBM Plex Mono
comunica precisión, output técnico, y seriedad académica — el mismo registro
visual que tiene una terminal o un editor de código. Es open source (sin costo
de licencia), tiene excelente legibilidad en tamaños pequeños (importante para
tablas de coeficientes), y carga bien desde Google Fonts.

---

## 9. Persistencia: localStorage para pipeline, IndexedDB diferido

**Contexto:**
El estado de la aplicación (pipeline de steps, configuración del modelo,
data dictionary) necesita persistir entre sesiones.

**Decisión:** localStorage para pipeline JSON y configuración. IndexedDB
diferido para datasets grandes.

**Por qué localStorage:**
El pipeline serializado a JSON raramente supera unos pocos KB. localStorage
tiene una API síncrona y simple, cero configuración. Es suficiente para
el caso de uso actual.

**Por qué diferir IndexedDB:**
Almacenar datasets completos en el browser (potencialmente decenas de MB)
requiere IndexedDB — localStorage tiene un límite de ~5-10MB según el browser.
IndexedDB tiene una API asíncrona más compleja y requiere manejo de versiones
de schema. Se implementa cuando el caso de uso de "proyecto persistente con
dataset incluido" sea una prioridad real.

---

## 10. Desktop target: Tauri diferido

**Contexto:**
El objetivo de largo plazo es distribuir Econ Studio como instalador nativo
(Windows, Mac, Linux) comparable a instalar R o Stata, con persistencia local
de proyectos.

**Decisión:** Tauri como framework desktop. Integración diferida hasta que
el feature set esté completo.

**Por qué Tauri y no Electron:**
Tauri usa el webview nativo del sistema operativo en lugar de empaquetar
Chromium completo. Resultado: instaladores de ~10MB vs ~150MB de Electron.
El backend es Rust, que da acceso al sistema de archivos y APIs nativas con
rendimiento excelente. Para una herramienta científica que puede procesar
datasets grandes, el footprint importa.

**Por qué diferir:**
Agregar el toolchain de Rust durante el desarrollo activo de features introduce
fricción en cada iteración. La arquitectura React/Vite no requiere ningún cambio
para correr dentro de Tauri — es simplemente una webview apuntando al mismo
código. Cuando el feature set esté congelado, la migración es de horas, no
de semanas.

**Criterio de activación:** cuando el set de estimadores core y el módulo de
wrangling estén completos y estables.

**Qué cambia en el código al migrar (y qué no):**

El 95% del código no se toca. Tauri trata el frontend React exactamente como
un browser — abre una ventana del OS con un webview adentro que muestra la
app. Todo el engine matemático, el pipeline, los componentes UI, y AIService
funcionan sin modificación.

Lo que sí cambia son exactamente tres cosas puntuales:

1. **Apertura de archivos:** hoy el usuario arrastra un archivo al browser.
   Con Tauri se reemplaza por el diálogo nativo del sistema operativo
   ("Abrir archivo"). Es llamar una función de Tauri — baja complejidad.

2. **Persistencia:** hoy se usa localStorage. Con Tauri se reemplaza por
   archivos `.json` reales en el disco del usuario, lo que habilita proyectos
   genuinamente persistentes entre sesiones. Implica reescribir `localStorage.js`
   — complejidad media, cambio localizado.

3. **Motor de cómputo:** DuckDB-WASM se reemplaza por DuckDB nativo corriendo
   en Rust (ver punto 5). Es trabajo nuevo, no reescritura del código existente.

**El proceso de empaquetamiento en sí es tres comandos:**
```bash
npm install @tauri-apps/cli
npx tauri init    # genera la carpeta /src-tauri con el backend Rust
npx tauri build   # compila y genera el instalador .exe / .dmg / .deb
```
El instalador resultante pesa ~10MB porque Tauri usa el webview nativo del
sistema operativo, a diferencia de Electron que empaqueta Chrome completo
(~150MB).

Lo que sí agrega complejidad operativa es el toolchain de Rust — hay que
tenerlo instalado en el entorno de desarrollo para poder compilar. No es
difícil, pero es un paso extra que ralentiza la iteración diaria. Esa es
la razón concreta de diferirlo, no la complejidad de la migración en sí.

---

## 11. Parsing de Excel/CSV: SheetJS vía CDN

**Contexto:**
Los usuarios cargan datasets en formato Excel (.xlsx) y CSV. Se necesita una
librería de parsing que corra en el browser.

**Decisión:** SheetJS (xlsx), importado dinámicamente desde el CDN oficial.

**Patrón de import:**
```js
import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs")
```

**Por qué no `npm install xlsx`:**
La versión de SheetJS disponible en npm está desactualizada. SheetJS migró
su distribución principal a su propio CDN a partir de versiones recientes.
Usar el CDN garantiza la versión correcta y actualizaciones controladas.

**Por qué import dinámico:**
SheetJS es pesado (~1MB). Con import dinámico solo se carga cuando el usuario
efectivamente sube un archivo, no en el bundle inicial. Esto mantiene el tiempo
de carga inicial de la aplicación corto.

---

## 12. Idioma de la UI: inglés

**Contexto:**
El mercado objetivo primario es académico internacional, con LMU Munich como
caso de uso concreto. Versiones anteriores del proyecto tenían UI en español.

**Decisión:** toda la UI, outputs de AI, y mensajes del sistema en inglés.

**Por qué:**
Los papers académicos se escriben en inglés. Los outputs de la aplicación
(tablas LaTeX, narrativas de regresión, replication packages) son insumos
directos para papers. Si los labels de la UI están en inglés, el flujo
mental del researcher es consistente. Una UI en español que exporta en inglés
crea fricción cognitiva innecesaria.

---

## 13. Documentación técnica: diferida hasta engine estable

**Contexto:**
El proyecto necesita eventualmente tres documentos: `ARCHITECTURE.md`
(estructura y decisiones técnicas), `MATH_REFERENCE.md` (derivaciones
matemáticas de cada estimador), y `USER_GUIDE.md` (tutorial para researchers).

**Decisión:** documentación técnica formal diferida. Este archivo (`DECISIONS.md`)
es la única documentación activa durante el desarrollo.

**Por qué:**
Documentar antes de que el código esté estable genera documentación desactualizada
al día siguiente. `MATH_REFERENCE.md` en particular debe ser una fotografía fiel
de los estimadores implementados — escribirlo antes implica reescribirlo con
cada refactor del engine.

**Criterio de activación:**
- `ARCHITECTURE.md`: cuando la estructura de carpetas de `Estructura_provisoria`
  esté congelada.
- `MATH_REFERENCE.md`: cuando el econometric engine (linear, panel, causal)
  esté completo y estable. Cada estimador nuevo agrega su sección en el mismo PR.
- `USER_GUIDE.md`: cuando haya usuarios reales (LMU pilot).

---

*Última actualización: 2026-04-01*
*Próxima revisión sugerida: al completar el econometric engine core.*

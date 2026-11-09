# The Noter — Roadmap de implementación

Estado: **en ejecución**
Última actualización: 2026-11-09

Este documento recoge la validación del estado actual, el plan completo de pendientes y el
registro de etapas. Cada etapa se implementa de forma aislada, con pruebas propias y un commit
que indica la etapa completada.

---

## 1. Validación del estado actual

The Noter es una SPA Angular 22 (standalone components, signals, zoneless, Angular CDK) con
estética editorial y minimalista. El modelo es **local-first**: cada cambio se guarda primero en
`localStorage` y después se sincroniza con **CouchDB** mediante `fetch`, sin PouchDB ni service
worker.

### Base técnica

- Angular `^22.2.0`, SCSS con variables CSS y temas claro/oscuro.
- Tipografías autoalojadas: Newsreader (serif), Nunito (sans) e Inter (interfaz).
- KaTeX para matemáticas y highlight.js para código.
- Vitest + jsdom para pruebas unitarias.
- CouchDB 3 con Docker Compose, usuario de app con permisos restringidos y configuración runtime
  en `/sync-config.json`.

### Funcionalidades principales

- Notas con título, icono, cover, metadatos visibles y bloques reordenables por drag & drop.
- Bloques de texto, heading, lista, imagen, código, función y sub-nota.
- Anidación de notas con árbol en la sidebar, breadcrumbs y bloques de sub-nota editables inline.
- Búsqueda por título, metadatos, texto, listas y columnas de imagen.
- Outline derecho generado desde los headings, con indentación y navegación por clic.
- Columnas de texto e imagen (hasta 4), con apilado responsive.
- Imágenes por archivo, arrastre, pegado o URL, con escalado/compresión y reemplazo.
- Markdown parcial: código inline, enlaces, URLs, headings `#`, listas `-/*/+` y `1.`, fences
  ` ``` ` y atajos `$$`, ` `` `, `#>`, `#`…`######`.
- LaTeX en bloques de función: detección automática, normalización de documentos/tablas y render
  con KaTeX; toggle `TeX`.
- Cover con dos layouts (`Contenido` y `Apaisado`), reencuadre por arrastre y posición persistida.
- Iconos emoji, texto corto o imagen (archivo/URL), visibles en el título y la sidebar.
- Metadatos `label → value` con helpers `now()`, `today()`, `time()` y formatos personalizados.
- Código con resaltado, lenguajes, bloques de función y cheat sheet de atajos.
- Sidebars colapsables, rail del outline, drawer móvil, contador de palabras y estado flotante.
- Sincronización local-first con CouchDB: push por `_bulk_docs`, pull por `_changes`, tombstones,
  copias de conflicto, reintentos con backoff, estado en la sidebar y funcionamiento offline.

### Validación de la lista solicitada

| # | Función | Estado | Evidencia / implementación | Matiz |
|---|---------|--------|----------------------------|-------|
| 1 | Compatibilidad TeX/LaTeX | ✅ Implementada, alcance acotado | `latex.ts`, `ui/latex.ts`, bloque `function`, toggle `TeX`, KaTeX lazy, normalización de documentos/tablas, enlaces seguros | ⏳ Pendiente | — 
| 2 | Edición Markdown | 🟡 Parcial | `markdown.ts`, `ui/markdown-inline.ts`, headings, listas, fences, código inline, enlaces y shortcuts | ⏳ Pendiente | — 
| 3 | Anidación de notas | ✅ Implementada | `parentId`, `noteTree`, breadcrumbs, sub-nota inline, indentación en sidebar, borrado que reasigna hijos | ⏳ Pendiente | — 
| 4 | Iconos en notas | ✅ Implementada | Presets emoji, texto corto, imagen por archivo o URL; icono en título y sidebar | ⏳ Pendiente | — 
| 5 | Imagen de cover | ✅ Implementada | Archivo/arrastre, layouts `content`/`landscape`, reencuadre por arrastre, reemplazo y eliminación | ⏳ Pendiente | — 
| 6 | Índice en panel derecho desde headings | ✅ Implementada | `note-outline`: headings 1–6, indentación, clic para hacer scroll y enfocar, ocultar/rail/overlay móvil | ⏳ Pendiente | — 
| 7 | Imágenes dentro de notas | ✅ Implementada | Bloques de imagen, columnas de imagen, archivo/arrastre/URL/pegado, compresión, caption, reemplazo y borrado | ⏳ Pendiente | — 
| 8 | Bloques con columnas | ✅ Implementada | Columnas de texto e imagen hasta 4, menú de columnas, apilado responsive, columnas ocultas preservadas | ⏳ Pendiente | — 
| 9 | Metadatos en notas | ✅ Implementada | `NoteMeta[]`, añadir/editar/eliminar, helpers de fecha/hora, entrada `creación` por defecto | Son solo pares texto→texto. No hay tipos (fecha, número, select, checkbox), filtros, ordenación ni plantillas. |

**Conclusión:** las nueve funciones están presentes. Markdown y LaTeX deben considerarse
**parciales en alcance**; el resto está implementado de forma funcional, con margen de pulido y
endurecimiento para producción.

**Validación ejecutada:** `npm test` en `frontend/` → **318 tests, 22 archivos, todos pasan**.

---

## 2. Criterios de trabajo

1. Implementar una funcionalidad por etapa, sin mezclar áreas.
2. Añadir o actualizar pruebas de la etapa y ejecutar la suite completa antes del commit.
3. Mantener el comportamiento existente; si una etapa toca sync, probar también el camino offline.
4. Hacer un commit por etapa con el mensaje `tipo(área): etapa N - descripción`.
5. Actualizar este documento después de cada etapa, marcando lo completado y la siguiente etapa.
6. Verificar el build en un directorio temporal si `frontend/dist` no es escribible.

---

## 3. Plan priorizado

### P0 — Crítico antes de usar a diario

#### P0.1 — Sacar las imágenes del JSON y de `localStorage`

- [ ] Subir imágenes como attachments de CouchDB, idealmente content-addressed (`asset:<hash>`).
- [ ] Cache local de blobs en IndexedDB para render offline.
- [ ] Evitar base64 duplicado y liberar la cuota de ~5 MB.
- [ ] **Done when:** una nota con varias fotos no agota `localStorage` y las imágenes siguen
      visibles offline.

#### P0.2 — Migrar el store local a IndexedDB

- [ ] Mantener el orden “local primero, red después”.
- [ ] Guardar notas, cursor de sync, revisiones y colas en IndexedDB.
- [ ] Añadir migración desde `the-noter.notes.v1`.
- [ ] **Done when:** la app soporta notebooks grandes sin el límite de 5 MB y sin reescribir todo
      el array en cada edición.

#### P0.3 — Completar Markdown y LaTeX inline

- [x] Markdown inline: negrita, cursiva, tachado y escapes.
- [x] Markdown inline en previews de texto, headings, listas y columnas.
- [x] LaTeX inline en texto/headings/listas: `$...$`, `\(...\)`, `$$...$$`.
- [ ] Blockquote, regla horizontal, task lists, tablas simples y footnotes.
- [ ] Imágenes Markdown y sanitización de HTML.
- [ ] **Done when:** se puede escribir una nota mixta con prosa, matemáticas inline y tablas sin
      salir del editor.

#### P0.4 — Seguridad de datos del usuario

- [ ] Papelera con restauración, en vez de borrado definitivo inmediato.
- [ ] Undo/redo a nivel de nota o bloque.
- [x] Export/import JSON completo y backup descargable.
- [ ] Export Markdown/PDF/HTML.
- [ ] **Done when:** un borrado accidental o una nota corrupta se puede recuperar sin tocar
      CouchDB.

#### P0.5 — Endurecer la sincronización

- [ ] Compactación y purga programada de tombstones/revisiones.
- [ ] Migraciones de `schema`.
- [ ] UI para conflictos (ver las dos versiones y elegir/mezclar).
- [ ] Botón de “sincronizar ahora” y diagnóstico del estado.
- [ ] **Done when:** el usuario entiende y controla qué pasó con un conflicto, y la base no crece
      indefinidamente.

### P1 — Completar la experiencia de las funciones pedidas

#### P1.1 — Anidación

- [ ] Mover/reparentar notas existentes desde la UI.
- [ ] Persistir el estado expandido/colapsado de la sidebar.
- [ ] Límite de profundidad y mensajes claros ante ciclos.
- [ ] Navegación padre/hijo más directa en el editor.
- [ ] **Done when:** se puede reorganizar el árbol completo sin crear notas nuevas.

#### P1.2 — Iconos y covers

- [ ] Picker de iconos con búsqueda.
- [ ] Categorías y recientes.
- [ ] Cover desde URL.
- [ ] Galería de portadas y presets de color/degradado.
- [ ] Texto alternativo y mejor control de encuadre en móvil.
- [ ] **Done when:** elegir icono/cover es rápido y no requiere conocer una URL de memoria.

#### P1.3 — Outline

- [x] Scrollspy: resaltar el heading visible.
- [ ] Incluir headings de sub-notas.
- [ ] Colapsar/expandir secciones y navegación por teclado.
- [ ] **Done when:** el outline refleja la posición actual y permite navegar secciones largas.

#### P1.4 — Imágenes y columnas

- [ ] Alt text, lightbox/zoom, alineación y tamaño.
- [ ] Columnas mixtas (texto + imagen + código) y anchos ajustables.
- [ ] Arrastrar bloques entre columnas.
- [ ] Galerías y ajustes de compresión.
- [ ] **Done when:** una nota puede maquetarse con bloques mixtos sin trucos.

#### P1.5 — Metadatos

- [ ] Tipos: texto, número, fecha, URL, select, checkbox.
- [ ] Campos automáticos: creación, última edición, palabras.
- [ ] Filtros/ordenación por metadatos y visualización en tarjetas/sidebar.
- [ ] Plantillas de metadatos por tipo de nota.
- [ ] **Done when:** los metadatos sirven para organizar y filtrar, no solo para mostrar texto.

#### P1.6 — Búsqueda y navegación

- [x] Command palette (`Ctrl/Cmd + K`).
- [ ] Resaltado de coincidencias y filtros por tipo/fecha/metadato.
- [ ] Búsquedas guardadas, recientes y favoritos.
- [ ] **Done when:** encontrar y abrir cualquier nota toma pocos segundos.

#### P1.7 — Internacionalización y accesibilidad

- [ ] Centralizar textos y fechas; la UI mezcla inglés y español.
- [ ] Revisión ARIA, foco, contraste, navegación completa por teclado y `prefers-reduced-motion`.
- [ ] **Done when:** la app es usable con teclado y lector de pantalla y no mezcla idiomas.

### P2 — Calidad, escala y distribución

#### P2.1 — Testing

- [ ] E2E con Playwright para flujos reales (crear, anidar, sincronizar, conflicto).
- [ ] Pruebas de integración contra CouchDB real, no solo mocks.
- [ ] Visual regression y auditoría de accesibilidad con axe.
- [ ] Presupuesto de rendimiento.

#### P2.2 — Rendimiento

- [ ] Virtualización de listas largas de notas/bloques.
- [ ] Persistencia incremental en lugar de serializar todo el notebook.
- [ ] Carga diferida de más dependencias y decodificación de imágenes.

#### P2.3 — Seguridad y acceso remoto

- [ ] TLS, CSP y modelo de credenciales mejor que una contraseña estática en `/sync-config.json`.
- [ ] Rate limiting y revisión de CORS.
- [ ] Sync cifrado o, al menos, transporte seguro antes de exponer fuera de localhost.

#### P2.4 — PWA y móvil

- [ ] Instalación, service worker y cache offline real.
- [ ] App móvil o PWA pulida; gestos táctiles para sidebar, outline y bloques.

---

## 4. Nice to have — inspirado en Notion y Obsidian

### Organización del conocimiento

- [ ] Tags/etiquetas con filtros y vista por tag.
- [ ] Backlinks y menciones no enlazadas.
- [ ] Grafo global y local de notas enlazadas.
- [ ] Daily notes y notas periódicas.
- [ ] Plantillas de nota y de bloques.
- [ ] Favoritos / fijados / recientes.
- [ ] Papelera y historial de versiones.
- [ ] Alias de notas y enlaces bidireccionales.
- [ ] Bandeja de entrada / captura rápida.

### Edición y bloques

- [ ] Slash menu (`/`) para insertar bloques.
- [ ] Callouts, toggles, divisores y columnas de layout.
- [ ] Tablas simples y, más adelante, bases de datos con propiedades.
- [ ] Vistas Kanban, calendario, timeline, tabla, lista y galería.
- [ ] Fórmulas, relaciones y rollups en bases de datos.
- [ ] Bloques sincronizados y referencias a bloques.
- [ ] Footnotes, Mermaid, embeds y bookmarks.
- [ ] Comentarios y menciones.
- [ ] Matemáticas inline y bloques math dedicados.

### Navegación y búsqueda

- [ ] Command palette global.
- [ ] Quick switcher entre notas.
- [ ] Búsqueda global con resaltado, filtros y operadores.
- [ ] Pestañas y paneles divididos.
- [ ] Outline con scrollspy y navegación por teclado.
- [ ] Breadcrumbs ya implementados.

### Personalización

- [ ] Galería de temas y temas sepia/oscuros.
- [ ] CSS personalizado y snippets.
- [ ] Colores de acento y ancho de página.
- [ ] Packs de iconos y covers.
- [ ] Atajos configurables.
- [ ] Sistema de plugins.

### Sync, colaboración y distribución

- [ ] Colaboración en tiempo real (Yjs/Automerge).
- [ ] Compartir, permisos y publicación web.
- [ ] Presencia, comentarios y menciones.
- [ ] Historial de versiones con diff.
- [ ] PWA/móvil/escritorio.
- [ ] Sync cifrado y sync selectivo.
- [ ] Web clipper y captura por email.

### Import/export e IA

- [ ] Importar desde Notion y Obsidian.
- [ ] Exportar a Markdown, PDF, HTML, JSON y ZIP con adjuntos.
- [ ] Imprimir/exportar PDF.
- [ ] IA: resumir, reescribir, responder preguntas sobre las notas, búsqueda semántica y
      auto-etiquetado.

---

## 5. Registro de etapas

| Etapa | Alcance | Estado | Commit |
|-------|---------|--------|--------|
| 0 | Roadmap y checkpoint del trabajo previo | ✅ Completada | `chore: checkpoint current work before roadmap implementation` / `docs: add staged implementation roadmap` |
| 1 | Markdown inline completo (negrita, cursiva, tachado, escapes) | ✅ Completada | `feat(markdown): etapa 1 - formato inline completo` |
| 2 | LaTeX inline en texto, headings, listas y columnas | ✅ Completada | `feat(latex): etapa 2 - matematicas inline en texto` |
| 3 | Export/import JSON de backup | ✅ Completada | `feat(data): etapa 3 - exportar e importar backup JSON` |
| 4 | Command palette (`Ctrl/Cmd + K`) | ✅ Completada | `feat(navigation): etapa 4 - command palette` |
| 5 | Scrollspy del outline | ✅ Completada | `feat(outline): etapa 5 - resaltado de seccion activa` |
| 6 | Mover/reparentar notas y persistir árbol | ⏳ Pendiente | — |
| 7 | Metadatos tipados | ⏳ Pendiente | — |
| 8 | Búsqueda de iconos y cover por URL | ⏳ Pendiente | — |
| 9 | Almacenamiento de imágenes como attachments + IndexedDB | ⏳ Pendiente | — |
| 10 | Papelera, undo/redo y export Markdown/PDF | ⏳ Pendiente | — |
| 11 | Endurecimiento de sync (compactación, migraciones, conflictos) | ⏳ Pendiente | — |
| 12 | Búsqueda con resaltado, filtros y favoritos | ⏳ Pendiente | — |
| 13 | E2E, accesibilidad, i18n y rendimiento | ⏳ Pendiente | — |

### Próxima etapa

**Etapa 6 — Mover/reparentar notas y persistir el árbol.** Añadir una acción para mover una nota
existente a otro padre (o a la raíz), evitar ciclos y recordar el estado expandido/colapsado de la
sidebar.

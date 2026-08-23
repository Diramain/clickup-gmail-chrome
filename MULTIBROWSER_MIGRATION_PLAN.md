# TaskBridge Multi-Browser Migration Plan

Plan de seguimiento para retirar los restos de InboxSDK y portar TaskBridge a
Firefox desde la base estable de Chrome, manteniendo una sola fuente y dos
distribuciones independientes.

## Baseline

- Fecha del plan: 2026-08-23.
- Base integrada: `main` en `dd556a40dc413bdb71dfa08dbbff44ab605ef572`.
- Release candidate Chrome: `2.1.0` en
  `chore/remove-inboxsdk-remnants`, commit
  `c620ad5 feat: release TaskBridge v2.1.0`.
- Release de rollback: `v2.0.1`.
- Distribuciones objetivo: Chrome Web Store y Firefox Add-ons (AMO).
- Repositorio: uno.
- Codigo compartido: uno.
- Artefactos, manifiestos, OAuth, firma y publicacion: separados por navegador.
- El workspace experimental anterior de Firefox fue eliminado y no es una
  fuente valida para esta migracion.
- La ficha HKS vigente aun describe ese workspace eliminado y queda
  `needs-review`; no usar sus manifests, builds ni decisiones como entrada.

## Estados

- `[ ]` Pendiente.
- `[~]` En curso.
- `[x]` Completado y validado.
- `[!]` Bloqueado; registrar causa y siguiente decision.
- `[-]` Cancelado o fuera de alcance; registrar motivo.

Solo se marca `[x]` cuando el codigo, la validacion requerida y la evidencia
del paso estan completos.

## Reglas De Ejecucion

1. Completar y cerrar el Plan A antes de comenzar el Plan B.
2. Usar una rama y un PR independientes para cada plan.
3. Mantener los cambios de cada fase en commits pequenos y reversibles.
4. No publicar en CWS ni AMO como parte de una fase de implementacion.
5. No usar credenciales, correos ni workspaces productivos en fixtures o logs.
6. No copiar material de firma o identidad entre Chrome y Firefox.
7. Mantener Chrome como gate obligatorio durante todo el port.
8. Detener el avance ante una regresion de seguridad, Gmail, autenticacion,
   almacenamiento o release.

---

## Plan A: Retiro De Restos InboxSDK

### Objetivo

Eliminar codigo y menciones activas de InboxSDK sin cambiar el comportamiento
observable de Gmail.

### Rama Y Rollback

- Rama prevista: `chore/remove-inboxsdk-remnants`.
- Baseline: `v2.0.1`.
- Rollback antes del merge: descartar la rama.
- Rollback despues del merge: revertir el commit del Plan A.
- Rollback despues de distribuir: reinstalar/publicar el artefacto verificado de
  `v2.0.1`; no borrar ni reemplazar esa release durante este plan.

### Alcance Tecnico

- [x] A1. Crear la rama desde `main` limpio y registrar el commit inicial.
- [x] A2. Confirmar que no existen dependencias, imports, cargas remotas o
  inicializaciones de InboxSDK en fuente, lockfile y paquete.
- [x] A3. Eliminar el selector residual
  `data-inboxsdk-user-email-address` de `src/gmail-adapter.ts`.
- [x] A4. Eliminar `getUserEmail()` y sus tipos si la comprobacion de usos sigue
  confirmando que no tienen consumidores.
- [x] A5. Sustituir el comentario de build sobre InboxSDK por una descripcion
  neutral del entrypoint legacy retirado.
- [x] A6. Sustituir el comentario residual `InboxSDK Sidebar Panel` en
  `styles/gmail-native.css` por el nombre funcional actual del componente.
- [x] A7. Regenerar JavaScript desde TypeScript; no editar archivos compilados
  manualmente.
- [x] A8. Agregar una comprobacion automatizada que impida reintroducir
  InboxSDK en codigo o artefactos distribuibles.
- [x] A9. Confirmar que los cambios no amplian permisos, hosts ni datos enviados.

### QA Automatizada

- [x] A10. Pruebas focales de `GmailAdapter`.
- [x] A11. Pruebas de sanitizacion, vinculacion y adjuntos Gmail.
- [x] A12. TypeScript estricto.
- [x] A13. Suite completa.
- [x] A14. Build de produccion.
- [x] A15. Preflight exacto del release.
- [x] A16. Inspeccion del ZIP: sin InboxSDK, secretos, archivos de desarrollo o
  material de firma.

### QA Manual Chrome

Responsable: owner. Cargar como extension descomprimida
`dist/extension`. Informar cada paso como `PASS` o `FAIL` y, ante un fallo,
anotar solo el comportamiento observado sin correos, tokens ni payloads reales.

- [x] A17. Cargar el build en un perfil Chrome de prueba.
- [x] A18. Abrir Gmail y navegar entre bandeja e hilos.
- [x] A19. Confirmar lectura de asunto, remitente, cuerpo e ID estable del hilo.
- [x] A20. Abrir el modal de crear/vincular tarea.
- [x] A21. Confirmar render de tareas vinculadas.
- [x] A22. Crear una tarea en un destino de prueba autorizado.
- [x] A23. Probar seleccion explicita de adjuntos compatibles.
  Correctivo listo para retest: `v2.0.1` limitaba la busqueda al `.gs` del
  cuerpo, pero Gmail tambien renderiza tarjetas en footers hermanos, incluso
  fuera de `.adn` en respuestas. El adapter asigna cada tarjeta al cuerpo
  anterior mas cercano sin mezclar mensajes. La seleccion admite PNG, JPEG,
  GIF, WebP, PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, TXT, CSV, ZIP y RAR; rechaza
  SVG, formatos Office con macros, ejecutables y scripts. Tambien descubre
  imagenes embebidas sin tarjeta de adjunto cuando Gmail las sirve desde
  `mail.google.com`; no habilita hosts de imagenes externos.
- [x] A24. Probar hilos con varios mensajes, recarga y cambio de hilo.
- [x] A25. Confirmar ausencia de errores nuevos y datos sensibles en consola.
  Retest completado por el owner con la misma version `2.1.0` enviada a CWS;
  todos los correctivos reportados quedaron validados en Chrome.

### Gate A

- [x] A26. No quedan menciones activas de InboxSDK en fuente o distribucion.
- [x] A27. QA automatizada verde.
- [x] A28. QA manual Chrome verde.
- [x] A29. Revision del diff y del rollback completada.
- [ ] A30. PR aprobado e integrado.

### Seguimiento Chrome Web Store

- [x] A31. Cargar el ZIP exacto `2.1.0` y confirmar la version del borrador.
- [x] A32. Cancelar la revision obsoleta `2.0.0` sin afectar la version publica
  `1.2.0`.
- [x] A33. Actualizar descripcion e imagenes de la ficha para reflejar adjuntos
  ampliados, imagenes inline, miniaturas, limites y exclusiones de seguridad.
- [x] A34. Enviar `2.1.0` a revision sin publicacion automatica.
- [~] A35. Esperar la respuesta de Chrome Web Store; `1.2.0` permanece publica
  hasta la aprobacion y publicacion manual de `2.1.0`.

**Estado Plan A:** `QA_CHROME_GREEN_A30_PENDING`.

---

## Plan B: Port Firefox Y Distribucion AMO

### Objetivo

Producir Chrome y Firefox desde una sola base, con paridad de seguridad y
artefactos independientes. El primer corte Firefox puede validar Gmail,
ClickUp, Meet y tiempo antes de habilitar Google Calendar.

### Rama Y Estrategia De Rollback

- Rama prevista: `feat/firefox-port`.
- Inicio permitido: solo despues de Gate A verde.
- Cada fase debe quedar en un commit o conjunto acotado y reversible.
- Chrome debe seguir compilando y pasando su QA en cada fase.
- Funciones Firefox incompletas permanecen desactivadas y no declaradas como
  disponibles.
- No se envia a AMO mientras falle Gmail, OAuth, seguridad o reproducibilidad.

### Fase B0: Contrato Y Matriz De Compatibilidad

- [ ] B0.1. Definir versiones minimas soportadas de Chrome y Firefox.
- [ ] B0.2. Inventariar APIs WebExtensions usadas y clasificar: compartida,
  adaptador requerido o implementacion por navegador.
- [ ] B0.3. Congelar criterios funcionales de Gmail, ClickUp, Meet, tiempo y
  Calendar.
- [ ] B0.4. Definir nombres, versiones y contenido exacto de ambos artefactos.
- [ ] B0.5. Definir Gecko ID estable sin reutilizar identidad de Chrome.

**Gate B0:** matriz revisada, alcance cerrado y cero cambios funcionales.

### Fase B1: Build Multi-Browser

- [ ] B1.1. Crear manifiestos fuente o generador determinista para Chrome y
  Firefox.
- [ ] B1.2. Mantener `background.service_worker` para Chrome.
- [ ] B1.3. Usar `background.scripts` para Firefox.
- [ ] B1.4. Generar `dist/chrome` y `dist/firefox` sin mezclar archivos.
- [ ] B1.5. Mantener allowlists y validadores separados por target.
- [ ] B1.6. Producir ZIP independientes y hashes SHA-256.
- [ ] B1.7. Agregar `web-ext lint` para Firefox.
- [ ] B1.8. Agregar jobs CI separados para Chrome y Firefox.

**Gate B1:** ambos paquetes reproducibles; Chrome sin regresiones; Firefox carga
temporalmente sin errores de manifiesto.

### Fase B2: Adaptador WebExtensions

- [ ] B2.1. Evaluar y fijar una version revisada de `webextension-polyfill`.
- [ ] B2.2. Crear una unica frontera para runtime, storage, tabs, windows,
  alarms, action e identity.
- [ ] B2.3. Normalizar Promises, callbacks y `runtime.lastError`.
- [ ] B2.4. Evitar detecciones de navegador dispersas por el producto.
- [ ] B2.5. Agregar pruebas contractuales para Chrome y Firefox.

**Gate B2:** mensajeria, popup, app, pestañas y alarmas funcionan en ambos
navegadores; Chrome conserva su comportamiento.

### Fase B3: Paridad De Seguridad

- [ ] B3.1. Derivar origen e identidad confiables con `runtime.getURL()` y
  `runtime.id`.
- [ ] B3.2. Validar paginas permitidas sin hardcodear `chrome-extension://`.
- [ ] B3.3. Sustituir la dependencia de `storage.setAccessLevel()`.
- [ ] B3.4. Mantener credenciales, tokens y material de cifrado detras de una
  persistencia controlada por el background.
- [ ] B3.5. Demostrar que content scripts no pueden leer credenciales.
- [ ] B3.6. Mantener esquemas, allowlists y limites de mensajes actuales.
- [ ] B3.7. Implementar exportacion diagnostica Firefox sin
  `showSaveFilePicker()` y sin ampliar datos capturados.

**Gate B3:** revision de seguridad verde y pruebas negativas de acceso a
credenciales en ambos navegadores.

### Fase B4: Firefox Funcional Sin Calendar

- [ ] B4.1. Cargar TaskBridge temporalmente en un perfil Firefox limpio.
- [ ] B4.2. Validar token personal de ClickUp.
- [ ] B4.3. Validar Gmail: inyeccion, navegacion, lectura y modal.
- [ ] B4.4. Validar crear y vincular tareas en un destino de prueba.
- [ ] B4.5. Validar adjuntos seleccionados.
- [ ] B4.6. Validar seguimiento de tiempo y navegacion ClickUp.
- [ ] B4.7. Validar Meet Priority opt-in.
- [ ] B4.8. Validar reinicio, actualizacion y restauracion de estado.
- [ ] B4.9. Mantener Calendar visible como no disponible o desactivado hasta B6.

**Gate B4:** Firefox funcional para Gmail, ClickUp, Meet y tiempo; Chrome sigue
verde; Calendar no presenta una capacidad falsa.

### Fase B5: OAuth ClickUp En Firefox

- [ ] B5.1. Obtener el redirect estable derivado del Gecko ID.
- [ ] B5.2. Registrar el redirect en una aplicacion OAuth de prueba autorizada.
- [ ] B5.3. Validar `getRedirectURL()` y `launchWebAuthFlow()`.
- [ ] B5.4. Validar `state`, errores, cancelacion, logout y reconexion.
- [ ] B5.5. Confirmar que ningun secreto se registra o incluye en el paquete.

**Gate B5:** login, uso, logout y reconexion ClickUp verdes en Firefox.

### Fase B6: Google Calendar OAuth Firefox

- [ ] B6.1. Diseñar el flujo Firefox con `launchWebAuthFlow()`, `state` y PKCE.
- [ ] B6.2. Registrar un cliente y redirect compatibles con Firefox.
- [ ] B6.3. Mantener el scope read-only minimo actual.
- [ ] B6.4. Implementar ciclo de token, expiracion, revocacion y desconexion.
- [ ] B6.5. Validar agenda, enlaces Meet y vinculacion local con tarea.
- [ ] B6.6. Probar cancelacion, scope denegado, token vencido y red fallida.
- [ ] B6.7. Confirmar que Chrome conserva su proveedor de identidad actual.

**Gate B6:** Calendar read-only verde en Firefox y sin regresion Chrome.

### Fase B7: QA De Release Multi-Browser

- [ ] B7.1. Ejecutar suites y builds de ambos targets desde un checkout limpio.
- [ ] B7.2. Ejecutar QA manual completa en Chrome estable.
- [ ] B7.3. Ejecutar QA manual completa en Firefox estable.
- [ ] B7.4. Verificar perfiles limpios, actualizacion y reinicio.
- [ ] B7.5. Comparar permisos, hosts, CSP y archivos de los dos paquetes.
- [ ] B7.6. Escanear ambos ZIP y verificar hashes.
- [ ] B7.7. Revisar accesibilidad y comportamiento desktop.
- [ ] B7.8. Documentar diferencias funcionales reales sin prometer paridad falsa.

**Gate B7:** QA Chrome y Firefox verde, artefactos exactos y rollback probado.

### Fase B8: Preparacion AMO

- [ ] B8.1. Completar ficha, descripcion, iconos y capturas Firefox.
- [ ] B8.2. Declarar permisos y categorias de datos de acuerdo con el runtime.
- [ ] B8.3. Actualizar politica de privacidad y documentacion de soporte.
- [ ] B8.4. Preparar fuente revisable y pasos de build reproducible para AMO.
- [ ] B8.5. Confirmar ausencia de codigo remoto, ofuscacion y archivos no usados.
- [ ] B8.6. Preparar paquete beta y notas de version.
- [ ] B8.7. Solicitar autorizacion humana separada antes de enviar a AMO.
- [ ] B8.8. Registrar respuesta de AMO, observaciones y correcciones sin afectar la
  distribucion Chrome.

**Gate B8:** paquete apto para envio; publicacion externa todavia requiere una
aprobacion explicita.

### Fase B9: Cierre Web Y Descubribilidad

- [ ] B9.1. Actualizar la pagina publica de TaskBridge solo cuando la
  disponibilidad real de Chrome o Firefox cambie.
- [ ] B9.2. Publicar el enlace AMO unicamente despues de que exista una ficha
  aprobada y accesible; no anunciar compatibilidad Firefox antes de Gate B7.
- [ ] B9.3. Mantener accesibles la pagina principal, privacidad, terminos y
  soporte, con claims alineados al comportamiento distribuido.
- [ ] B9.4. Actualizar `lastmod` en `sitemap.xml` solo si cambia contenido
  publico; no modificar el sitemap por una release sin cambios en esas paginas.
- [ ] B9.5. Confirmar que `robots.txt` declara el sitemap y permite indexacion de
  las paginas publicas de TaskBridge.
- [ ] B9.6. Verificar sitemap en Google Search Console y solicitar indexacion de
  las URLs modificadas, sin convertir SEO en bloqueo de rollback o seguridad.

**Gate B9:** pagina publica y stores describen la misma disponibilidad; sitemap
valido y sin URLs falsas o retiradas.

**Estado Plan B:** `BLOQUEADO_POR_A30`.

---

## Registro De Evidencia

Agregar una linea por ejecucion relevante. No incluir tokens, IDs personales,
correos, payloads reales ni trazas sensibles.

| Fecha | Paso | Resultado | Evidencia segura | Rollback probado |
| --- | --- | --- | --- | --- |
| 2026-08-23 | Plan inicial | Documentado | Este archivo | No aplica |
| 2026-08-23 | A1-A9 | Limpieza implementada | Diff local en `chore/remove-inboxsdk-remnants` | Pendiente |
| 2026-08-23 | A10-A12 | QA focal y typecheck verdes | 20/20 pruebas focales; `tsc --noEmit` | No aplica |
| 2026-08-23 | A13 | Suite completa verde | 531/531 pruebas | No aplica |
| 2026-08-23 | A14-A16 | Build, preflight y ZIP verdes | ZIP temporal SHA-256 `d5446aaec80b9d7b856803b734755134128a425671c26f1a99023221d4c2c936` | Pendiente |
| 2026-08-23 | A26-A27 | Gate automatico verde | Escaneo fuente + preflight de contenido release | No aplica |
| 2026-08-23 | A17, A20, A25 | Build y modal cargan; QA bloqueada por autenticacion | Warning sanitizado y traza JSONL segura de 84 eventos | Pendiente |
| 2026-08-23 | A23 | Correctivo ampliado listo para retest manual | 28/28 pruebas focales; 531 pruebas de suite verdes y desfase documental corregido con 8/8 focales; typecheck, build y preflight verdes | Pendiente |
| 2026-08-23 | A23 | Imagenes inline y diagnostico de subida listos para retest | EML revisado por estructura sin exponer contenido; 38/38 focales; suite 535 verdes y asercion documental corregida 8/8; typecheck, build y preflight verdes | Pendiente |
| 2026-08-23 | A23 | Redirect de entrega Gmail y tiempo opcional corregidos | Host final exacto allowlisted; `timeTracked` vacio omitido; 33/33 focales; suite 537 verdes y asercion estatica corregida 11/11; typecheck, build y preflight verdes | Pendiente |
| 2026-08-23 | A21, A23 | Refresco de tareas eliminadas y respuestas Gmail SW corregidos | Doble confirmacion remota inmediata; revalidacion al volver a Gmail; 61/61 focales; suite 537 verdes y asercion documental corregida 8/8; typecheck, build y preflight verdes | Pendiente |
| 2026-08-23 | A23 | Vista de miniaturas opcional lista para QA manual | Carga diferida solo para imagenes permitidas; documentos conservan filas; seleccion independiente; suite 539/539, typecheck, build y preflight verdes | Pendiente |
| 2026-08-23 | A13-A16, A29 | Release candidate `2.1.0` verificada | Suite 539/539; typecheck, build, preflight y ZIP integros; SHA-256 `a10fbf53e9e227054a3c6cb62c00dd770aaf6048079911fa7fdbc1a95b3566b8`; rollback `v2.0.1` preservado | Pendiente |
| 2026-08-23 | A31-A35 | `2.1.0` enviada a Chrome Web Store | Borrador `2.1.0` confirmado pendiente de revision; `1.2.0` sigue publica; publicacion automatica desactivada | No aplica |
| 2026-08-23 | A33 | Ficha CWS alineada con `2.1.0` | Descripcion actualizada; icono 128x128, cinco capturas 1280x800 y mosaicos 440x280/1400x560 validados como PNG RGB sin alfa | No aplica |
| 2026-08-23 | A18-A25, A28 | QA manual Chrome verde | Owner valido en Chrome la misma version `2.1.0` enviada a CWS y confirmo todos los correctivos como funcionales | No aplica |
| 2026-08-23 | B9 discovery | Sitemap publico ya incluye TaskBridge | `/taskbridge/`, `/taskbridge/privacy/` y `/taskbridge/terms/` presentes; `robots.txt` declara `sitemap.xml`; sin cambio requerido hasta modificar contenido publico | No aplica |

## Registro De Decisiones

| ID | Fecha | Decision | Motivo |
| --- | --- | --- | --- |
| DEC-01 | 2026-08-23 | Un repositorio y dos distribuciones | Evitar divergencia funcional y de seguridad |
| DEC-02 | 2026-08-23 | Eliminar el workspace Firefox experimental | Era una prueba incompleta y no confiable |
| DEC-03 | 2026-08-23 | Limpiar InboxSDK antes del port | Partir de una base comprobada y auditable |
| DEC-04 | 2026-08-23 | Mantener `v2.0.1` como rollback | Release estable, publicada y verificada |
| DEC-05 | 2026-08-23 | El owner ejecuta A17-A25 | La QA requiere sesiones Gmail/ClickUp autenticadas y una escritura de prueba |
| DEC-06 | 2026-08-23 | El envio a CWS no cierra Gate A | La revision externa no reemplaza QA manual Chrome ni integracion a `main` |
| DEC-07 | 2026-08-23 | No reutilizar la copia Firefox historica documentada en HKS | Fue eliminada y contradice la estrategia vigente de una sola fuente; HKS queda `needs-review` |
| DEC-08 | 2026-08-23 | Actualizar sitemap solo ante cambios publicos | Las URLs TaskBridge ya estan incluidas; una release sin cambios de pagina no justifica alterar `lastmod` |

## Estado General

- Plan A: `QA_CHROME_GREEN_A30_PENDING`.
- Plan B: `BLOQUEADO_POR_A30`.
- Chrome Web Store: `2.1.0` pendiente de revision; `1.2.0` publica; publicacion
  automatica desactivada.
- Publicacion AMO: no autorizada.

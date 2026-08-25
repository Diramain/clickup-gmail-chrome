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
- [x] A30. PR #2 aprobado e integrado en `main` mediante merge commit
  `92a54437c993fecba37943d2b59ec1c500080108`.

### Seguimiento Chrome Web Store

- [x] A31. Cargar el ZIP exacto `2.1.0` y confirmar la version del borrador.
- [x] A32. Cancelar la revision obsoleta `2.0.0` sin afectar la version publica
  `1.2.0`.
- [x] A33. Actualizar descripcion e imagenes de la ficha para reflejar adjuntos
  ampliados, imagenes inline, miniaturas, limites y exclusiones de seguridad.
- [x] A34. Enviar `2.1.0` a revision sin publicacion automatica.
- [~] A35. Esperar la respuesta de Chrome Web Store; `1.2.0` permanece publica
  hasta la aprobacion y publicacion manual de `2.1.0`.

**Estado Plan A:** `GATE_A_GREEN`.

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

- [x] B0.1. Definir versiones minimas soportadas de Chrome y Firefox.
- [x] B0.2. Inventariar APIs WebExtensions usadas y clasificar: compartida,
  adaptador requerido o implementacion por navegador.
- [x] B0.3. Congelar criterios funcionales de Gmail, ClickUp, Meet, tiempo y
  Calendar.
- [x] B0.4. Definir nombres, versiones y contenido exacto de ambos artefactos.
- [x] B0.5. Definir Gecko ID estable sin reutilizar identidad de Chrome.

#### Contrato B0

- Chrome minimo: `102`, sin cambiar el baseline vigente durante el port.
- Firefox minimo: `140.0` ESR desktop. No se declara soporte Android.
- Version de producto compartida inicial: `2.1.0`.
- Artefacto Chrome: `taskbridge-for-clickup-chrome-2.1.0.zip`, generado en
  `dist/chrome` con manifiesto Chrome MV3 y service worker.
- Artefacto Firefox: `taskbridge-for-clickup-firefox-2.1.0.zip`, generado en
  `dist/firefox` con manifiesto Firefox MV3 y background scripts.
- Ambos artefactos contienen la misma aplicacion, popup, content scripts,
  estilos, iconos y modales allowlisted. Solo difieren manifiesto, bootstrap de
  background y adapters de identidad/plataforma.
- Gecko ID estable: `taskbridge-for-clickup@leandroiramain.com.ar`. Es una
  identidad publica de extension, no una credencial, y no reutiliza el ID CWS.
- El manifiesto Firefox debe declarar `browser_specific_settings.gecko`,
  incluida la declaracion de recoleccion requerida por AMO vigente, antes de
  cualquier envio para firma.

#### Matriz De Compatibilidad B0

| Superficie | Clasificacion | Contrato Firefox |
| --- | --- | --- |
| `runtime`, mensajes y puertos | Compartida | Normalizar Promise/callback y `lastError` sin debilitar errores |
| `tabs`, `windows`, `alarms`, `action` | Compartida | Mantener comportamiento y cubrir diferencias con pruebas focales |
| `storage.local`, `storage.session` | Adaptador requerido | Conservar acceso solo para contextos confiables y detectar capacidades |
| Background MV3 | Especifica por navegador | Chrome usa `service_worker`; Firefox usa `scripts` como event page |
| Autenticacion ClickUp | Compartida | Usar token personal por usuario; el OAuth cliente queda legacy y programado para retiro |
| Google Calendar OAuth | Especifica por navegador | Chrome conserva `getAuthToken`; Firefox queda desactivado hasta implementar `launchWebAuthFlow` y cache propia |
| Origen interno confiable | Adaptador requerido | Derivar desde `runtime.getURL('/')`; aceptar solo el origen exacto del runtime |
| Gmail y adjuntos | Compartida | Misma seleccion explicita, allowlists, limites y asociacion por mensaje |
| ClickUp, Meet y tiempo | Compartida | Misma semantica, escrituras explicitas y ausencia de logs sensibles |
| Diagnosticos con `showSaveFilePicker` | Opcional por navegador | Fallar cerrado o usar exportacion iniciada por el usuario |

#### Criterio Funcional Congelado

- Chrome debe conservar Gmail, ClickUp, Meet, tiempo y Calendar sin regresiones.
- El primer Firefox debe cubrir Gmail, ClickUp, Meet y tiempo con las mismas
  restricciones de seguridad y consentimiento de `2.1.0`.
- Calendar permanece oculto o desactivado en Firefox hasta completar B6; no se
  simula soporte parcial ni se reutiliza el cliente OAuth de Chrome.
- B0 no cambia runtime, permisos, manifests ni comportamiento distribuido.

**Gate B0:** `VERDE`; matriz revisada, alcance cerrado y cero cambios
funcionales.

### Fase B1: Build Multi-Browser

- [x] B1.1. Crear manifiestos fuente o generador determinista para Chrome y
  Firefox.
- [x] B1.2. Mantener `background.service_worker` para Chrome.
- [x] B1.3. Usar `background.scripts` para Firefox.
- [x] B1.4. Generar `dist/chrome` y `dist/firefox` sin mezclar archivos.
- [x] B1.5. Mantener allowlists y validadores separados por target.
- [x] B1.6. Producir ZIP independientes y hashes SHA-256.
- [x] B1.7. Agregar `web-ext lint` para Firefox. Job fijado a `web-ext@10.6.0`
  y validado en CI.
- [x] B1.8. Agregar jobs CI separados para Chrome y Firefox.

**Gate B1:** `VERDE`; ambos paquetes son reproducibles, Chrome conserva suite
verde y Firefox instala temporalmente sin errores de manifiesto o startup.

### Fase B2: Adaptador WebExtensions

- [x] B2.1. Evaluar `webextension-polyfill`. Se reviso el candidato Mozilla
  `0.12.0` y se rechazo incorporarlo: agrega una dependencia sin resolver
  identity, storage security ni politicas de capacidad; la frontera first-party
  queda fijada al codigo versionado del repositorio.
- [x] B2.2. Crear una unica frontera para runtime, storage, tabs, windows,
  alarms, action e identity.
- [x] B2.3. Normalizar Promises y retirar callbacks/`runtime.lastError` del
  popup; Google Identity conserva su adaptador callback aislado.
- [x] B2.4. Evitar detecciones de navegador dispersas por el producto.
- [x] B2.5. Agregar pruebas contractuales para Chrome y Firefox.

**Gate B2:** `VERDE`; build, contratos, startup, popup, app, mensajeria,
pestanas y alarmas validados en Firefox 154. Chrome conserva CI y artefacto
separado verdes.

### Fase B3: Paridad De Seguridad

- [x] B3.1. Derivar origen e identidad confiables con `runtime.getURL()` y
  `runtime.id`.
- [x] B3.2. Validar paginas permitidas sin hardcodear `chrome-extension://`.
- [x] B3.3. Sustituir la dependencia de `storage.setAccessLevel()` en Firefox
  con IndexedDB extension-origin para local y session nativo trusted-only;
  Chrome conserva `setAccessLevel()`.
- [x] B3.4. Mantener credenciales, tokens y material de cifrado detras de una
  persistencia controlada por el background.
- [x] B3.5. Los contratos deniegan storage a contextos Gmail, Meet y ClickUp;
  una prueba negativa en Firefox real confirmo que el content script no puede
  leer `clickupToken`, `encryptionKey` ni `oauthConfig`.
- [x] B3.6. Mantener esquemas, allowlists y limites de mensajes actuales.
- [x] B3.7. Implementar exportacion diagnostica Firefox sin
  `showSaveFilePicker()` y sin ampliar datos capturados.

**Gate B3:** `VERDE`; revision de seguridad y prueba negativa de acceso a
credenciales validadas en Firefox real, sin ampliar permisos del paquete final.

### Fase B4: Firefox Funcional Sin Calendar

- [x] B4.1. Cargar TaskBridge temporalmente en un perfil Firefox limpio.
- [x] B4.2. Validar token personal de ClickUp.
- [x] B4.3. Validar Gmail: inyeccion, navegacion, lectura y modal.
- [x] B4.4. Crear tareas queda verde y persiste `Gmail Thread ID`; vincular una
  tarea existente queda correctamente bloqueado con aviso accionable cuando
  ClickUp devuelve `FIELD_033` por limite del plan.
- [x] B4.5. Firefox detecta las tarjetas de adjuntos Gmail sin el atributo
  Chromium `download_url`; un PDF seleccionado fue subido correctamente a una
  tarea de prueba.
- [x] B4.6. Seguimiento de tiempo y navegacion ClickUp validados por el owner.
- [x] B4.7. Meet Priority opt-in validado por el owner.
- [x] B4.8. Reinicio, actualizacion y restauracion de estado validados por el
  owner.
- [x] B4.9. Calendar permanece visible como no disponible o desactivado hasta
  B6.

**Gate B4:** `VERDE`; Firefox funcional para Gmail, ClickUp, Meet y tiempo;
Chrome sigue verde y Calendar no presenta una capacidad falsa. El bloqueo
`FIELD_033` al vincular tareas existentes es una limitacion declarada del plan
ClickUp Free, con comportamiento fail-closed y aviso accionable.

### Fase B5: Autenticacion ClickUp Solo Con Token

- [x] B5.1. Adoptar token personal por usuario como unico metodo ClickUp
  soportado dentro del alcance Firefox actual.
- [x] B5.2. No crear una segunda aplicacion OAuth ni distribuir un
  `client_secret` dentro del paquete.
- [x] B5.3. Clasificar OAuth cliente como legacy, no soportado y fuera de los
  claims Firefox; permanece temporalmente en la fuente y UI compartidas hasta su
  retiro posterior para no romper Chrome en este cambio documental.
- [ ] B5.4. Eliminar en un cambio posterior la UI, persistencia, mensajes y flujo
  OAuth ClickUp ejecutados dentro del navegador, con migracion segura de estado.
- [ ] B5.5. Si OAuth vuelve a evaluarse, diseñarlo como servicio backend que
  custodie el secreto; requiere alcance, threat model y autorizacion separados.

**Gate B5:** `VERDE_TOKEN_ONLY`; Firefox usa token personal y OAuth cliente no
bloquea esta release. B5.4-B5.5 son follow-ups fuera del gate actual.

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

**Estado Plan B:** `B5_GREEN_TOKEN_ONLY_B6_PENDING`.

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
| 2026-08-23 | A30 | Gate A integrado | PR #2 con CI verde; merge commit `92a54437c993fecba37943d2b59ec1c500080108` en `main` | `v2.0.1` preservado |
| 2026-08-23 | B0 | Contrato y matriz multi-browser cerrados | Inventario estatico del repo y documentacion MDN vigente; rama `feat/firefox-port` creada desde el merge de A30 | No aplica |
| 2026-08-23 | B1.1-B1.6, B1.8 | Build multi-browser implementado | 34 archivos por target; runtime compartido byte-identico; 540/540 pruebas; Calendar fail-closed en `moz-extension:`; ZIP Chrome `32f630cca218df21987f81401e5de233cc076d15eabc98a8e3de096060cec41c`, Firefox `5f4fc62a96901b2770cbf303baa4f16610b07785c22b5120c19677151607b4e5`; integridad ZIP verde | Rebuild determinista con hashes identicos |
| 2026-08-23 | B1.7 y Gate B1 | CI y carga temporal Firefox verdes | PR #3: tests, Chrome release y Firefox release con `web-ext lint` verdes; Firefox 154 en perfil descartable instalo y desinstalo el Gecko ID esperado con cero errores de startup | Perfil temporal terminado; sin persistencia ni publicacion |
| 2026-08-23 | B2.1-B2.5 | Adaptador WebExtensions validado | 547/547 pruebas; build dual e integridad verdes; ZIP Chrome `2eb0b97da626a6c09d1c83303d6f79102a4aefbebf29c1aec9cf7cfd2529388f`, Firefox `17baf46a63620715e7014a1a3e4b140fe2b7e8db12ec8283818d00df8726ff13`; carga temporal automatizada Firefox 154 sin errores de startup | Gate `VERDE` tras smoke manual |
| 2026-08-23 | B3.3-B3.5 parcial | Storage privado Firefox | Smoke manual detecto que Firefox 154 no implementa `StorageArea.setAccessLevel`; IndexedDB extension-origin reemplaza local, session conserva trusted-only, content scripts reciben un facade fail-closed y las mutaciones/eventos son transaccionales y secuenciados | Sin migracion legacy: Firefox no fue publicado y el build fallido no persistio datos de aplicacion |
| 2026-08-23 | B3.1-B3.2 | Origen extension multi-browser | Smoke manual detecto `INVALID_ORIGIN` en app Firefox; validacion y `clearLocalData` ahora comparan protocolo y host exactos derivados de `runtime.getURL('/')`, con sender ID obligatorio | Caso Firefox trusted/UUID hostil cubierto por contrato |
| 2026-08-23 | Gate B2 | Smoke manual Firefox verde | Owner valido popup y app visibles sin `INIT_ERROR`; `getStatus` sin error, tabs, alarms create/get y cleanup devolvieron `true` en Firefox 154 | Sin credenciales, OAuth, ClickUp writes ni publicacion AMO |
| 2026-08-24 | B3.6-B3.7 | Paridad de mensajes y exportacion diagnostica | 552/552 pruebas; build dual e integridad verdes; smoke Firefox descargo 63 eventos JSONL normalizados sin campos sensibles crudos; ZIP Chrome `25740d1ee493de8a424767f500f04b48c84e079adb47c507873895e60349aadc`, Firefox `44fe85acda39ce696fc134013fee6c5b446d25875943fa935181719a6e2b4f99` | Sin permiso `downloads`; fallback acotado a 16 MiB |
| 2026-08-24 | B4 hallazgo temprano | Modal standalone Firefox carga | Ruta relativa `app/task-modal.html` corregida con `runtime.getURL('task-modal.html')`; documento en modo estandar y tipografia system sans explicita | Pendiente retest visual de tipografia |
| 2026-08-24 | B4 hallazgo temprano | Barra Gmail ausente por artefacto clasico invalido | `logger.js` y `gmail-adapter.js` contenian `require()` por inyeccion sobre build no bundled; build y watch ahora excluyen el adapter en esos entrypoints y preflight rechaza loaders CommonJS en content scripts | Pendiente retest Gmail Firefox |
| 2026-08-24 | B4 hallazgo temprano | Creacion Gmail no persistia vinculo | ClickUp omitia el campo aun vacio en el read-back y el setter posterior nunca se ejecutaba; ahora `Gmail Thread ID` viaja en el payload inicial, caller fields se descartan y fallos posteriores no inducen un segundo create; modal standalone ampliado a 700 px | Owner verifico creacion con campo, barra Gmail y modal en Firefox |
| 2026-08-24 | B4.1-B4.4 parcial | QA Gmail Firefox y limite de plan ClickUp | Owner valido carga temporal, autenticacion, Gmail, creacion vinculada y el aviso de plan para `FIELD_033`; vincular existente no crea un falso vinculo local cuando ClickUp rechaza el custom field; 559/559 pruebas, typecheck, build dual e integridad verdes; ZIP Chrome `f625b7758ff730d9e2fdf5e38cc5ddd08e8f17b1810c14278b75634bc0c93645`, Firefox `06e77eb0ea2bf17f041617912f041b54daae16687e8a3b733b083c95a17a46e8` | Limite externo del plan; sin fallback ni publicacion AMO |
| 2026-08-24 | B3.5 y Gate B3 | Prueba negativa Firefox verde | Un probe temporal ejecutado en contexto de content script devolvio `PASS`: `clickupToken`, `encryptionKey` y `oauthConfig` no fueron accesibles; el permiso temporal `scripting` existio solo en `dist/firefox`, se retiro mediante rebuild y no entro en fuente, commit ni paquete final | Firefox final conserva permisos originales; ZIP regenerado con SHA-256 `06e77eb0ea2bf17f041617912f041b54daae16687e8a3b733b083c95a17a46e8` |
| 2026-08-24 | B4.5 | Adjunto Gmail Firefox verde | Firefox omite `download_url` y expone tarjetas `a.aQy.e` con `view=att`; se agrego un fallback acotado que conserva validaciones de host, extension, MIME real y tamaño. El owner valido deteccion y subida de un unico PDF sin copia HTML | Prueba focal adapter 16/16; build Firefox verde; ZIP SHA-256 `0328677d333fe37e8029bf591b2a236659a2b6749a9faa8c254f83b2d41bdfc8` |
| 2026-08-24 | B4.4-B4.9 y Gate B4 | QA funcional Firefox cerrada por el owner | El owner confirmo haber probado el flujo completo y solicito omitir pruebas adicionales; Gmail, adjuntos, ClickUp, tiempo, Meet Priority, reinicio/restauracion y degradacion honesta de Calendar quedan aceptados | `FIELD_033` permanece como limite externo ClickUp Free; no se ejecutaron pruebas adicionales ni publicacion AMO |

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
| DEC-09 | 2026-08-23 | Baseline Firefox `140.0` ESR desktop | Mantener una base soportada y actualizable; Chrome conserva temporalmente su minimo `102` |
| DEC-10 | 2026-08-23 | Gecko ID `taskbridge-for-clickup@leandroiramain.com.ar` | Firma, redirects y actualizaciones Firefox necesitan identidad estable separada de CWS |
| DEC-11 | 2026-08-23 | Calendar desactivado en el primer corte Firefox | Firefox no implementa `identity.getAuthToken`; habilitarlo exige adapter y registro OAuth propios |
| DEC-12 | 2026-08-23 | Dos ZIP versionados desde contenido compartido | Evitar mezcla de manifiestos, OAuth, backgrounds y archivos de distribucion |
| DEC-13 | 2026-08-24 | ClickUp usa token personal por usuario en Firefox | ClickUp documenta un redirect por app y exige `client_secret`; pedir credenciales OAuth a cada usuario no sirve para distribucion general. El OAuth cliente legacy se retirara despues; un OAuth futuro requeriria backend y decision separada |

## Estado General

- Plan A: `GATE_A_GREEN`.
- Plan B: `B5_GREEN_TOKEN_ONLY_B6_PENDING`.
- Chrome Web Store: `2.1.0` pendiente de revision; `1.2.0` publica; publicacion
  automatica desactivada.
- Publicacion AMO: no autorizada.

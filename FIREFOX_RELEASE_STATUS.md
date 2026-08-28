# Firefox Release Status

Vista rapida para seguir el port de TaskBridge a Firefox. El detalle tecnico y
la evidencia completa permanecen en
[`MULTIBROWSER_MIGRATION_PLAN.md`](MULTIBROWSER_MIGRATION_PLAN.md).

## Estado Actual

- Actualizado: 2026-08-27.
- Version objetivo: `2.2.0`.
- Candidato local: `2.2.0` sobre `main` en `5e07b05`; sin commit ni publicacion.
- Progreso del plan: B0-B5 cerrados; B6 diferido; B7 automatizado verde y QA manual pendiente.
- Firefox funcional: Gmail, adjuntos, ClickUp con token personal, Meet y tiempo.
- Google Calendar: visible como `En desarrollo` y bloqueado en runtime en ambos navegadores.
- Publicacion AMO: no autorizada y no ejecutada.

## Semaforo

### Verde

- [x] Base multi-browser y builds separados.
- [x] Storage privado y aislamiento de credenciales en Firefox.
- [x] Gmail, modal, navegacion y vinculacion de tareas.
- [x] Creacion de tareas con `Gmail Thread ID` persistente.
- [x] Deteccion y subida de adjuntos seleccionados en Firefox.
- [x] ClickUp, seguimiento de tiempo y Meet Priority opt-in.
- [x] Reinicio y restauracion de estado validados por el owner.
- [x] Token personal definido como unico metodo ClickUp soportado en Firefox.
- [x] OAuth ClickUp legacy retirado de fuente, UI, mensajes y paquetes.

### Amarillo

- [~] Google Calendar queda diferido en ambos navegadores; su futura activacion requiere una decision y validacion separadas.
- [~] Gate B7 espera QA manual post-migracion; preparacion AMO y publicacion siguen abiertas.

### Limite Externo

- `FIELD_033`: ClickUp Free puede rechazar el uso del Custom Field al vincular
  una tarea existente. TaskBridge falla cerrado, elimina el falso mapping y
  muestra un aviso accionable. Las tareas creadas desde TaskBridge conservan el
  vinculo en el payload inicial.

## Camino Critico

### 1. Retirar OAuth ClickUp Legacy

Estado: `[x] Completado localmente`.

Alcance minimo:

- Quitar la configuracion OAuth ClickUp de popup y app.
- Retirar mensajes, handlers y flujo de autenticacion OAuth ClickUp.
- Retirar persistencia de `client_id`, `client_secret` y estado OAuth legacy.
- Preservar tokens personales validos durante la migracion.
- Actualizar README, guia, seguridad, privacidad y changelog.

Criterio de cierre:

- Firefox y Chrome muestran solo conexion por token personal para ClickUp.
- Ningun secreto OAuth ClickUp se solicita, persiste o incluye en los paquetes.
- La migracion no desconecta a usuarios que ya usan un token personal valido.

### 2. Resolver Google Calendar

Estado: `[~] Diferido`.

Calendar permanece desactivado y B6 pasa a una fase posterior. Implementarlo
requiere reactivar y revisar el runtime Chrome, ademas de un OAuth Google
especifico para Firefox, ciclo de token y validacion adicional.

Criterio de cierre del primer release:

- Calendar permanece claramente desactivado, sin prometer una capacidad falsa.
- Chrome y Firefox bloquean las acciones Calendar antes de solicitar tokens o datos.

### 3. Cerrar Gate B7

Estado: `[~] Automatizacion verde; QA manual pendiente`.

- [x] Paquetes Chrome y Firefox `2.2.0` reproducibles en dos builds consecutivos.
- [x] Permisos, hosts, CSP, allowlist y runtime compartido comparados por preflight.
- [x] Suite completa verde: 53 suites y 545 pruebas; TypeScript y diff check verdes.
- [x] ZIP Chrome SHA-256: `762eb349571315834354bd51283b42ca5baf7c047bc4fc861bfa4fe1a1709585`.
- [x] ZIP Firefox SHA-256: `c18cc2357f171a76af37aa3317b1f3d28ac5e37a6e2188d688c722db78e9cb02`.
- [x] Smoke aislado Chrome anterior: paquete cargado y service worker iniciado sin perfil real ni credenciales; no reemplaza la QA del runtime actual.
- [ ] Revalidar manualmente token-only, creacion desde Meet, idioma y estados de error en Chrome y Firefox estables.
- [ ] Revisar accesibilidad desktop post-migracion.

### 4. Preparar AMO

Estado: `[ ] Pendiente`.

- Preparar ficha, descripcion, iconos, capturas y notas de version.
- Declarar permisos y categorias de datos de acuerdo con el runtime real.
- Alinear privacidad y soporte con token-only y Calendar desactivado.
- Preparar fuente revisable y build reproducible.
- Confirmar ausencia de codigo remoto, secretos y archivos no usados.

### 5. Publicar Y Actualizar La Web

Estado: `[!] Requiere autorizacion humana`.

- Solicitar autorizacion explicita antes de enviar a AMO.
- Registrar observaciones de AMO sin afectar la distribucion Chrome.
- Anunciar Firefox y agregar el enlace publico solo despues de la aprobacion.
- Actualizar sitemap unicamente si cambia contenido publico.

## Orden Recomendado

1. Confirmar Calendar diferido para el primer release.
2. Cerrar Gate B7 con validacion proporcional.
3. Preparar el paquete y la ficha AMO.
4. Solicitar autorizacion para el envio externo.
5. Actualizar la web despues de la aprobacion AMO.

## Politica De Validacion

- No repetir QA manual ya validada por el owner.
- Ante un cambio de codigo, ejecutar solo el check minimo que detecte la falla
  introducida.
- Ampliar validacion solo si el primer check revela ambiguedad o cambia el riesgo.
- Los checks obligatorios del repositorio permanecen activos para cada PR.
- Un cambio documental sin runtime no requiere pruebas locales.

## Ultimos Hitos

- PR #5: paridad de seguridad Firefox y Gate B3.
- PR #6: deteccion real de adjuntos Gmail Firefox.
- PR #7: cierre funcional B4 por validacion del owner.
- PR #8: decision token-only y OAuth ClickUp marcado para retiro.
- Cambio local 2026-08-27: OAuth ClickUp retirado con migracion token-only, colas sin deadlock y guardas de release multi-browser.
- Cambio local 2026-08-27: creacion de tareas desde Meet, idioma ES/EN persistente y Calendar fail-closed en ambos navegadores; automatizacion B7 verde con 545 pruebas y builds reproducibles.

## Proxima Accion

Ejecutar la QA manual post-migracion de Gate B7 en perfiles de prueba Chrome y Firefox.

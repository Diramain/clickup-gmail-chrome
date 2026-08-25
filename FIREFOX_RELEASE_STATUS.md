# Firefox Release Status

Vista rapida para seguir el port de TaskBridge a Firefox. El detalle tecnico y
la evidencia completa permanecen en
[`MULTIBROWSER_MIGRATION_PLAN.md`](MULTIBROWSER_MIGRATION_PLAN.md).

## Estado Actual

- Actualizado: 2026-08-24.
- Version objetivo: `2.1.0`.
- Rama integrada: `main` en `9055e35`.
- Progreso del plan: `[######----]` B0-B5 cerrados; B6-B9 pendientes.
- Firefox funcional: Gmail, adjuntos, ClickUp con token personal, Meet y tiempo.
- Google Calendar: visible como no disponible o desactivado.
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

### Amarillo

- [~] OAuth ClickUp dentro del navegador sigue presente en fuente y UI
  compartidas, pero es legacy y no esta soportado para Firefox.
- [~] Google Calendar Firefox sigue pendiente de decision final de alcance.
- [~] Gate de release, preparacion AMO y documentacion publica siguen abiertos.

### Limite Externo

- `FIELD_033`: ClickUp Free puede rechazar el uso del Custom Field al vincular
  una tarea existente. TaskBridge falla cerrado, elimina el falso mapping y
  muestra un aviso accionable. Las tareas creadas desde TaskBridge conservan el
  vinculo en el payload inicial.

## Camino Critico

### 1. Retirar OAuth ClickUp Legacy

Estado: `[ ] Pendiente`.

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

### 2. Resolver Google Calendar Firefox

Estado: `[!] Decision pendiente`.

Recomendacion para el primer release: mantener Calendar desactivado y mover B6
a una fase posterior. Implementarlo ahora requiere OAuth Google especifico para
Firefox, ciclo de token y validacion adicional.

Criterio de cierre del primer release:

- Calendar permanece claramente desactivado, sin prometer una capacidad falsa.
- Chrome conserva su integracion Calendar actual sin cambios.

### 3. Cerrar Gate B7

Estado: `[ ] Pendiente`.

- Confirmar paquetes reproducibles Chrome y Firefox desde `main`.
- Comparar permisos, hosts, CSP y contenido de ambos ZIP.
- Confirmar hashes, rollback y diferencias funcionales declaradas.
- Revisar accesibilidad desktop y estados de error de release.

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

1. Retirar OAuth ClickUp legacy.
2. Confirmar Calendar diferido para el primer release.
3. Cerrar Gate B7 con validacion proporcional.
4. Preparar el paquete y la ficha AMO.
5. Solicitar autorizacion para el envio externo.
6. Actualizar la web despues de la aprobacion AMO.

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

## Proxima Accion

Retirar OAuth ClickUp legacy con una migracion que preserve tokens personales.

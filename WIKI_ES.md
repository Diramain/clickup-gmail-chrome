# Documentación de ClickUp Gmail Chrome Extension

Bienvenido a la Wiki de la extensión de Chrome para ClickUp y Gmail. Esta documentación te guiará a través de la instalación, configuración y uso de la herramienta.

> 🤖 **Desarrollado con IA**: Esta extensión fue desarrollada por **Leandro Iramain** con la asistencia de IA (Anthropic Claude / Antigravity).

## 📋 Índice

1. [Introducción](#introducción)
2. [Características Principales](#características-principales)
3. [Instalación y Desarrollo](#instalación-y-desarrollo)
4. [Configuración](#configuración)
5. [Guía de Uso](#guía-de-uso)
6. [Arquitectura Técnica](#arquitectura-técnica)
7. [FAQ y Solución de Problemas](#faq-y-solución-de-problemas)
8. [Créditos y Licencia](#créditos-y-licencia)

---

## Introducción

**ClickUp Gmail Tracker** es una extensión de Chrome diseñada para optimizar tu flujo de trabajo permitiéndote crear tareas de ClickUp directamente desde tu bandeja de entrada de Gmail.

---

## Características Principales

*   **Creación Rápida**: Convierte correos electrónicos en tareas de ClickUp con un solo clic.
*   **Adjuntar a Existentes**: Vincula correos a tareas que ya existen en tu espacio de trabajo.
*   **Valores Predeterminados Inteligentes**: La extensión autocompleta fechas, asignados y ubicación basándose en el contexto.
*   **Selector de Prioridad**: Establece la prioridad de la tarea (Urgente, Alta, Normal, Baja) al momento de crearla.
*   **Editor WYSIWYG**: Descripción de tarea con formato de texto enriquecido y soporte para Markdown.
*   **Popup de Éxito**: Enlace directo para ver la tarea creada inmediatamente.
*   **Búsqueda de Tareas**: Encuentra tareas por ID, URL o nombre.

---

## Instalación y Desarrollo

### Prerrequisitos
*   Node.js instalado
*   NPM (Node Package Manager)
*   Google Chrome

### Pasos para Desarrolladores

1.  **Clonar el repositorio**
    ```bash
    git clone https://github.com/Diramain/clickup-gmail-chrome.git
    cd clickup-gmail-chrome
    ```

2.  **Instalar dependencias**
    ```bash
    npm install
    ```

3.  **Compilar el proyecto**
    ```bash
    npm run build
    ```

4.  **Cargar en Chrome**
    1.  Abre `chrome://extensions` en tu navegador.
    2.  Activa el "Modo de desarrollador" (esquina superior derecha).
    3.  Haz clic en "Cargar descomprimida" (Load unpacked).
    4.  Selecciona la carpeta del repositorio clonado.

### Tests
Para ejecutar las pruebas unitarias:
```bash
npm test
```

---

## Configuración

Para que la extensión funcione, necesitas conectarla con tu cuenta de ClickUp:

1.  **Crear una App OAuth en ClickUp**:
    *   Ve a [Integraciones de ClickUp](https://app.clickup.com/settings/integrations).
    *   Crea una nueva App OAuth.
2.  **Configurar la Extensión**:
    *   Haz clic en el icono de la extensión en la barra de Chrome.
    *   Ingresa el `Client ID` y `Client Secret` obtenidos en el paso anterior.
3.  **Iniciar Sesión**:
    *   Autentícate con tu cuenta de ClickUp.
4.  **Selección de Lista**:
    *   (Opcional) Selecciona tu lista predeterminada para guardar tareas más rápido.

---

## Guía de Uso

1.  Abre cualquier correo en Gmail.
2.  Verás un botón o icono de ClickUp integrado en la interfaz del correo.
3.  Haz clic en el botón para abrir el modal de creación de tareas.
4.  Edita los detalles si es necesario (título, descripción, prioridad).
5.  Haz clic en "Crear Tarea" o vincula el correo a una tarea existente buscándola en la pestaña correspondiente.

---

## Arquitectura Técnica

El proyecto utiliza tecnologías modernas para asegurar rendimiento y mantenibilidad:

*   **Lenguaje**: TypeScript (100% tipado).
*   **Plataforma**: Chrome Extension Manifest V3.
*   **Bundler**: esbuild para compilaciones rápidas.
*   **Testing**: Jest.

### Estructura de Archivos
*   `background.ts`: Service worker que maneja la comunicación con la API de ClickUp.
*   `content_scripts/`: Scripts que interactúan con el DOM de Gmail.
    *   `gmail-native.ts`: Integración directa con el DOM.
    *   `modal.ts`: Interfaz de usuario inyectada en Gmail.

---

## FAQ y Solución de Problemas

**P: El botón no aparece en mis correos.**
R: Intenta recargar la página de Gmail. A veces los scripts tardan un momento en inyectarse, especialmente en conexiones lentas.

**P: No puedo iniciar sesión.**
R: Verifica que tu `Client ID` y `Client Secret` sean correctos. Asegúrate de que la App OAuth en ClickUp tenga los permisos adecuados.

---

## Créditos y Licencia

Este proyecto es Open Source bajo la licencia **MIT**.

### Créditos
*   **Leandro Iramain** ([@diramain](https://github.com/Diramain)) - Project Manager
*   **Anthropic Claude / Antigravity** - AI Pair Programming
*   **ClickUp API**

> **Nota del Autor**: "Soy Product Manager, no desarrollador. Este proyecto es una demostración de lo que se puede lograr con asistencia de IA. ¡Contribuciones bienvenidas!"

---
*Documentación generada automáticamente para el repositorio clickup-gmail-chrome.*

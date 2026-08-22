/**
 * Task Creation Modal Component
 * With WYSIWYG editor and space avatars
 */

// Modal Components (for future use - gradual migration)
import { LocationSearch, AssigneeSelector } from './modal/components';
import { Logger } from './logger';
import { escapeHTML, isSafeEditorLink, safeAvatarUrl, safeClickUpUrl, safeColor, sanitizeGmailHtml } from './utils/sanitize.utils';
import { flattenHierarchySpaces, getTeamHierarchyCache } from './hierarchy-utils';
import { extractTaskIdCandidate, rankTaskSearchResults } from './task-search';
import {
    GMAIL_ATTACHMENT_MAX_FILE_BYTES,
    GMAIL_ATTACHMENT_MAX_TOTAL_BYTES,
    isAllowedGmailAttachmentUrl,
    isAllowedGmailImageMimeType,
    sanitizeGmailAttachmentFilename,
    type GmailAttachmentMetadata,
    type GmailImageMimeType,
} from './gmail-attachment-security';

// ============================================================================
// Types
// ============================================================================

interface EmailData {
    threadId: string;
    subject: string;
    from: string;
    html: string;
    htmlSanitized?: true;
    attachments?: { url: string; filename: string; mimeType: string }[];
}

interface ListItem {
    id: string;
    name: string;
    path: string;
    spaceName: string;
    folderName?: string;
    spaceColor: string;
    spaceAvatar: string | null;
}

interface Member {
    user?: UserData;
    id?: number;
    username?: string;
    email?: string;
    profilePicture?: string | null;
}

interface UserData {
    id: number;
    username?: string;
    email?: string;
    profilePicture?: string | null;
}

interface Space {
    id: string;
    name: string;
    color?: string;
    avatar?: { url: string } | null;
}

interface Folder {
    id: string;
    name: string;
}

interface List {
    id: string;
    name: string;
}

interface Hierarchy {
    spaces: Space[];
    folders: Record<string, Folder[]>;
    lists: Record<string, List[]>;
    members: Member[];
    allLists: ListItem[];
}

interface TaskData {
    name: string;
    markdown_description?: string;
    assignees?: number[];
    priority?: number;
    status?: string;
    start_date?: number;
    due_date?: number;
    time_estimate?: number;
}

interface TaskResult {
    id: string;
    name: string;
    url: string;
    list?: { name: string } | string;
    error?: string;
    success?: boolean;
}

interface TeamsResponse {
    teams: Array<{
        id: string;
        name: string;
        members?: Member[];
    }>;
}

interface SpacesResponse {
    spaces: Space[];
}

interface FoldersResponse {
    folders: Folder[];
}

interface ListsResponse {
    lists: List[];
}

interface MembersResponse {
    members: Member[];
}

interface TasksResponse {
    tasks: TaskResult[];
}

// ============================================================================
// TaskModal Class
// ============================================================================

export class TaskModal {
    private modal: HTMLDivElement | null = null;
    private emailData: EmailData | null = null;
    private hierarchy: Hierarchy = {
        spaces: [],
        folders: {},
        lists: {},
        members: [],
        allLists: []
    };
    private selectedListId: string | null = null;
    private selectedListPath: string = '';
    private selectedTaskId: string | null = null;
    private selectedTaskData: TaskResult | null = null;
    private isResizing: boolean = false;
    private teamId: string | null = null;
    private listCache: Map<string, ListItem[]> = new Map();
    private searchTimeout: ReturnType<typeof setTimeout> | null = null;
    private isSearching: boolean = false;
    private taskSearchSequence: number = 0;
    private previouslyFocused: HTMLElement | null = null;

    constructor() { }

    async show(emailData: EmailData, initialTab: 'create' | 'attach' = 'create'): Promise<void> {
        this.previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        this.emailData = emailData;
        this.createModal();
        await this.loadFullHierarchy();
        await this.loadDefaultList(); // Pre-select saved default list
        await this.prefillCurrentUser(); // Pre-select current user as assignee
        document.body.appendChild(this.modal!);
        if (initialTab === 'attach') {
            this.switchTab('attach');
            (this.modal!.querySelector('#cu-task-search') as HTMLInputElement).focus();
        } else {
            (this.modal!.querySelector('#cu-task-name') as HTMLInputElement).focus();
        }
    }

    createModal(): void {
        this.modal = document.createElement('div');
        this.modal.className = 'cu-modal-container';
        this.modal.innerHTML = `
      <div class="cu-modal-window" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="cu-modal-title">
        <div class="cu-modal-header" id="cu-modal-drag-handle">
          <div><h2 id="cu-modal-title">Crear o vincular en ClickUp</h2></div>
          <button class="cu-modal-close" type="button" title="Cerrar (Esc)" aria-label="Cerrar formulario">×</button>
        </div>
        
        <div class="cu-modal-tabs" role="tablist" aria-label="Acción de ClickUp">
          <button id="cu-tab-create" class="cu-tab cu-tab-active" type="button" role="tab" aria-selected="true" aria-controls="cu-panel-create" data-tab="create">Crear tarea</button>
          <button id="cu-tab-attach" class="cu-tab" type="button" role="tab" aria-selected="false" aria-controls="cu-panel-attach" data-tab="attach">Vincular existente</button>
        </div>
        
        <div class="cu-modal-body">
          <!-- Create Task Tab -->
          <div id="cu-panel-create" class="cu-tab-content cu-tab-create active" role="tabpanel" aria-labelledby="cu-tab-create">
            
            <div class="cu-form-row cu-span-full">
              <label for="cu-location-input">Ubicación</label>
              <div class="cu-location-search">
                <input type="text" id="cu-location-input" class="cu-input" 
                       placeholder="Escribí para buscar listas…" autocomplete="off" aria-label="Buscar listas">
                <div class="cu-location-dropdown hidden">
                  <div class="cu-location-results"></div>
                </div>
                <div class="cu-selected-location hidden">
                  <span class="cu-location-path"></span>
                  <button class="cu-location-clear" title="Cambiar" aria-label="Cambiar ubicación">x</button>
                </div>
              </div>
            </div>
            
            <div class="cu-form-row cu-form-row-inline">
              <div class="cu-form-group">
                <label for="cu-start-date">Fecha de inicio</label>
                <input type="date" id="cu-start-date" class="cu-input">
              </div>
              <div class="cu-form-group">
                <label for="cu-due-date">Fecha de vencimiento</label>
                <input type="date" id="cu-due-date" class="cu-input">
              </div>
            </div>
            
            <div class="cu-form-row cu-form-row-inline">
              <div class="cu-form-group">
                <label for="cu-priority">Prioridad</label>
                <select id="cu-priority" class="cu-input cu-select">
                  <option value="">Sin prioridad</option>
                  <option value="1">🔴 Urgente</option>
                  <option value="2">🟠 Alta</option>
                  <option value="3">🟡 Normal</option>
                  <option value="4">🔵 Baja</option>
                </select>
              </div>
              <div class="cu-form-group">
                <label for="cu-status">Estado</label>
                <select id="cu-status" class="cu-input cu-select">
                  <option value="">Seleccioná una lista primero…</option>
                </select>
              </div>
            </div>
            <div class="cu-form-row">
              <div class="cu-form-group">
                <label for="cu-assignee-search">Responsable</label>
                <div class="cu-assignee-container">
                  <input type="text" id="cu-assignee-search" class="cu-input" 
                         placeholder="Buscar miembros…" autocomplete="off" aria-label="Buscar responsables">
                  <div class="cu-assignee-dropdown hidden"></div>
                </div>
              </div>
              <div class="cu-selected-assignees"></div>
            </div>
            
            <div class="cu-form-row">
              <label for="cu-task-name">Nombre de la tarea</label>
              <input type="text" id="cu-task-name" class="cu-input cu-input-large" 
                     placeholder="Nombre de la tarea…">
            </div>
            
            <div class="cu-form-row cu-span-full">
              <label>Descripción</label>
              <div class="cu-editor-container">
                <div class="cu-editor-tabs">
                  <button type="button" class="cu-editor-tab active" data-view="visual">Vista visual</button>
                  <button type="button" class="cu-editor-tab" data-view="source">Markdown</button>
                </div>
                <div class="cu-editor-toolbar">
                  <button type="button" data-cmd="bold" title="Negrita (Ctrl+B)" aria-label="Negrita"><b>B</b></button>
                  <button type="button" data-cmd="italic" title="Cursiva (Ctrl+I)" aria-label="Cursiva"><i>I</i></button>
                  <button type="button" data-cmd="strikeThrough" title="Tachado (Ctrl+S)" aria-label="Tachado"><s>S</s></button>
                  <span class="cu-toolbar-sep"></span>
                  
                  <!-- Headings Dropdown -->
                  <div class="cu-toolbar-dropdown">
                    <button type="button" class="cu-dropdown-trigger" title="Encabezados" aria-label="Elegir nivel de encabezado">H▾</button>
                    <div class="cu-dropdown-menu">
                      <button type="button" data-block="h1">Título 1</button>
                      <button type="button" data-block="h2">Título 2</button>
                      <button type="button" data-block="h3">Título 3</button>
                      <button type="button" data-block="h4">Título 4</button>
                      <button type="button" data-block="p">Normal</button>
                    </div>
                  </div>
                  <span class="cu-toolbar-sep"></span>
                  
                  <!-- Lists -->
                  <button type="button" data-cmd="insertUnorderedList" title="Lista con viñetas" aria-label="Lista con viñetas">• Lista</button>
                  <button type="button" data-cmd="insertOrderedList" title="Lista numerada" aria-label="Lista numerada">1. Lista</button>
                  <span class="cu-toolbar-sep"></span>
                  
                  <!-- Code & Quote -->
                  <button type="button" data-insert="code" title="Código en línea" aria-label="Código en línea">&lt;/&gt;</button>
                  <button type="button" data-insert="quote" title="Cita" aria-label="Cita">❝</button>
                  <span class="cu-toolbar-sep"></span>
                  
                  <!-- Link -->
                  <button type="button" data-cmd="createLink" title="Hipervínculo (Ctrl+K)" aria-label="Agregar enlace">🔗</button>
                </div>
                <div id="cu-editor-visual" class="cu-editor-visual" contenteditable="true" 
                     placeholder="Escribí o pegá contenido…" aria-label="Descripción visual"></div>
                <textarea id="cu-editor-source" class="cu-editor-source hidden" 
                           placeholder="Markdown: **negrita**, _cursiva_, - lista, 'código'"></textarea>
              </div>
              <p class="cu-editor-hint">Formato ClickUp: encabezados, énfasis, listas, enlaces, citas y código en línea.</p>
            </div>
            
            <div class="cu-form-row cu-form-row-inline">
              <div class="cu-form-group">
                <label for="cu-time-estimate">Estimación de tiempo</label>
                <input type="text" id="cu-time-estimate" class="cu-input" 
                       placeholder="ej. 2h 30m">
              </div>
              <div class="cu-form-group">
                <label for="cu-time-tracked">Tiempo registrado</label>
                <input type="text" id="cu-time-tracked" class="cu-input" 
                       placeholder="ej. 10m">
              </div>
            </div>
            
            <div class="cu-form-row cu-email-options">
              <label class="cu-checkbox-label">
                <input type="checkbox" id="cu-attach-email" checked>
                Conservar enlace a Gmail y adjuntar una copia HTML sanitizada
              </label>
            </div>
          </div>
          
          <!-- Attach to Existing Tab -->
          <div id="cu-panel-attach" class="cu-tab-content cu-tab-attach" role="tabpanel" aria-labelledby="cu-tab-attach" hidden>
            <div class="cu-form-row">
              <label for="cu-task-search">Buscar tarea</label>
              <div class="cu-task-search-container">
                <input type="text" id="cu-task-search" class="cu-input" 
                       placeholder="Ingresá Task ID o título (mín. 3 caracteres)…" autocomplete="off" aria-label="Buscar tarea existente por ID o título">
                <div class="cu-task-search-results hidden"></div>
              </div>
            </div>
            <div class="cu-selected-task hidden">
              <div class="cu-selected-task-info">
                <span class="cu-selected-task-name"></span>
                <span class="cu-selected-task-list"></span>
              </div>
              <button class="cu-selected-task-clear" aria-label="Quitar tarea seleccionada">x</button>
            </div>
            <p class="cu-search-hint">Escribí al menos 4 caracteres para buscar por nombre o pegá un ID exacto de tarea.</p>
          </div>

          <fieldset class="cu-attachment-picker cu-attach-files-row">
            <legend>Imágenes adjuntas del mensaje</legend>
            <p class="cu-hint">Elegí explícitamente qué imágenes subir. PNG, JPEG, GIF o WebP; máximo 10 MiB por archivo y 20 MiB en total. SVG no está permitido.</p>
            <div id="cu-attachment-list" class="cu-attachment-list"></div>
            <p id="cu-attachment-status" class="cu-hint" role="status" aria-live="polite"></p>
          </fieldset>
        </div>
        
        <div class="cu-modal-footer">
          <button class="cu-btn cu-btn-secondary cu-btn-cancel">Cancelar</button>
          <button class="cu-btn cu-btn-primary cu-btn-submit">
            <span class="cu-btn-text">Crear tarea</span>
            <span class="cu-btn-spinner hidden"></span>
          </button>
        </div>
        
        <div class="cu-resize-handle"></div>
      </div>
    `;

        this.bindEvents();
        this.prefillData();
        this.setupResize();
        this.setupDrag();
    }

    prefillData(): void {
        if (!this.emailData) return;
        (this.modal!.querySelector('#cu-task-name') as HTMLInputElement).value = this.emailData.subject || '';

        // Set today's date for Start Date and Due Date
        const today = new Date().toISOString().split('T')[0];
        (this.modal!.querySelector('#cu-start-date') as HTMLInputElement).value = today;
        (this.modal!.querySelector('#cu-due-date') as HTMLInputElement).value = today;

        const attachments = (this.emailData.attachments || [])
            .map((attachment, originalIndex) => ({ attachment, originalIndex }))
            .filter(({ attachment }) => isAllowedGmailImageMimeType(attachment.mimeType)
                && isAllowedGmailAttachmentUrl(attachment.url)
                && sanitizeGmailAttachmentFilename(attachment.filename));
        const attachCount = attachments.length;
        const attachFilesRow = this.modal!.querySelector('.cu-attach-files-row') as HTMLElement;
        const attachmentList = this.modal!.querySelector('#cu-attachment-list') as HTMLElement;

        if (attachCount > 0) {
            attachFilesRow.hidden = false;
            attachments.forEach(({ attachment, originalIndex }) => {
                const label = document.createElement('label');
                label.className = 'cu-attachment-option';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.dataset.attachmentIndex = String(originalIndex);
                const name = document.createElement('span');
                name.textContent = attachment.filename;
                const type = document.createElement('small');
                type.textContent = attachment.mimeType.replace('image/', '').toUpperCase();
                label.append(checkbox, name, type);
                attachmentList.append(label);
            });
        } else {
            attachFilesRow.hidden = true;
        }
    }

    async prefillCurrentUser(): Promise<void> {
        try {
            const status = await chrome.runtime.sendMessage({ action: 'getStatus' });
            Logger.info('MODAL_PREFILL_ASSIGNEE_START');

            if (status && status.user) {
                const user = status.user.user || status.user;
                if (user.id) {
                    // Add current user as default assignee
                    const member = {
                        user: {
                            id: user.id,
                            username: user.username,
                            email: user.email,
                            profilePicture: user.profilePicture
                        }
                    };
                    this.selectAssignee(user.id.toString(), member);
                    Logger.info('MODAL_PREFILL_ASSIGNEE_SELECTED');
                }
            }
        } catch (error) {
            Logger.error('MODAL_PREFILL_ASSIGNEE_ERROR', error);
        }
    }

    setupResize(): void {
        if (window.matchMedia('(max-width: 620px)').matches) return;
        const handle = this.modal!.querySelector('.cu-resize-handle') as HTMLElement;
        const modalWindow = this.modal!.querySelector('.cu-modal-window') as HTMLElement;

        handle.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault();
            this.isResizing = true;
            const startX = e.clientX;
            const startY = e.clientY;
            const startWidth = modalWindow.offsetWidth;
            const startHeight = modalWindow.offsetHeight;

            const onMouseMove = (e: MouseEvent): void => {
                if (!this.isResizing) return;
                modalWindow.style.width = Math.max(400, startWidth + (e.clientX - startX)) + 'px';
                modalWindow.style.height = Math.max(400, startHeight + (e.clientY - startY)) + 'px';
            };

            const onMouseUp = (): void => {
                this.isResizing = false;
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    setupDrag(): void {
        if (window.matchMedia('(max-width: 620px)').matches) return;
        const handle = this.modal!.querySelector('#cu-modal-drag-handle') as HTMLElement;
        const modalWindow = this.modal!.querySelector('.cu-modal-window') as HTMLElement;

        handle.addEventListener('mousedown', (e: MouseEvent) => {
            if ((e.target as HTMLElement).classList.contains('cu-modal-close')) return;
            e.preventDefault();

            const startX = e.clientX - modalWindow.offsetLeft;
            const startY = e.clientY - modalWindow.offsetTop;

            const onMouseMove = (e: MouseEvent): void => {
                modalWindow.style.left = (e.clientX - startX) + 'px';
                modalWindow.style.top = (e.clientY - startY) + 'px';
                modalWindow.style.transform = 'none';
            };

            const onMouseUp = (): void => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    bindEvents(): void {
        // Close
        this.modal!.querySelector('.cu-modal-close')!.addEventListener('click', () => this.close());
        this.modal!.querySelector('.cu-btn-cancel')!.addEventListener('click', () => this.close());
        this.modal!.querySelector('.cu-modal-window')!.addEventListener('keydown', (e) => {
            const event = e as KeyboardEvent;
            if (event.key === 'Escape') this.close();
            if (event.key === 'Tab') this.trapFocus(event);
        });

        // Tabs
        this.modal!.querySelectorAll('.cu-tab').forEach(tab => {
            tab.addEventListener('click', () => this.switchTab((tab as HTMLElement).dataset.tab!));
        });

        // Location search
        const locationInput = this.modal!.querySelector('#cu-location-input') as HTMLInputElement;
        locationInput.addEventListener('input', () => this.searchLists(locationInput.value));
        locationInput.addEventListener('focus', () => {
            if (!this.selectedListId) this.searchLists(locationInput.value);
        });
        this.modal!.querySelector('.cu-location-clear')!.addEventListener('click', () => this.clearLocation());

        // Assignee search
        const assigneeInput = this.modal!.querySelector('#cu-assignee-search') as HTMLInputElement;
        assigneeInput.addEventListener('input', (e) => this.searchAssignees((e.target as HTMLInputElement).value));
        assigneeInput.addEventListener('focus', () => this.showAssigneeDropdown());

        // Editor toolbar
        this.modal!.querySelectorAll('.cu-editor-toolbar button[data-cmd]').forEach(btn => {
            btn.addEventListener('click', () => this.execEditorCommand((btn as HTMLElement).dataset.cmd!));
        });

        this.modal!.querySelectorAll('.cu-editor-toolbar button[data-block]').forEach(btn => {
            btn.addEventListener('click', () => this.formatBlock((btn as HTMLElement).dataset.block!));
        });

        this.modal!.querySelectorAll('.cu-editor-toolbar button[data-insert]').forEach(btn => {
            btn.addEventListener('click', () => this.insertElement((btn as HTMLElement).dataset.insert!));
        });

        // Dropdown toggle
        const dropdown = this.modal!.querySelector('.cu-toolbar-dropdown');
        if (dropdown) {
            const trigger = dropdown.querySelector('.cu-dropdown-trigger')!;
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdown.classList.toggle('open');
            });
            dropdown.querySelectorAll('.cu-dropdown-menu button').forEach(btn => {
                btn.addEventListener('click', () => dropdown.classList.remove('open'));
            });
        }

        // Editor tabs
        this.modal!.querySelectorAll('.cu-editor-tab').forEach(tab => {
            tab.addEventListener('click', () => this.switchEditorView((tab as HTMLElement).dataset.view!));
        });

        // Paste handler
        this.modal!.querySelector('#cu-editor-visual')!.addEventListener('paste', (e) =>
            this.handleVisualPaste(e as ClipboardEvent));

        // Keyboard shortcuts
        this.modal!.querySelector('#cu-editor-visual')!.addEventListener('keydown', (e) => {
            const ke = e as KeyboardEvent;
            if (ke.ctrlKey || ke.metaKey) {
                switch (ke.key.toLowerCase()) {
                    case 'b':
                        e.preventDefault();
                        this.execEditorCommand('bold');
                        break;
                    case 'i':
                        e.preventDefault();
                        this.execEditorCommand('italic');
                        break;
                    case 's':
                        e.preventDefault();
                        this.execEditorCommand('strikeThrough');
                        break;
                    case 'k':
                        e.preventDefault();
                        this.execEditorCommand('createLink');
                        break;
                }
            }
        });

        // Submit
        this.modal!.querySelector('.cu-btn-submit')!.addEventListener('click', () => this.submit());

        // Task search
        const taskSearchInput = this.modal!.querySelector('#cu-task-search') as HTMLInputElement;
        taskSearchInput.addEventListener('input', () => {
            this.taskSearchSequence++;
            if (this.searchTimeout) clearTimeout(this.searchTimeout);
            this.searchTimeout = setTimeout(() => this.searchTasks(taskSearchInput.value), 300);
        });

        // Clear selected task
        this.modal!.querySelector('.cu-selected-task-clear')!.addEventListener('click', () => this.clearSelectedTask());

        // Close dropdowns
        document.addEventListener('click', (e) => {
            if (!this.modal) return;

            if (!(e.target as Element).closest('.cu-location-search')) {
                const dropdown = this.modal.querySelector('.cu-location-dropdown');
                if (dropdown) dropdown.classList.add('hidden');
            }
            if (!(e.target as Element).closest('.cu-assignee-container')) {
                const dropdown = this.modal.querySelector('.cu-assignee-dropdown');
                if (dropdown) dropdown.classList.add('hidden');
            }
            if (!(e.target as Element).closest('.cu-task-search-container')) {
                const results = this.modal.querySelector('.cu-task-search-results');
                if (results) results.classList.add('hidden');
            }
        });
    }

    execEditorCommand(cmd: string): void {
        const editor = this.modal!.querySelector('#cu-editor-visual') as HTMLElement;
        editor.focus();

        if (cmd === 'createLink') {
            const url = prompt('Ingresá la URL:');
            if (url && isSafeEditorLink(url)) document.execCommand(cmd, false, url);
            else if (url) this.showToast('URL no permitida. Usá sólo enlaces HTTPS.', 'error');
        } else {
            document.execCommand(cmd, false, undefined);
        }
    }

    formatBlock(tag: string): void {
        const editor = this.modal!.querySelector('#cu-editor-visual') as HTMLElement;
        editor.focus();
        document.execCommand('formatBlock', false, '<' + tag + '>');
    }

    insertElement(type: string): void {
        const editor = this.modal!.querySelector('#cu-editor-visual') as HTMLElement;
        editor.focus();

        const selection = window.getSelection();
        const selectedText = selection?.toString().trim() || '';

        let html = '';
        switch (type) {
            case 'code':
                const codeContent = selectedText || '// Tu código aquí';
                html = '<code>' + this.escapeHtml(codeContent.replace(/\s+/g, ' ')) + '</code>';
                break;
            case 'quote':
                const quoteContent = selectedText || 'Tu cita aquí';
                html = '<blockquote style="border-left:4px solid #7B68EE;padding-left:16px;margin:8px 0;color:#555;font-style:italic;">' + this.escapeHtml(quoteContent) + '</blockquote><br>';
                break;
        }

        if (html) {
            document.execCommand('insertHTML', false, this.cleanHtmlForClickUp(html));
        }
    }

    handleVisualPaste(e: ClipboardEvent): void {
        const clipboardData = e.clipboardData;
        if (!clipboardData) return;

        if (clipboardData.files && clipboardData.files.length > 0) {
            e.preventDefault();
                this.showToast('Las imágenes no están soportadas; usá adjuntos.', 'error');
            return;
        }

        const html = clipboardData.getData('text/html');
        if (html) {
            e.preventDefault();
            const cleaned = this.cleanHtmlForClickUp(html);
            document.execCommand('insertHTML', false, cleaned);
        }
    }

    cleanHtmlForClickUp(html: string): string {
        const temp = document.createElement('div');
        temp.innerHTML = sanitizeGmailHtml(html);

        temp.querySelectorAll('*').forEach(el => {
            el.removeAttribute('style');
            el.removeAttribute('class');
            el.removeAttribute('id');
        });

        return temp.innerHTML;
    }

    htmlToClickUpMarkdown(html: string): string {
        const temp = document.createElement('div');
        temp.innerHTML = this.cleanHtmlForClickUp(html);

        temp.querySelectorAll('script, style, img, svg, canvas, video, audio, iframe')
            .forEach(el => el.remove());

        // BUG FIX: Convert <br> to newlines FIRST
        temp.querySelectorAll('br').forEach(br => {
            br.replaceWith('\n');
        });

        // Convert block elements to have newlines
        temp.querySelectorAll('div, p').forEach(el => {
            const textNode = document.createTextNode('\n');
            el.parentNode?.insertBefore(textNode, el.nextSibling);
        });

        temp.querySelectorAll('pre').forEach(pre => {
            const code = pre.querySelector('code');
            const text = code ? code.textContent : pre.textContent;
            const inlineCode = (text || '').replace(/\s+/g, ' ').trim().replace(/`/g, '\\`');
            pre.replaceWith(inlineCode ? `\`${inlineCode}\`` : '');
        });

        temp.querySelectorAll('a').forEach(a => {
            const href = a.getAttribute('href');
            const text = (a.textContent || '').trim();
            if (href && text && isSafeEditorLink(href)) {
                a.replaceWith(`[${text}](${href})`);
            } else if (text) {
                a.replaceWith(text);
            }
        });

        temp.querySelectorAll('strong, b').forEach(el => {
            const text = (el.textContent || '').trim();
            if (text) el.replaceWith(`**${text}**`);
        });

        temp.querySelectorAll('em, i').forEach(el => {
            const text = (el.textContent || '').trim();
            if (text) el.replaceWith(`_${text}_`);
        });

        temp.querySelectorAll('del, s, strike').forEach(el => {
            const text = (el.textContent || '').trim();
            if (text) el.replaceWith(`~~${text}~~`);
        });

        temp.querySelectorAll('code').forEach(el => {
            const text = (el.textContent || '').replace(/\s+/g, ' ').trim().replace(/`/g, '\\`');
            if (text) el.replaceWith(`\`${text}\``);
        });

        // Convert containers after inline nodes so nested emphasis and links survive.
        temp.querySelectorAll('blockquote').forEach(bq => {
            const text = (bq.textContent || '').trim();
            const lines = text.split('\n').map(line => '> ' + line.trim()).join('\n');
            bq.replaceWith(lines + '\n');
        });

        temp.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
            const level = parseInt(h.tagName.charAt(1));
            const prefix = '#'.repeat(level) + ' ';
            const text = (h.textContent || '').trim();
            if (text) h.replaceWith('\n' + prefix + text + '\n');
        });

        temp.querySelectorAll('ol').forEach(ol => {
            let index = 1;
            ol.querySelectorAll(':scope > li').forEach(li => {
                const text = (li.textContent || '').trim();
                if (text) {
                    li.replaceWith(index + '. ' + text + '\n');
                    index++;
                }
            });
        });

        temp.querySelectorAll('ul li').forEach(li => {
            let text = (li.textContent || '').trim();
            if (text.startsWith('☐')) {
                text = '- [ ] ' + text.substring(1).trim();
            } else if (text.startsWith('☑') || text.startsWith('✓')) {
                text = '- [x] ' + text.substring(1).trim();
            } else {
                text = '- ' + text;
            }
            li.replaceWith(text + '\n');
        });

        let text = temp.textContent || temp.innerText || '';

        // BUG FIX: Preserve line breaks, only normalize excessive whitespace
        text = text
            .replace(/\r\n/g, '\n')
            .replace(/\t/g, ' ')
            .replace(/\n{3,}/g, '\n\n')  // Max 2 consecutive newlines
            .split('\n')
            .map(line => line.trimEnd())  // Only trim end, preserve leading spaces
            .join('\n')
            .trim();

        return text;
    }

    clickUpMarkdownToHtml(markdown: string): string {
        const renderInline = (value: string): string => {
            const tokens: string[] = [];
            const preserve = (html: string): string => {
                const token = `CLICKUPTOKEN${tokens.length}END`;
                tokens.push(html);
                return token;
            };

            let rendered = value
                .replace(/`([^`\n]+)`/g, (_match, code: string) => preserve(`<code>${this.escapeHtml(code)}</code>`))
                .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_match, text: string, url: string) => {
                    if (!isSafeEditorLink(url)) return this.escapeHtml(text);
                    return preserve(`<a href="${this.escapeHtml(url)}">${this.escapeHtml(text)}</a>`);
                });

            rendered = this.escapeHtml(rendered)
                .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
                .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
                .replace(/_([^_\n]+)_/g, '<em>$1</em>')
                .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

            tokens.forEach((html, index) => {
                rendered = rendered.replace(`CLICKUPTOKEN${index}END`, html);
            });
            return rendered;
        };

        const lines = markdown.replace(/\r\n/g, '\n').split('\n');
        const html: string[] = [];
        let listType: 'ul' | 'ol' | null = null;
        const closeList = (): void => {
            if (listType) html.push(`</${listType}>`);
            listType = null;
        };

        lines.forEach(line => {
            const heading = line.match(/^(#{1,6})\s+(.+)$/);
            const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
            const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
            const quote = line.match(/^>\s?(.*)$/);

            if (heading) {
                closeList();
                const level = heading[1].length;
                html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
            } else if (unordered || ordered) {
                const nextType = unordered ? 'ul' : 'ol';
                if (listType !== nextType) {
                    closeList();
                    html.push(`<${nextType}>`);
                    listType = nextType;
                }
                html.push(`<li>${renderInline((unordered || ordered)![1])}</li>`);
            } else if (quote) {
                closeList();
                html.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
            } else if (!line.trim()) {
                closeList();
            } else {
                closeList();
                html.push(`<p>${renderInline(line)}</p>`);
            }
        });
        closeList();

        return this.cleanHtmlForClickUp(html.join(''));
    }

    async loadFullHierarchy(): Promise<void> {
        try {
            Logger.info('MODAL_LOAD_HIERARCHY_START');

            // Get preferred team ID first
            const prefTeam = await chrome.runtime.sendMessage({ action: 'getPreferredTeam' });
            let teamId = prefTeam?.teamId;

            if (!teamId) {
                // Fallback: fetch teams
                const teamsRes = await chrome.runtime.sendMessage({ action: 'getTeams' });
                if (teamsRes?.teams?.[0]) {
                    teamId = teamsRes.teams[0].id;
                }
            }

            if (!teamId) {
                Logger.warn('MODAL_NO_TEAM_ID');
                return;
            }

            this.teamId = teamId;

            // Try to load from cache first (structure: { [teamId]: { data: { spaces }, timestamp } })
            const cache = await chrome.runtime.sendMessage({ action: 'getHierarchyCache' });
            const teamCache = getTeamHierarchyCache(cache, teamId);
            const cachedSpaces = teamCache?.data?.spaces || [];

            if (cachedSpaces.length > 0) {
                Logger.info(`MODAL_HIERARCHY_CACHE_HIT_${cachedSpaces.length}`);

                const allLists = flattenHierarchySpaces(cachedSpaces) as ListItem[];

                this.hierarchy.allLists = allLists;
                this.hierarchy.spaces = cachedSpaces as Space[];
                Logger.info(`MODAL_LISTS_FROM_CACHE_${allLists.length}`);

                // Check if cache is stale (older than 24 hours) and refresh in background
                const cacheAge = Date.now() - (teamCache?.timestamp || 0);
                if (cacheAge > 24 * 60 * 60 * 1000) {
                    Logger.info('MODAL_HIERARCHY_CACHE_STALE');
                    chrome.runtime.sendMessage({ action: 'preloadFullHierarchy' });
                }
                return;
            }

            Logger.info('MODAL_HIERARCHY_CACHE_MISS');

            const preload = await chrome.runtime.sendMessage({ action: 'preloadFullHierarchy', teamId });
            if (preload?.success) {
                const refreshed = await chrome.runtime.sendMessage({ action: 'getHierarchyCache' });
                const refreshedTeamCache = getTeamHierarchyCache(refreshed, teamId);
                const flattened = flattenHierarchySpaces(refreshedTeamCache?.data?.spaces) as ListItem[];
                if (flattened.length > 0) {
                    this.hierarchy.allLists = flattened;
                    this.hierarchy.spaces = refreshedTeamCache!.data!.spaces as Space[];
                    Logger.info(`MODAL_LISTS_FROM_PRELOAD_${flattened.length}`);
                    return;
                }
            }

            // No cache - fetch spaces on demand
            const spacesResult = await chrome.runtime.sendMessage({ action: 'getSpaces', teamId });

            if (spacesResult?.spaces) {
                this.hierarchy.spaces = spacesResult.spaces;
                const loadedLists: ListItem[] = [];
                for (const space of spacesResult.spaces) {
                    loadedLists.push(...await this.loadSpaceLists(space));
                }
                this.hierarchy.allLists = loadedLists;
                Logger.info(`MODAL_SPACES_LOADED_${spacesResult.spaces.length}`);
            }

        } catch (error) {
            Logger.error('MODAL_LOAD_HIERARCHY_ERROR', error);
        }
    }

    async loadSpaceLists(space: Space): Promise<ListItem[]> {
        const spaceColor = space.color || '#7B68EE';
        const spaceAvatar = space.avatar ? space.avatar.url : null;
        const lists: ListItem[] = [];

        try {
            // Load direct lists in space
            const listsResult = await chrome.runtime.sendMessage({
                action: 'getFolderlessLists', spaceId: space.id
            }) as ListsResponse;

            if (listsResult && listsResult.lists) {
                listsResult.lists.forEach(list => {
                    lists.push({
                        id: list.id,
                        name: list.name,
                        path: `${space.name} > ${list.name}`,
                        spaceName: space.name,
                        spaceColor: spaceColor,
                        spaceAvatar: spaceAvatar
                    });
                });
            }

            // Load folders and their lists
            const foldersResult = await chrome.runtime.sendMessage({
                action: 'getFolders', spaceId: space.id
            }) as FoldersResponse;

            if (foldersResult && foldersResult.folders) {
                for (const folder of foldersResult.folders) {
                    const folderLists = await chrome.runtime.sendMessage({
                        action: 'getLists', folderId: folder.id
                    }) as ListsResponse;
                    if (folderLists && folderLists.lists) {
                        folderLists.lists.forEach(list => {
                            lists.push({
                                id: list.id,
                                name: list.name,
                                path: `${space.name} > ${folder.name} > ${list.name}`,
                                spaceName: space.name,
                                folderName: folder.name,
                                spaceColor: spaceColor,
                                spaceAvatar: spaceAvatar
                            });
                        });
                    }
                }
            }
        } catch (e) {
            Logger.error('MODAL_LOAD_LISTS_FOR_SPACE_ERROR', e);
        }

        return lists;
    }

    async loadDefaultList(): Promise<void> {
        try {
            const storage = await chrome.runtime.sendMessage({ action: 'getDefaultListConfig' });
            Logger.info('MODAL_CHECK_DEFAULT_LIST');

            if (storage.defaultListConfig && storage.defaultListConfig.listId) {
                const config = storage.defaultListConfig;
                // Use stored path directly since allLists is not pre-loaded
                Logger.info('MODAL_PRESELECT_DEFAULT_LIST');
                this.selectLocation(config.listId, config.path || config.listName || config.listId);
            } else if (storage.defaultList) {
                // Old format - just the list ID, use it directly
                Logger.info('MODAL_PRESELECT_LEGACY_LIST');
                this.selectLocation(storage.defaultList, storage.defaultList);
            }
        } catch (error) {
            Logger.error('MODAL_LOAD_DEFAULT_LIST_ERROR', error);
        }
    }

    searchLists(query: string): void {
        const dropdown = this.modal!.querySelector('.cu-location-dropdown') as HTMLElement;
        const resultsContainer = this.modal!.querySelector('.cu-location-results') as HTMLElement;

        if (!query || query.length < 2) {
            dropdown.classList.add('hidden');
            return;
        }

        // If no cache loaded yet, show message
        if (this.hierarchy.allLists.length === 0) {
            resultsContainer.innerHTML = '<p class="cu-hint">Cargando listas… esperá un momento</p>';
            dropdown.classList.remove('hidden');
            return;
        }

        // Word-based fuzzy search: all query words must match (in any order)
        const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 0);

        const scoredResults = this.hierarchy.allLists
            .map(list => {
                const searchText = (list.name + ' ' + list.path).toLowerCase();
                // Check if all query words are present
                const allWordsMatch = queryWords.every(word => searchText.includes(word));
                if (!allWordsMatch) return null;

                // Score: higher = better match
                let score = 0;
                // Exact name match gets highest score
                if (list.name.toLowerCase() === query.toLowerCase()) score += 100;
                // Name contains query as substring
                if (list.name.toLowerCase().includes(query.toLowerCase())) score += 50;
                // Each word found in name (not just path) gets points
                queryWords.forEach(word => {
                    if (list.name.toLowerCase().includes(word)) score += 10;
                });
                // Shorter paths rank higher (more specific)
                score -= list.path.length / 20;

                return { list, score };
            })
            .filter((r): r is { list: ListItem; score: number } => r !== null)
            .sort((a, b) => b.score - a.score)
            .map(r => r.list);

        this.renderSearchResults(scoredResults, query, dropdown, resultsContainer);
    }

    renderSearchResults(filtered: ListItem[], query: string, dropdown: HTMLElement, resultsContainer: HTMLElement): void {
        if (filtered.length > 0) {
            resultsContainer.innerHTML = filtered.slice(0, 15).map(list => {
                const avatarUrl = safeAvatarUrl(list.spaceAvatar);
                const avatar = avatarUrl
                    ? `<img src="${escapeHTML(avatarUrl)}" class="cu-space-avatar" alt="">`
                    : `<span class="cu-space-avatar" style="background:${safeColor(list.spaceColor)}">${escapeHTML((list.spaceName || '?')[0])}</span>`;

                return `
          <div class="cu-location-item" data-list-id="${escapeHTML(list.id)}" data-path="${this.escapeHtml(list.path)}">
            ${avatar}
            <div class="cu-location-info">
              <span class="cu-location-item-name">${this.highlightMatch(list.name, query)}</span>
              <span class="cu-location-item-path">${this.escapeHtml(list.path)}</span>
            </div>
          </div>
        `;
            }).join('');

            resultsContainer.querySelectorAll('.cu-location-item').forEach(item => {
                item.addEventListener('click', () => {
                    this.selectLocation((item as HTMLElement).dataset.listId!, (item as HTMLElement).dataset.path!);
                });
            });

            dropdown.classList.remove('hidden');
        } else {
            resultsContainer.innerHTML = '<p class="cu-hint">No se encontraron listas. Probá con otra búsqueda.</p>';
            dropdown.classList.remove('hidden');
        }
    }

    highlightMatch(text: string, query: string): string {
        const regex = new RegExp(`(${this.escapeRegex(query)})`, 'gi');
        return this.escapeHtml(text).replace(regex, '<strong>$1</strong>');
    }

    escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    async selectLocation(listId: string, path: string): Promise<void> {
        this.selectedListId = listId;
        this.selectedListPath = path;

        const input = this.modal!.querySelector('#cu-location-input') as HTMLInputElement;
        const selectedDiv = this.modal!.querySelector('.cu-selected-location') as HTMLElement;
        const pathSpan = this.modal!.querySelector('.cu-location-path') as HTMLElement;
        const statusSelect = this.modal!.querySelector('#cu-status') as HTMLSelectElement;

        input.classList.add('hidden');
        selectedDiv.classList.remove('hidden');
        pathSpan.textContent = path;

        this.modal!.querySelector('.cu-location-dropdown')!.classList.add('hidden');

        // Fetch list details (including statuses) and members in parallel
        try {
            Logger.info('MODAL_LOAD_LIST_DETAILS');

            const [listResult, membersResult] = await Promise.all([
                chrome.runtime.sendMessage({
                    action: 'getList',
                    listId: listId
                }),
                chrome.runtime.sendMessage({
                    action: 'getMembers',
                    data: { listId: listId }
                }) as Promise<MembersResponse>
            ]);

            // Populate statuses
            if (listResult && listResult.statuses && listResult.statuses.length > 0) {
                statusSelect.textContent = '';
                listResult.statuses.forEach((s: any) => {
                    const option = document.createElement('option');
                    option.value = typeof s.status === 'string' ? s.status : '';
                    option.textContent = typeof s.status === 'string' ? s.status : '';
                    option.style.color = safeColor(s.color, '#333333');
                    statusSelect.appendChild(option);
                });
                // Default to first status (usually "open" or "to do")
                statusSelect.value = listResult.statuses[0].status;
                Logger.info(`MODAL_STATUSES_LOADED_${listResult.statuses.length}`);
            } else {
                statusSelect.innerHTML = '<option value="">No hay estados disponibles</option>';
            }

            // Populate members
            if (membersResult && membersResult.members) {
                this.hierarchy.members = membersResult.members;
                Logger.info(`MODAL_MEMBERS_LOADED_${membersResult.members.length}`);
            }
        } catch (e) {
            Logger.error('MODAL_LOAD_LIST_DETAILS_ERROR', e);
            statusSelect.innerHTML = '<option value="">No se pudieron cargar los estados</option>';
        }
    }

    clearLocation(): void {
        this.selectedListId = null;
        this.selectedListPath = '';

        const input = this.modal!.querySelector('#cu-location-input') as HTMLInputElement;
        const selectedDiv = this.modal!.querySelector('.cu-selected-location') as HTMLElement;

        input.classList.remove('hidden');
        input.value = '';
        selectedDiv.classList.add('hidden');
    }

    switchTab(tab: string): void {
        this.modal!.querySelectorAll<HTMLElement>('.cu-tab').forEach(t => {
            const active = t.dataset.tab === tab;
            t.classList.toggle('cu-tab-active', active);
            t.setAttribute('aria-selected', String(active));
        });

        this.modal!.querySelectorAll<HTMLElement>('.cu-tab-content').forEach(c => {
            const active = c.classList.contains(`cu-tab-${tab}`);
            c.classList.toggle('active', active);
            c.hidden = !active;
        });

        const submitBtn = this.modal!.querySelector('.cu-btn-submit .cu-btn-text') as HTMLElement;
        submitBtn.textContent = tab === 'create' ? 'Crear tarea' : 'Adjuntar email';
    }

    switchEditorView(view: string): void {
        const visual = this.modal!.querySelector('#cu-editor-visual') as HTMLElement;
        const source = this.modal!.querySelector('#cu-editor-source') as HTMLTextAreaElement;
        const toolbar = this.modal!.querySelector('.cu-editor-toolbar') as HTMLElement;

        this.modal!.querySelectorAll('.cu-editor-tab').forEach(t => t.classList.remove('active'));
        this.modal!.querySelector(`[data-view="${view}"]`)!.classList.add('active');

        if (view === 'source') {
            source.value = this.htmlToClickUpMarkdown(visual.innerHTML);
            visual.classList.add('hidden');
            source.classList.remove('hidden');
            toolbar.classList.add('hidden');
        } else {
            visual.innerHTML = this.clickUpMarkdownToHtml(source.value);
            visual.classList.remove('hidden');
            source.classList.add('hidden');
            toolbar.classList.remove('hidden');
        }
    }

    searchAssignees(query: string): void {
        const dropdown = this.modal!.querySelector('.cu-assignee-dropdown') as HTMLElement;

        Logger.info('MODAL_SEARCH_ASSIGNEES');

        if (!query) {
            dropdown.classList.add('hidden');
            return;
        }

        if (this.hierarchy.members.length > 0) {
            Logger.info('MODAL_MEMBERS_AVAILABLE');
        }

        const filtered = this.hierarchy.members.filter(m => {
            const user = m.user || m;
            return user && (user.username?.toLowerCase().includes(query.toLowerCase()) ||
                user.email?.toLowerCase().includes(query.toLowerCase()));
        });

        Logger.info(`MODAL_FILTERED_MEMBERS_${filtered.length}`);

        if (filtered.length > 0) {
            dropdown.innerHTML = filtered.map(m => {
                const user = m.user || m;
                const avatarUrl = safeAvatarUrl(user.profilePicture);
                const avatar = avatarUrl
                    ? `<img src="${escapeHTML(avatarUrl)}" class="cu-avatar" alt="">`
                    : `<span class="cu-avatar cu-avatar-default">${escapeHTML((user.username || user.email || '?')[0].toUpperCase())}</span>`;
                return `
          <div class="cu-assignee-option" data-id="${escapeHTML(String(user.id || ''))}">
            ${avatar}
            <span class="cu-assignee-name">${this.escapeHtml(user.username || user.email || 'Usuario')}</span>
          </div>
        `;
            }).join('');

            dropdown.querySelectorAll('.cu-assignee-option').forEach(opt => {
                opt.addEventListener('click', () => {
                    const member = filtered.find(m => {
                        const user = m.user || m;
                        return user.id?.toString() === (opt as HTMLElement).dataset.id;
                    });
                    this.selectAssignee((opt as HTMLElement).dataset.id!, member!);
                });
            });

            dropdown.classList.remove('hidden');
        } else {
            dropdown.classList.add('hidden');
        }
    }

    showAssigneeDropdown(): void {
        const query = (this.modal!.querySelector('#cu-assignee-search') as HTMLInputElement).value;
        if (query) this.searchAssignees(query);
    }

    selectAssignee(id: string, member: Member): void {
        const container = this.modal!.querySelector('.cu-selected-assignees') as HTMLElement;
        if (container.querySelector(`[data-id="${id}"]`)) return;

        const user = member?.user || member;

        const avatarUrl = safeAvatarUrl(user?.profilePicture);
        const avatar = avatarUrl
            ? `<img src="${escapeHTML(avatarUrl)}" class="cu-avatar-small" alt="">`
            : `<span class="cu-avatar-small cu-avatar-default">${escapeHTML((user?.username || user?.email || '?')[0])}</span>`;

        const tag = document.createElement('span');
        tag.className = 'cu-assignee-tag';
        tag.dataset.id = String(Number.parseInt(id, 10));
        tag.innerHTML = `${avatar} ${this.escapeHtml(user?.username || user?.email || 'Usuario')} <button type="button" aria-label="Quitar responsable">x</button>`;
        tag.querySelector('button')!.addEventListener('click', () => tag.remove());
        container.appendChild(tag);

        this.modal!.querySelector('.cu-assignee-dropdown')!.classList.add('hidden');
        (this.modal!.querySelector('#cu-assignee-search') as HTMLInputElement).value = '';
    }

    parseTime(timeStr: string): number | null {
        if (!timeStr) return null;

        let totalMs = 0;
        const hours = timeStr.match(/(\d+)\s*h/i);
        const minutes = timeStr.match(/(\d+)\s*m/i);

        if (hours) totalMs += parseInt(hours[1]) * 60 * 60 * 1000;
        if (minutes) totalMs += parseInt(minutes[1]) * 60 * 1000;

        if (!hours && !minutes) {
            const num = parseFloat(timeStr);
            if (!isNaN(num)) totalMs = num * 60 * 60 * 1000;
        }

        return totalMs > 0 ? totalMs : null;
    }

    getDescription(): string {
        const visual = this.modal!.querySelector('#cu-editor-visual') as HTMLElement;
        const source = this.modal!.querySelector('#cu-editor-source') as HTMLTextAreaElement;

        if (!source.classList.contains('hidden')) {
            return source.value;
        }

        return this.htmlToClickUpMarkdown(visual.innerHTML);
    }

    async submit(): Promise<void> {
        const activeTab = (this.modal!.querySelector('.cu-tab-active') as HTMLElement).dataset.tab;

        if (activeTab === 'attach') {
            const rawQuery = (this.modal!.querySelector('#cu-task-search') as HTMLInputElement).value.trim();
            const taskId = this.selectedTaskId || extractTaskIdCandidate(rawQuery);
            if (taskId) {
                await this.attachToTask(taskId);
            } else {
                this.showToast('Seleccioná una tarea encontrada por ID o título.', 'error');
            }
            return;
        }

        if (!this.selectedListId) {
            this.showToast('Seleccioná una ubicación.', 'error');
            return;
        }

        const btn = this.modal!.querySelector('.cu-btn-submit') as HTMLButtonElement;
        btn.disabled = true;
        btn.querySelector('.cu-btn-spinner')!.classList.remove('hidden');
        (btn.querySelector('.cu-btn-text') as HTMLElement).textContent = 'Creando…';

        try {
            const assignees = Array.from(this.modal!.querySelectorAll('.cu-assignee-tag'))
                .map(tag => parseInt((tag as HTMLElement).dataset.id!));

            const startDate = (this.modal!.querySelector('#cu-start-date') as HTMLInputElement).value;
            const dueDate = (this.modal!.querySelector('#cu-due-date') as HTMLInputElement).value;
            const timeEstimate = this.parseTime((this.modal!.querySelector('#cu-time-estimate') as HTMLInputElement).value);
            const timeTracked = this.parseTime((this.modal!.querySelector('#cu-time-tracked') as HTMLInputElement).value);

            const taskData: TaskData = {
                name: (this.modal!.querySelector('#cu-task-name') as HTMLInputElement).value || 'Tarea desde email',
                markdown_description: this.getDescription(),
                assignees: assignees,
                // FIX: Parse dates with local time to avoid UTC offset issues
                // Adding T12:00:00 ensures the date stays correct regardless of timezone
                start_date: startDate ? new Date(startDate + 'T12:00:00').getTime() : undefined,
                due_date: dueDate ? new Date(dueDate + 'T12:00:00').getTime() : undefined
            };

            // Add priority if selected
            const priorityValue = (this.modal!.querySelector('#cu-priority') as HTMLSelectElement).value;
            if (priorityValue) {
                taskData.priority = parseInt(priorityValue);
            }

            // Add status if selected
            const statusValue = (this.modal!.querySelector('#cu-status') as HTMLSelectElement).value;
            if (statusValue) {
                taskData.status = statusValue;
            }

            if (timeEstimate) taskData.time_estimate = timeEstimate;

            const emailData = this.emailData ? {
                ...this.emailData,
                attachments: undefined,
                html: (this.modal!.querySelector('#cu-attach-email') as HTMLInputElement).checked ? this.emailData.html : '',
                htmlSanitized: true as const,
            } : null;
            const response = await chrome.runtime.sendMessage({
                action: 'createTaskFull',
                listId: this.selectedListId,
                taskData: taskData,
                emailData,
                timeTracked: timeTracked,
                teamId: this.teamId
            }) as TaskResult;

            if (response && response.id) {
                const uploads = await this.uploadSelectedAttachments(response.id);
                this.showSuccessPopup(response, uploads.failed);
                if ((response as any).warning || uploads.failed > 0) {
                    this.showToast(`Tarea creada; ${uploads.failed > 0 ? `${uploads.failed} imagen${uploads.failed === 1 ? '' : 'es'} no se pudieron subir` : 'el email tuvo advertencias'}.`, 'error');
                }
                window.dispatchEvent(new CustomEvent('cu-task-created', {
                    detail: { task: response, threadId: this.emailData!.threadId }
                }));
                this.close();
            } else {
                this.showToast('No se pudo crear la tarea.', 'error');
            }
        } catch (error: any) {
            Logger.error('MODAL_CREATE_TASK_ERROR', error);
            this.showToast('No se pudo crear la tarea.', 'error');
        }

        btn.disabled = false;
        btn.querySelector('.cu-btn-spinner')!.classList.add('hidden');
        (btn.querySelector('.cu-btn-text') as HTMLElement).textContent = 'Crear tarea';
    }

    async attachToTask(taskId: string): Promise<void> {
        const btn = this.modal!.querySelector('.cu-btn-submit') as HTMLButtonElement;
        btn.disabled = true;

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'attachToTask',
                taskId: taskId,
                emailData: this.emailData ? { ...this.emailData, attachments: undefined, htmlSanitized: true as const } : null
            }) as TaskResult;

            if (response && (response.id || response.success)) {
                const uploads = await this.uploadSelectedAttachments(response.id || taskId);
                const failed = uploads.failed;
                this.showToast((response as any).warning || failed > 0
                    ? `Email vinculado; ${failed > 0 ? `${failed} imagen${failed === 1 ? '' : 'es'} no se pudieron subir` : 'se completó con advertencias'}.`
                    : `Email vinculado${uploads.uploaded > 0 ? ` con ${uploads.uploaded} imagen${uploads.uploaded === 1 ? '' : 'es'}` : ''}.`,
                (response as any).warning || failed > 0 ? 'error' : 'success');

                window.dispatchEvent(new CustomEvent('cu-task-created', {
                    detail: { task: response, threadId: this.emailData!.threadId }
                }));

                this.close();
            } else {
                this.showToast('No se pudo adjuntar el email.', 'error');
            }

        } catch (error: any) {
            // Check for extension context invalidation (happens when extension is reloaded)
            if (error?.message?.includes('Extension context invalidated') ||
                error?.message?.includes('Extension runtime error')) {
                this.showToast('La extensión se recargó. Actualizá Gmail.', 'error');
            } else {
                Logger.error('MODAL_ATTACH_EMAIL_ERROR', error);
                this.showToast('No se pudo adjuntar el email.', 'error');
            }
        }

        btn.disabled = false;
    }

    async uploadSelectedAttachments(taskId: string): Promise<{ uploaded: number; failed: number }> {
        if (!this.emailData) return { uploaded: 0, failed: 0 };
        const selected = Array.from(this.modal!.querySelectorAll<HTMLInputElement>('[data-attachment-index]:checked'))
            .map(input => this.emailData!.attachments?.[Number(input.dataset.attachmentIndex)])
            .filter((attachment): attachment is GmailAttachmentMetadata => !!attachment);
        const status = this.modal!.querySelector('#cu-attachment-status') as HTMLElement;
        let totalBytes = 0;
        let uploaded = 0;
        let failed = 0;

        for (const attachment of selected) {
            const filename = sanitizeGmailAttachmentFilename(attachment.filename);
            if (!filename || !isAllowedGmailImageMimeType(attachment.mimeType) || !isAllowedGmailAttachmentUrl(attachment.url)) {
                failed++;
                continue;
            }
            status.textContent = `Procesando ${uploaded + failed + 1} de ${selected.length}…`;
            try {
                const response = await fetch(attachment.url, { credentials: 'include', redirect: 'follow', cache: 'no-store' });
                if (!response.ok || !isAllowedGmailAttachmentUrl(response.url)) throw new Error('ATTACHMENT_RESPONSE_REJECTED');
                const responseMime = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
                if (!isAllowedGmailImageMimeType(responseMime) || responseMime !== attachment.mimeType.toLowerCase()) throw new Error('ATTACHMENT_MIME_REJECTED');
                const declaredSize = Number(response.headers.get('content-length'));
                if (Number.isFinite(declaredSize) && declaredSize > GMAIL_ATTACHMENT_MAX_FILE_BYTES) throw new Error('ATTACHMENT_TOO_LARGE');
                const bytes = new Uint8Array(await response.arrayBuffer());
                if (bytes.length === 0 || bytes.length > GMAIL_ATTACHMENT_MAX_FILE_BYTES || totalBytes + bytes.length > GMAIL_ATTACHMENT_MAX_TOTAL_BYTES) throw new Error('ATTACHMENT_SIZE_REJECTED');
                totalBytes += bytes.length;
                const uploadResponse = await chrome.runtime.sendMessage({
                    action: 'uploadGmailImageAttachment',
                    data: {
                        taskId,
                        filename,
                        mimeType: responseMime as GmailImageMimeType,
                        byteLength: bytes.length,
                        base64: this.bytesToBase64(bytes),
                    },
                }) as { success?: boolean };
                if (uploadResponse?.success !== true) throw new Error('ATTACHMENT_UPLOAD_REJECTED');
                uploaded++;
            } catch {
                failed++;
            }
        }
        status.textContent = selected.length > 0 ? `${uploaded} subida${uploaded === 1 ? '' : 's'} · ${failed} fallida${failed === 1 ? '' : 's'}` : '';
        return { uploaded, failed };
    }

    bytesToBase64(bytes: Uint8Array): string {
        let binary = '';
        const chunkSize = 32 * 1024;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
        }
        return btoa(binary);
    }

    trapFocus(event: KeyboardEvent): void {
        const focusable = Array.from(this.modal!.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])'))
            .filter(element => !element.hidden && element.offsetParent !== null);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }

    showSuccessPopup(task: TaskResult, failedAttachments = 0): void {
        // Remove any existing popup
        const existing = document.querySelector('.cu-success-popup');
        if (existing) existing.remove();

        const popup = document.createElement('div');
        popup.className = 'cu-success-popup';
        popup.innerHTML = `
            <div class="cu-success-popup-content">
                <div class="cu-success-icon">✓</div>
                 <div class="cu-success-title">${failedAttachments > 0 ? 'Tarea creada parcialmente' : 'Tarea creada'}</div>
                 <div class="cu-success-task-name">${this.escapeHtml(task.name)}</div>
                 ${failedAttachments > 0 ? `<p class="cu-success-warning">La tarea y el email se guardaron, pero ${failedAttachments} imagen${failedAttachments === 1 ? '' : 'es'} fallaron.</p>` : ''}
                <button class="cu-btn cu-btn-primary cu-success-view-btn" data-url="${escapeHTML(safeClickUpUrl(task.url || ''))}">
                    🔗 Ver tarea en ClickUp
                </button>
                <div class="cu-success-auto-close">Se cierra en <span class="cu-countdown">5</span>s…</div>
            </div>
        `;

        document.body.appendChild(popup);

        // View task button handler
        const viewBtn = popup.querySelector('.cu-success-view-btn') as HTMLButtonElement;
        viewBtn.addEventListener('click', () => {
            window.open(safeClickUpUrl(viewBtn.dataset.url || ''), '_blank', 'noopener,noreferrer');
            popup.remove();
        });

        // Click outside to close
        popup.addEventListener('click', (e) => {
            if (e.target === popup) popup.remove();
        });

        // Countdown and auto-close
        let seconds = 5;
        const countdownEl = popup.querySelector('.cu-countdown') as HTMLElement;
        const interval = setInterval(() => {
            seconds--;
            countdownEl.textContent = seconds.toString();
            if (seconds <= 0) {
                clearInterval(interval);
                popup.remove();
            }
        }, 1000);
    }

    showToast(msg: string, type: 'success' | 'error'): void {
        const existing = document.querySelector('.cu-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `cu-toast cu-toast-${type}`;
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    close(): void {
        this.modal?.remove();
        this.modal = null;
        this.previouslyFocused?.focus({ preventScroll: true });
        this.previouslyFocused = null;
    }

    escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async searchTasks(query: string): Promise<void> {
        const resultsContainer = this.modal!.querySelector('.cu-task-search-results') as HTMLElement;
        const requestSequence = ++this.taskSearchSequence;
        const cleanQuery = query.trim();

        if (cleanQuery.length < 3) {
            resultsContainer.classList.add('hidden');
            return;
        }

        resultsContainer.innerHTML = '<div class="cu-search-loading">Buscando por Task ID o título…</div>';
        resultsContainer.classList.remove('hidden');

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'searchTasks',
                query: cleanQuery
            }) as TasksResponse;

            if (requestSequence !== this.taskSearchSequence) return;
            const tasks = rankTaskSearchResults(response?.tasks || [], cleanQuery, 10);

            if (tasks.length > 0) {
                const taskId = extractTaskIdCandidate(cleanQuery);
                const lowerQuery = (taskId || cleanQuery).toLowerCase();
                resultsContainer.innerHTML = tasks.map(task => {
                    const listName = typeof task.list === 'object' ? task.list?.name : task.list || 'Sin lista';
                    const isExact = task.id.toLowerCase() === lowerQuery;
                    return `
                    <div class="cu-task-result ${isExact ? 'cu-task-exact' : ''}" data-task-id="${escapeHTML(task.id || '')}" data-task-name="${escapeHTML(task.name)}"
                         data-task-url="${escapeHTML(safeClickUpUrl(task.url || ''))}" data-task-list="${escapeHTML(listName)}">
                        <div class="cu-task-result-name">${this.highlightMatch(task.name, cleanQuery)}</div>
                        <div class="cu-task-result-meta">
                            <span class="cu-task-result-id">#${escapeHTML(task.id || '')}</span>
                            <span class="cu-task-result-list">${this.escapeHtml(listName)}</span>
                        </div>
                    </div>
                `;
                }).join('');

                resultsContainer.querySelectorAll('.cu-task-result').forEach(item => {
                    item.addEventListener('click', () => {
                        this.selectTask({
                            id: (item as HTMLElement).dataset.taskId!,
                            name: (item as HTMLElement).dataset.taskName!,
                            url: (item as HTMLElement).dataset.taskUrl!,
                            list: (item as HTMLElement).dataset.taskList
                        });
                    });
                });
            } else {
                resultsContainer.innerHTML = '<div class="cu-search-empty">No se encontraron tareas por ID o título</div>';
            }
        } catch (error: any) {
            if (requestSequence !== this.taskSearchSequence) return;
            Logger.error('MODAL_SEARCH_ERROR', error);
            // Check for extension context invalidation (happens when extension is reloaded)
            if (error?.message?.includes('Extension context invalidated') ||
                error?.message?.includes('Extension runtime error')) {
                resultsContainer.innerHTML = '<div class="cu-search-error">La extensión se recargó. Actualizá Gmail.</div>';
            } else {
                resultsContainer.innerHTML = '<div class="cu-search-error">No se pudo buscar</div>';
            }
        }
    }

    extractTaskId(input: string): string | null {
        return extractTaskIdCandidate(input);
    }

    selectTask(task: TaskResult): void {
        this.selectedTaskId = task.id;
        this.selectedTaskData = task;

        const input = this.modal!.querySelector('#cu-task-search') as HTMLInputElement;
        const resultsContainer = this.modal!.querySelector('.cu-task-search-results') as HTMLElement;
        const selectedContainer = this.modal!.querySelector('.cu-selected-task') as HTMLElement;
        const hint = this.modal!.querySelector('.cu-search-hint');

        input.classList.add('hidden');
        resultsContainer.classList.add('hidden');
        if (hint) hint.classList.add('hidden');
        selectedContainer.classList.remove('hidden');

        (selectedContainer.querySelector('.cu-selected-task-name') as HTMLElement).textContent = task.name;
        const listName = typeof task.list === 'object' ? task.list?.name : task.list;
        (selectedContainer.querySelector('.cu-selected-task-list') as HTMLElement).textContent =
            listName ? `en ${listName}` : `#${task.id}`;
    }

    clearSelectedTask(): void {
        this.selectedTaskId = null;
        this.selectedTaskData = null;

        const input = this.modal!.querySelector('#cu-task-search') as HTMLInputElement;
        const selectedContainer = this.modal!.querySelector('.cu-selected-task') as HTMLElement;
        const hint = this.modal!.querySelector('.cu-search-hint');

        input.classList.remove('hidden');
        input.value = '';
        selectedContainer.classList.add('hidden');
        if (hint) hint.classList.remove('hidden');
    }
}

// Export for global access
(window as any).TaskModal = TaskModal;

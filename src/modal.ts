/**
 * Task Creation Modal Component
 * With WYSIWYG editor and space avatars
 */

// Modal Components (for future use - gradual migration)
import { LocationSearch, AssigneeSelector } from './modal/components';

// ============================================================================
// Types
// ============================================================================

interface EmailData {
    threadId: string;
    subject: string;
    from: string;
    html: string;
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

    constructor() { }

    async show(emailData: EmailData): Promise<void> {
        this.emailData = emailData;
        this.createModal();
        await this.loadFullHierarchy();
        await this.loadDefaultList(); // Pre-select saved default list
        await this.prefillCurrentUser(); // Pre-select current user as assignee
        document.body.appendChild(this.modal!);
        (this.modal!.querySelector('#cu-task-name') as HTMLInputElement).focus();
    }

    createModal(): void {
        this.modal = document.createElement('div');
        this.modal.className = 'cu-modal-container';
        this.modal.innerHTML = `
      <div class="cu-modal-window" tabindex="0">
        <div class="cu-modal-header" id="cu-modal-drag-handle">
          <h2>Create ClickUp Task</h2>
          <button class="cu-modal-close" title="Close (ESC)">x</button>
        </div>
        
        <div class="cu-modal-tabs">
          <button class="cu-tab cu-tab-active" data-tab="create">Create Task</button>
          <button class="cu-tab" data-tab="attach">Attach to Existing</button>
        </div>
        
        <div class="cu-modal-body">
          <!-- Create Task Tab -->
          <div class="cu-tab-content cu-tab-create active">
            
            <div class="cu-form-row">
              <label>Location</label>
              <div class="cu-location-search">
                <input type="text" id="cu-location-input" class="cu-input" 
                       placeholder="Type to search lists..." autocomplete="off">
                <div class="cu-location-dropdown hidden">
                  <div class="cu-location-results"></div>
                </div>
                <div class="cu-selected-location hidden">
                  <span class="cu-location-path"></span>
                  <button class="cu-location-clear" title="Change">x</button>
                </div>
              </div>
            </div>
            
            <div class="cu-form-row cu-form-row-inline">
              <div class="cu-form-group">
                <label>Start Date</label>
                <input type="date" id="cu-start-date" class="cu-input">
              </div>
              <div class="cu-form-group">
                <label>Due Date</label>
                <input type="date" id="cu-due-date" class="cu-input">
              </div>
            </div>
            
            <div class="cu-form-row cu-form-row-inline">
              <div class="cu-form-group">
                <label>Priority</label>
                <select id="cu-priority" class="cu-input cu-select">
                  <option value="">No priority</option>
                  <option value="1">🔴 Urgent</option>
                  <option value="2">🟠 High</option>
                  <option value="3">🟡 Normal</option>
                  <option value="4">🔵 Low</option>
                </select>
              </div>
              <div class="cu-form-group">
                <label>Status</label>
                <select id="cu-status" class="cu-input cu-select">
                  <option value="">Select list first...</option>
                </select>
              </div>
            </div>
            <div class="cu-form-row">
              <div class="cu-form-group">
                <label>Assignee</label>
                <div class="cu-assignee-container">
                  <input type="text" id="cu-assignee-search" class="cu-input" 
                         placeholder="Search members..." autocomplete="off">
                  <div class="cu-assignee-dropdown hidden"></div>
                </div>
              </div>
            </div>
            <div class="cu-selected-assignees"></div>
            
            <div class="cu-form-row">
              <label>Task Name</label>
              <input type="text" id="cu-task-name" class="cu-input cu-input-large" 
                     placeholder="Task name...">
            </div>
            
            <div class="cu-form-row">
              <label>Description</label>
              <div class="cu-editor-container">
                <div class="cu-editor-tabs">
                  <button type="button" class="cu-editor-tab active" data-view="visual">Visual</button>
                  <button type="button" class="cu-editor-tab" data-view="source">Markdown</button>
                </div>
                <div class="cu-editor-toolbar">
                  <button type="button" data-cmd="bold" title="Negrita (Ctrl+B)"><b>B</b></button>
                  <button type="button" data-cmd="italic" title="Cursiva (Ctrl+I)"><i>I</i></button>
                  <button type="button" data-cmd="strikeThrough" title="Tachado (Ctrl+S)"><s>S</s></button>
                  <span class="cu-toolbar-sep"></span>
                  
                  <!-- Headings Dropdown -->
                  <div class="cu-toolbar-dropdown">
                    <button type="button" class="cu-dropdown-trigger" title="Encabezados">H▾</button>
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
                  <button type="button" data-cmd="insertUnorderedList" title="Lista con viñetas">• Lista</button>
                  <button type="button" data-cmd="insertOrderedList" title="Lista numerada">1. Lista</button>
                  <span class="cu-toolbar-sep"></span>
                  
                  <!-- Code & Quote -->
                  <button type="button" data-insert="code" title="Código">&lt;/&gt;</button>
                  <button type="button" data-insert="quote" title="Cita">❝</button>
                  <span class="cu-toolbar-sep"></span>
                  
                  <!-- Link -->
                  <button type="button" data-cmd="createLink" title="Hipervínculo (Ctrl+K)">🔗</button>
                </div>
                <div id="cu-editor-visual" class="cu-editor-visual" contenteditable="true" 
                     placeholder="Escribe o pega contenido..."></div>
                <textarea id="cu-editor-source" class="cu-editor-source hidden" 
                          placeholder="Markdown: **negrita**, _cursiva_, - lista, 'código'"></textarea>
              </div>
            </div>
            
            <div class="cu-form-row cu-form-row-inline">
              <div class="cu-form-group">
                <label>Time Estimate</label>
                <input type="text" id="cu-time-estimate" class="cu-input" 
                       placeholder="e.g., 2h 30m">
              </div>
              <div class="cu-form-group">
                <label>Track Time</label>
                <input type="text" id="cu-time-tracked" class="cu-input" 
                       placeholder="e.g., 10m">
              </div>
            </div>
            
            <div class="cu-form-row">
              <label class="cu-checkbox-label">
                <input type="checkbox" id="cu-attach-email" checked>
                Attach email as HTML file
              </label>
            </div>
            <div class="cu-form-row cu-attach-files-row">
              <label class="cu-checkbox-label">
                <input type="checkbox" id="cu-attach-files" checked>
                Attach email files <span id="cu-attach-files-count"></span>
              </label>
            </div>
          </div>
          
          <!-- Attach to Existing Tab -->
          <div class="cu-tab-content cu-tab-attach">
            <div class="cu-form-row">
              <label>Search Task</label>
              <div class="cu-task-search-container">
                <input type="text" id="cu-task-search" class="cu-input" 
                       placeholder="Enter task ID or name (min 4 chars)..." autocomplete="off">
                <div class="cu-task-search-results hidden"></div>
              </div>
            </div>
            <div class="cu-selected-task hidden">
              <div class="cu-selected-task-info">
                <span class="cu-selected-task-name"></span>
                <span class="cu-selected-task-list"></span>
              </div>
              <button class="cu-selected-task-clear">x</button>
            </div>
            <p class="cu-search-hint">Type at least 4 characters to search by name or paste exact task ID.</p>
          </div>
        </div>
        
        <div class="cu-modal-footer">
          <button class="cu-btn cu-btn-secondary cu-btn-cancel">Cancel</button>
          <button class="cu-btn cu-btn-primary cu-btn-submit">
            <span class="cu-btn-text">Create Task</span>
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

        // Show/hide attachments checkbox based on attachment count
        const attachCount = this.emailData.attachments?.length || 0;
        const attachFilesRow = this.modal!.querySelector('.cu-attach-files-row') as HTMLElement;
        const attachFilesCount = this.modal!.querySelector('#cu-attach-files-count') as HTMLElement;

        if (attachCount > 0) {
            attachFilesRow.style.display = '';
            attachFilesCount.textContent = `(${attachCount} file${attachCount > 1 ? 's' : ''})`;
        } else {
            attachFilesRow.style.display = 'none';
        }
    }

    async prefillCurrentUser(): Promise<void> {
        try {
            const status = await chrome.runtime.sendMessage({ action: 'getStatus' });
            console.log('[Modal] Getting current user for assignee:', status);

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
                    console.log('[Modal] Pre-selected current user as assignee:', user.username || user.email);
                }
            }
        } catch (error) {
            console.error('[Modal] Error prefilling current user:', error);
        }
    }

    setupResize(): void {
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
            if ((e as KeyboardEvent).key === 'Escape') this.close();
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
        let searchTimeout: ReturnType<typeof setTimeout> | null = null;
        taskSearchInput.addEventListener('input', () => {
            if (searchTimeout) clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => this.searchTasks(taskSearchInput.value), 300);
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
            const url = prompt('Ingresa la URL:');
            if (url) document.execCommand(cmd, false, url);
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
                html = '<pre style="background:#1e1e1e;color:#d4d4d4;padding:12px;border-radius:6px;font-family:monospace;overflow-x:auto;"><code>' + this.escapeHtml(codeContent) + '</code></pre><br>';
                break;
            case 'quote':
                const quoteContent = selectedText || 'Tu cita aquí';
                html = '<blockquote style="border-left:4px solid #7B68EE;padding-left:16px;margin:8px 0;color:#555;font-style:italic;">' + quoteContent + '</blockquote><br>';
                break;
        }

        if (html) {
            document.execCommand('insertHTML', false, html);
        }
    }

    handleVisualPaste(e: ClipboardEvent): void {
        const clipboardData = e.clipboardData;
        if (!clipboardData) return;

        if (clipboardData.files && clipboardData.files.length > 0) {
            e.preventDefault();
            this.showToast('Images not supported (use attachments)', 'error');
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
        temp.innerHTML = html;

        temp.querySelectorAll('img, script, style, iframe, object, embed, video, audio, canvas, svg, form, input, button')
            .forEach(el => el.remove());

        temp.querySelectorAll('*').forEach(el => {
            el.removeAttribute('style');
            el.removeAttribute('class');
            el.removeAttribute('id');
        });

        return temp.innerHTML;
    }

    htmlToClickUpMarkdown(html: string): string {
        const temp = document.createElement('div');
        temp.innerHTML = html;

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
            pre.replaceWith('\n```\n' + (text || '').trim() + '\n```\n');
        });

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

        temp.querySelectorAll('a').forEach(a => {
            const href = a.getAttribute('href');
            const text = (a.textContent || '').trim();
            if (href && text) {
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
            const text = (el.textContent || '').trim();
            if (text) el.replaceWith(`\`${text}\``);
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

    async loadFullHierarchy(): Promise<void> {
        try {
            console.log('[Modal] Loading hierarchy (cache-first mode)...');

            // Get preferred team ID first
            const prefTeam = await chrome.storage.local.get(['preferredTeam', 'cachedTeams']);
            let teamId = prefTeam.preferredTeam || prefTeam.cachedTeams?.teams?.[0]?.id;

            if (!teamId) {
                // Fallback: fetch teams
                const teamsRes = await chrome.runtime.sendMessage({ action: 'getTeams' });
                if (teamsRes?.teams?.[0]) {
                    teamId = teamsRes.teams[0].id;
                }
            }

            if (!teamId) {
                console.error('[Modal] No team ID available');
                return;
            }

            this.teamId = teamId;

            // Try to load from cache first (structure: { [teamId]: { data: { spaces }, timestamp } })
            const cache = await chrome.runtime.sendMessage({ action: 'getHierarchyCache' });
            const teamCache = cache?.[teamId];

            if (teamCache?.data?.spaces?.length > 0) {
                console.log('[Modal] Cache hit! Extracting lists from', teamCache.data.spaces.length, 'spaces');

                // Extract flat list of all lists from hierarchy
                const allLists: ListItem[] = [];
                for (const space of teamCache.data.spaces) {
                    const spaceColor = space.color || '#7B68EE';
                    const spaceAvatar = space.avatar?.url || null;

                    // Folderless lists
                    for (const list of (space.lists || [])) {
                        allLists.push({
                            id: list.id,
                            name: list.name,
                            path: `${space.name} > ${list.name}`,
                            spaceName: space.name,
                            spaceColor,
                            spaceAvatar
                        });
                    }

                    // Lists inside folders
                    for (const folder of (space.folders || [])) {
                        for (const list of (folder.lists || [])) {
                            allLists.push({
                                id: list.id,
                                name: list.name,
                                path: `${space.name} > ${folder.name} > ${list.name}`,
                                spaceName: space.name,
                                folderName: folder.name,
                                spaceColor,
                                spaceAvatar
                            });
                        }
                    }
                }

                this.hierarchy.allLists = allLists;
                this.hierarchy.spaces = teamCache.data.spaces;
                console.log('[Modal] Loaded', allLists.length, 'lists from cache');

                // Check if cache is stale (older than 24 hours) and refresh in background
                const cacheAge = Date.now() - (teamCache.timestamp || 0);
                if (cacheAge > 24 * 60 * 60 * 1000) {
                    console.log('[Modal] Cache stale (>24h), refreshing in background...');
                    chrome.runtime.sendMessage({ action: 'preloadFullHierarchy' });
                }
                return;
            }

            console.log('[Modal] Cache miss, loading from API...');

            // No cache - fetch spaces on demand
            const spacesResult = await chrome.runtime.sendMessage({ action: 'getSpaces', teamId });

            if (spacesResult?.spaces) {
                this.hierarchy.spaces = spacesResult.spaces;
                console.log('[Modal] Loaded', spacesResult.spaces.length, 'spaces. Lists will load on demand.');
            }

        } catch (error) {
            console.error('[Modal] Failed to load hierarchy:', error);
        }
    }

    async loadSpaceLists(space: Space): Promise<ListItem[]> {
        const spaceColor = space.color || '#7B68EE';
        const spaceAvatar = space.avatar ? space.avatar.url : null;
        const lists: ListItem[] = [];

        try {
            // Load direct lists in space
            const listsResult = await chrome.runtime.sendMessage({
                action: 'getLists', spaceId: space.id, folderId: null
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
            console.error('[Modal] Error loading lists for space:', space.name, e);
        }

        return lists;
    }

    async loadDefaultList(): Promise<void> {
        try {
            const storage = await chrome.storage.local.get(['defaultList', 'defaultListConfig']);
            console.log('[Modal] Checking for saved default list:', storage);

            if (storage.defaultListConfig && storage.defaultListConfig.listId) {
                const config = storage.defaultListConfig;
                // Use stored path directly since allLists is not pre-loaded
                console.log('[Modal] Pre-selecting saved list:', config.listName || config.listId);
                this.selectLocation(config.listId, config.path || config.listName || config.listId);
            } else if (storage.defaultList) {
                // Old format - just the list ID, use it directly
                console.log('[Modal] Pre-selecting list by ID (legacy):', storage.defaultList);
                this.selectLocation(storage.defaultList, storage.defaultList);
            }
        } catch (error) {
            console.error('[Modal] Error loading default list:', error);
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
            resultsContainer.innerHTML = '<p class="cu-hint">Loading lists... please wait</p>';
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
                const avatar = list.spaceAvatar
                    ? `<img src="${list.spaceAvatar}" class="cu-space-avatar">`
                    : `<span class="cu-space-avatar" style="background:${list.spaceColor}">${list.spaceName[0]}</span>`;

                return `
          <div class="cu-location-item" data-list-id="${list.id}" data-path="${this.escapeHtml(list.path)}">
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
            resultsContainer.innerHTML = '<p class="cu-hint">No lists found. Try another search term.</p>';
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
            console.log('[Modal] Loading list details and members for:', listId);

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
                statusSelect.innerHTML = listResult.statuses.map((s: any) =>
                    `<option value="${s.status}" style="color: ${s.color}">${s.status}</option>`
                ).join('');
                // Default to first status (usually "open" or "to do")
                statusSelect.value = listResult.statuses[0].status;
                console.log('[Modal] Loaded', listResult.statuses.length, 'statuses');
            } else {
                statusSelect.innerHTML = '<option value="">No statuses available</option>';
            }

            // Populate members
            if (membersResult && membersResult.members) {
                this.hierarchy.members = membersResult.members;
                console.log('[Modal] Loaded', membersResult.members.length, 'members');
            }
        } catch (e) {
            console.error('[Modal] Failed to load list details:', e);
            statusSelect.innerHTML = '<option value="">Error loading statuses</option>';
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
        this.modal!.querySelectorAll('.cu-tab').forEach(t => t.classList.remove('cu-tab-active'));
        this.modal!.querySelector(`[data-tab="${tab}"]`)!.classList.add('cu-tab-active');

        this.modal!.querySelectorAll('.cu-tab-content').forEach(c => c.classList.remove('active'));
        this.modal!.querySelector(`.cu-tab-${tab}`)!.classList.add('active');

        const submitBtn = this.modal!.querySelector('.cu-btn-submit .cu-btn-text') as HTMLElement;
        submitBtn.textContent = tab === 'create' ? 'Create Task' : 'Attach Email';
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
            visual.classList.remove('hidden');
            source.classList.add('hidden');
            toolbar.classList.remove('hidden');
        }
    }

    searchAssignees(query: string): void {
        const dropdown = this.modal!.querySelector('.cu-assignee-dropdown') as HTMLElement;

        console.log('[Modal] searchAssignees called, query:', query, 'members:', this.hierarchy.members);

        if (!query) {
            dropdown.classList.add('hidden');
            return;
        }

        if (this.hierarchy.members.length > 0) {
            console.log('[Modal] First member structure:', JSON.stringify(this.hierarchy.members[0]));
        }

        const filtered = this.hierarchy.members.filter(m => {
            const user = m.user || m;
            return user && (user.username?.toLowerCase().includes(query.toLowerCase()) ||
                user.email?.toLowerCase().includes(query.toLowerCase()));
        });

        console.log('[Modal] Filtered members:', filtered.length);

        if (filtered.length > 0) {
            dropdown.innerHTML = filtered.map(m => {
                const user = m.user || m;
                const avatar = user.profilePicture
                    ? `<img src="${user.profilePicture}" class="cu-avatar">`
                    : `<span class="cu-avatar cu-avatar-default">${(user.username || user.email || '?')[0].toUpperCase()}</span>`;
                return `
          <div class="cu-assignee-option" data-id="${user.id}">
            ${avatar}
            <span class="cu-assignee-name">${this.escapeHtml(user.username || user.email || 'User')}</span>
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

        const avatar = user?.profilePicture
            ? `<img src="${user.profilePicture}" class="cu-avatar-small">`
            : `<span class="cu-avatar-small cu-avatar-default">${(user?.username || user?.email || '?')[0]}</span>`;

        const tag = document.createElement('span');
        tag.className = 'cu-assignee-tag';
        tag.dataset.id = id;
        tag.innerHTML = `${avatar} ${this.escapeHtml(user?.username || user?.email || 'User')} <button type="button">x</button>`;
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
            const taskId = this.selectedTaskId || (this.modal!.querySelector('#cu-task-search') as HTMLInputElement).value.trim();
            if (taskId) {
                await this.attachToTask(taskId);
            } else {
                this.showToast('Please select or enter a task', 'error');
            }
            return;
        }

        if (!this.selectedListId) {
            this.showToast('Please select a location', 'error');
            return;
        }

        const btn = this.modal!.querySelector('.cu-btn-submit') as HTMLButtonElement;
        btn.disabled = true;
        btn.querySelector('.cu-btn-spinner')!.classList.remove('hidden');
        (btn.querySelector('.cu-btn-text') as HTMLElement).textContent = 'Creating...';

        try {
            const assignees = Array.from(this.modal!.querySelectorAll('.cu-assignee-tag'))
                .map(tag => parseInt((tag as HTMLElement).dataset.id!));

            const startDate = (this.modal!.querySelector('#cu-start-date') as HTMLInputElement).value;
            const dueDate = (this.modal!.querySelector('#cu-due-date') as HTMLInputElement).value;
            const timeEstimate = this.parseTime((this.modal!.querySelector('#cu-time-estimate') as HTMLInputElement).value);
            const timeTracked = this.parseTime((this.modal!.querySelector('#cu-time-tracked') as HTMLInputElement).value);

            const taskData: TaskData = {
                name: (this.modal!.querySelector('#cu-task-name') as HTMLInputElement).value || 'Email Task',
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

            const attachWithFiles = (this.modal!.querySelector('#cu-attach-files') as HTMLInputElement).checked;
            const response = await chrome.runtime.sendMessage({
                action: 'createTaskFull',
                listId: this.selectedListId,
                taskData: taskData,
                emailData: (this.modal!.querySelector('#cu-attach-email') as HTMLInputElement).checked ? this.emailData : null,
                attachWithFiles: attachWithFiles,
                timeTracked: timeTracked,
                teamId: this.teamId
            }) as TaskResult;

            if (response && response.id) {
                this.showSuccessPopup(response);
                window.dispatchEvent(new CustomEvent('cu-task-created', {
                    detail: { task: response, threadId: this.emailData!.threadId }
                }));
                this.close();
            } else {
                this.showToast(response?.error || 'Failed', 'error');
            }
        } catch (error: any) {
            this.showToast(error.message, 'error');
        }

        btn.disabled = false;
        btn.querySelector('.cu-btn-spinner')!.classList.add('hidden');
        (btn.querySelector('.cu-btn-text') as HTMLElement).textContent = 'Create Task';
    }

    async attachToTask(taskId: string): Promise<void> {
        const btn = this.modal!.querySelector('.cu-btn-submit') as HTMLButtonElement;
        btn.disabled = true;

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'attachToTask',
                taskId: taskId,
                emailData: this.emailData
            }) as TaskResult;

            if (response && (response.id || response.success)) {
                this.showToast('Email attached!', 'success');

                window.dispatchEvent(new CustomEvent('cu-task-created', {
                    detail: { task: response, threadId: this.emailData!.threadId }
                }));

                this.close();
            } else {
                this.showToast(response?.error || 'Failed', 'error');
            }

        } catch (error: any) {
            // Check for extension context invalidation (happens when extension is reloaded)
            if (error?.message?.includes('Extension context invalidated') ||
                error?.message?.includes('Extension runtime error')) {
                this.showToast('Extension reloaded. Please refresh Gmail.', 'error');
            } else {
                this.showToast(error.message || 'Failed to attach email', 'error');
            }
        }

        btn.disabled = false;
    }

    showSuccessPopup(task: TaskResult): void {
        // Remove any existing popup
        const existing = document.querySelector('.cu-success-popup');
        if (existing) existing.remove();

        const popup = document.createElement('div');
        popup.className = 'cu-success-popup';
        popup.innerHTML = `
            <div class="cu-success-popup-content">
                <div class="cu-success-icon">✓</div>
                <div class="cu-success-title">Task Created!</div>
                <div class="cu-success-task-name">${this.escapeHtml(task.name)}</div>
                <button class="cu-btn cu-btn-primary cu-success-view-btn" data-url="${task.url}">
                    🔗 View Task in ClickUp
                </button>
                <div class="cu-success-auto-close">Closing in <span class="cu-countdown">5</span>s...</div>
            </div>
        `;

        document.body.appendChild(popup);

        // View task button handler
        const viewBtn = popup.querySelector('.cu-success-view-btn') as HTMLButtonElement;
        viewBtn.addEventListener('click', () => {
            window.open(task.url, '_blank');
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
    }

    escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async searchTasks(query: string): Promise<void> {
        const resultsContainer = this.modal!.querySelector('.cu-task-search-results') as HTMLElement;

        if (query.length < 4) {
            resultsContainer.classList.add('hidden');
            return;
        }

        resultsContainer.innerHTML = '<div class="cu-search-loading">Searching...</div>';
        resultsContainer.classList.remove('hidden');

        try {
            const taskId = this.extractTaskId(query);
            let tasks: TaskResult[] = [];
            let exactMatch: TaskResult | null = null;

            if (taskId) {
                try {
                    const exactTask = await chrome.runtime.sendMessage({
                        action: 'getTaskById',
                        taskId: taskId
                    }) as TaskResult;
                    if (exactTask && exactTask.id) {
                        exactMatch = exactTask;
                    }
                } catch (e) {
                    console.log('[Modal] Exact task lookup failed:', e);
                }
            }

            const searchQuery = taskId || query;
            const response = await chrome.runtime.sendMessage({
                action: 'searchTasks',
                query: searchQuery
            }) as TasksResponse;

            if (response && response.tasks) {
                tasks = response.tasks;
            }

            // Sort results by relevance
            if (tasks.length > 0) {
                const queryLower = query.toLowerCase().trim();
                const queryWords = queryLower.split(/\s+/).filter(w => w.length > 0);

                tasks.sort((a, b) => {
                    const nameA = a.name.toLowerCase();
                    const nameB = b.name.toLowerCase();

                    // 1. Exact match (highest priority)
                    const exactA = nameA === queryLower;
                    const exactB = nameB === queryLower;
                    if (exactA && !exactB) return -1;
                    if (!exactA && exactB) return 1;

                    // 2. Starts with query
                    const startA = nameA.startsWith(queryLower);
                    const startB = nameB.startsWith(queryLower);
                    if (startA && !startB) return -1;
                    if (!startA && startB) return 1;

                    // 3. Contains all words
                    const allWordsA = queryWords.every(w => nameA.includes(w));
                    const allWordsB = queryWords.every(w => nameB.includes(w));
                    if (allWordsA && !allWordsB) return -1;
                    if (!allWordsA && allWordsB) return 1;

                    // 4. Default by date updated (if available) or name length
                    // Prefer shorter names if they match equally well (likely more precise)
                    return nameA.length - nameB.length;
                });
            }

            // Always add exact match from ID lookup to the top if found
            if (exactMatch) {
                // Remove it from list if it's there to avoid duplicates
                tasks = tasks.filter(t => t.id !== exactMatch!.id);
                tasks.unshift(exactMatch);
            }



            if (tasks.length > 0) {
                const lowerQuery = (taskId || query).toLowerCase();
                resultsContainer.innerHTML = tasks.slice(0, 10).map(task => {
                    const listName = typeof task.list === 'object' ? task.list?.name : task.list || 'Unknown';
                    const isExact = task.id.toLowerCase() === lowerQuery;
                    return `
                    <div class="cu-task-result ${isExact ? 'cu-task-exact' : ''}" data-task-id="${task.id}" data-task-name="${this.escapeHtml(task.name)}" 
                         data-task-url="${task.url}" data-task-list="${this.escapeHtml(listName)}">
                        <div class="cu-task-result-name">${this.highlightMatch(task.name, query)}</div>
                        <div class="cu-task-result-meta">
                            <span class="cu-task-result-id">#${task.id}</span>
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
                resultsContainer.innerHTML = '<div class="cu-search-empty">No tasks found</div>';
            }
        } catch (error: any) {
            console.error('[Modal] Search error:', error);
            // Check for extension context invalidation (happens when extension is reloaded)
            if (error?.message?.includes('Extension context invalidated') ||
                error?.message?.includes('Extension runtime error')) {
                resultsContainer.innerHTML = '<div class="cu-search-error">Extension reloaded. Please refresh Gmail.</div>';
            } else {
                resultsContainer.innerHTML = '<div class="cu-search-error">Search failed</div>';
            }
        }
    }

    extractTaskId(input: string): string | null {
        const urlMatch = input.match(/clickup\.com\/t\/([a-zA-Z0-9]+)/);
        if (urlMatch) {
            return urlMatch[1];
        }

        // Regex for ClickUp Task IDs: alfanumeric, often starts with numbers but not always.
        // Avoid simple words by checking for mixed case or numbers + letters
        const idRegex = /^[a-zA-Z0-9]{5,12}$/;
        const trimmed = input.trim();

        if (idRegex.test(trimmed)) {
            // Extra check: if it's purely letters and < 6 chars, it's likely a word (e.g. "team", "task")
            // ClickUp IDs usually have numbers or are longer if letters only (rare)
            if (/^[a-zA-Z]+$/.test(trimmed) && trimmed.length < 8) {
                return null;
            }
            return trimmed;
        }

        const hashMatch = input.match(/^#([a-zA-Z0-9]+)$/);
        if (hashMatch) {
            return hashMatch[1];
        }

        return null;
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
            listName ? `in ${listName}` : `#${task.id}`;
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

"use strict";(()=>{class p{constructor(){this.modal=null;this.emailData=null;this.hierarchy={spaces:[],folders:{},lists:{},members:[],allLists:[]};this.selectedListId=null;this.selectedListPath="";this.selectedTaskId=null;this.selectedTaskData=null;this.isResizing=!1;this.teamId=null;this.listCache=new Map;this.searchTimeout=null;this.isSearching=!1}async show(e){this.emailData=e,this.createModal(),await this.loadFullHierarchy(),await this.loadDefaultList(),await this.prefillCurrentUser(),document.body.appendChild(this.modal),this.modal.querySelector("#cu-task-name").focus()}createModal(){this.modal=document.createElement("div"),this.modal.className="cu-modal-container",this.modal.innerHTML=`
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
                  <option value="1">\u{1F534} Urgent</option>
                  <option value="2">\u{1F7E0} High</option>
                  <option value="3">\u{1F7E1} Normal</option>
                  <option value="4">\u{1F535} Low</option>
                </select>
              </div>
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
                    <button type="button" class="cu-dropdown-trigger" title="Encabezados">H\u25BE</button>
                    <div class="cu-dropdown-menu">
                      <button type="button" data-block="h1">T\xEDtulo 1</button>
                      <button type="button" data-block="h2">T\xEDtulo 2</button>
                      <button type="button" data-block="h3">T\xEDtulo 3</button>
                      <button type="button" data-block="h4">T\xEDtulo 4</button>
                      <button type="button" data-block="p">Normal</button>
                    </div>
                  </div>
                  <span class="cu-toolbar-sep"></span>
                  
                  <!-- Lists -->
                  <button type="button" data-cmd="insertUnorderedList" title="Lista con vi\xF1etas">\u2022 Lista</button>
                  <button type="button" data-cmd="insertOrderedList" title="Lista numerada">1. Lista</button>
                  <span class="cu-toolbar-sep"></span>
                  
                  <!-- Code & Quote -->
                  <button type="button" data-insert="code" title="C\xF3digo">&lt;/&gt;</button>
                  <button type="button" data-insert="quote" title="Cita">\u275D</button>
                  <span class="cu-toolbar-sep"></span>
                  
                  <!-- Link -->
                  <button type="button" data-cmd="createLink" title="Hiperv\xEDnculo (Ctrl+K)">\u{1F517}</button>
                </div>
                <div id="cu-editor-visual" class="cu-editor-visual" contenteditable="true" 
                     placeholder="Escribe o pega contenido..."></div>
                <textarea id="cu-editor-source" class="cu-editor-source hidden" 
                          placeholder="Markdown: **negrita**, _cursiva_, - lista, 'c\xF3digo'"></textarea>
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
    `,this.bindEvents(),this.prefillData(),this.setupResize(),this.setupDrag()}prefillData(){if(!this.emailData)return;this.modal.querySelector("#cu-task-name").value=this.emailData.subject||"";const e=new Date().toISOString().split("T")[0];this.modal.querySelector("#cu-start-date").value=e,this.modal.querySelector("#cu-due-date").value=e;const t=this.emailData.attachments?.length||0,s=this.modal.querySelector(".cu-attach-files-row"),a=this.modal.querySelector("#cu-attach-files-count");t>0?(s.style.display="",a.textContent=`(${t} file${t>1?"s":""})`):s.style.display="none"}async prefillCurrentUser(){try{const e=await chrome.runtime.sendMessage({action:"getStatus"});if(console.log("[Modal] Getting current user for assignee:",e),e&&e.user){const t=e.user.user||e.user;if(t.id){const s={user:{id:t.id,username:t.username,email:t.email,profilePicture:t.profilePicture}};this.selectAssignee(t.id.toString(),s),console.log("[Modal] Pre-selected current user as assignee:",t.username||t.email)}}}catch(e){console.error("[Modal] Error prefilling current user:",e)}}setupResize(){const e=this.modal.querySelector(".cu-resize-handle"),t=this.modal.querySelector(".cu-modal-window");e.addEventListener("mousedown",s=>{s.preventDefault(),this.isResizing=!0;const a=s.clientX,i=s.clientY,o=t.offsetWidth,n=t.offsetHeight,c=r=>{this.isResizing&&(t.style.width=Math.max(400,o+(r.clientX-a))+"px",t.style.height=Math.max(400,n+(r.clientY-i))+"px")},l=()=>{this.isResizing=!1,document.removeEventListener("mousemove",c),document.removeEventListener("mouseup",l)};document.addEventListener("mousemove",c),document.addEventListener("mouseup",l)})}setupDrag(){const e=this.modal.querySelector("#cu-modal-drag-handle"),t=this.modal.querySelector(".cu-modal-window");e.addEventListener("mousedown",s=>{if(s.target.classList.contains("cu-modal-close"))return;s.preventDefault();const a=s.clientX-t.offsetLeft,i=s.clientY-t.offsetTop,o=c=>{t.style.left=c.clientX-a+"px",t.style.top=c.clientY-i+"px",t.style.transform="none"},n=()=>{document.removeEventListener("mousemove",o),document.removeEventListener("mouseup",n)};document.addEventListener("mousemove",o),document.addEventListener("mouseup",n)})}bindEvents(){this.modal.querySelector(".cu-modal-close").addEventListener("click",()=>this.close()),this.modal.querySelector(".cu-btn-cancel").addEventListener("click",()=>this.close()),this.modal.querySelector(".cu-modal-window").addEventListener("keydown",o=>{o.key==="Escape"&&this.close()}),this.modal.querySelectorAll(".cu-tab").forEach(o=>{o.addEventListener("click",()=>this.switchTab(o.dataset.tab))});const e=this.modal.querySelector("#cu-location-input");e.addEventListener("input",()=>this.searchLists(e.value)),e.addEventListener("focus",()=>{this.selectedListId||this.searchLists(e.value)}),this.modal.querySelector(".cu-location-clear").addEventListener("click",()=>this.clearLocation());const t=this.modal.querySelector("#cu-assignee-search");t.addEventListener("input",o=>this.searchAssignees(o.target.value)),t.addEventListener("focus",()=>this.showAssigneeDropdown()),this.modal.querySelectorAll(".cu-editor-toolbar button[data-cmd]").forEach(o=>{o.addEventListener("click",()=>this.execEditorCommand(o.dataset.cmd))}),this.modal.querySelectorAll(".cu-editor-toolbar button[data-block]").forEach(o=>{o.addEventListener("click",()=>this.formatBlock(o.dataset.block))}),this.modal.querySelectorAll(".cu-editor-toolbar button[data-insert]").forEach(o=>{o.addEventListener("click",()=>this.insertElement(o.dataset.insert))});const s=this.modal.querySelector(".cu-toolbar-dropdown");s&&(s.querySelector(".cu-dropdown-trigger").addEventListener("click",n=>{n.stopPropagation(),s.classList.toggle("open")}),s.querySelectorAll(".cu-dropdown-menu button").forEach(n=>{n.addEventListener("click",()=>s.classList.remove("open"))})),this.modal.querySelectorAll(".cu-editor-tab").forEach(o=>{o.addEventListener("click",()=>this.switchEditorView(o.dataset.view))}),this.modal.querySelector("#cu-editor-visual").addEventListener("paste",o=>this.handleVisualPaste(o)),this.modal.querySelector("#cu-editor-visual").addEventListener("keydown",o=>{const n=o;if(n.ctrlKey||n.metaKey)switch(n.key.toLowerCase()){case"b":o.preventDefault(),this.execEditorCommand("bold");break;case"i":o.preventDefault(),this.execEditorCommand("italic");break;case"s":o.preventDefault(),this.execEditorCommand("strikeThrough");break;case"k":o.preventDefault(),this.execEditorCommand("createLink");break}}),this.modal.querySelector(".cu-btn-submit").addEventListener("click",()=>this.submit());const a=this.modal.querySelector("#cu-task-search");let i=null;a.addEventListener("input",()=>{i&&clearTimeout(i),i=setTimeout(()=>this.searchTasks(a.value),300)}),this.modal.querySelector(".cu-selected-task-clear").addEventListener("click",()=>this.clearSelectedTask()),document.addEventListener("click",o=>{if(this.modal){if(!o.target.closest(".cu-location-search")){const n=this.modal.querySelector(".cu-location-dropdown");n&&n.classList.add("hidden")}if(!o.target.closest(".cu-assignee-container")){const n=this.modal.querySelector(".cu-assignee-dropdown");n&&n.classList.add("hidden")}if(!o.target.closest(".cu-task-search-container")){const n=this.modal.querySelector(".cu-task-search-results");n&&n.classList.add("hidden")}}})}execEditorCommand(e){if(this.modal.querySelector("#cu-editor-visual").focus(),e==="createLink"){const s=prompt("Ingresa la URL:");s&&document.execCommand(e,!1,s)}else document.execCommand(e,!1,void 0)}formatBlock(e){this.modal.querySelector("#cu-editor-visual").focus(),document.execCommand("formatBlock",!1,"<"+e+">")}insertElement(e){this.modal.querySelector("#cu-editor-visual").focus();const a=window.getSelection()?.toString().trim()||"";let i="";switch(e){case"code":const o=a||"// Tu c\xF3digo aqu\xED";i='<pre style="background:#1e1e1e;color:#d4d4d4;padding:12px;border-radius:6px;font-family:monospace;overflow-x:auto;"><code>'+this.escapeHtml(o)+"</code></pre><br>";break;case"quote":i='<blockquote style="border-left:4px solid #7B68EE;padding-left:16px;margin:8px 0;color:#555;font-style:italic;">'+(a||"Tu cita aqu\xED")+"</blockquote><br>";break}i&&document.execCommand("insertHTML",!1,i)}handleVisualPaste(e){const t=e.clipboardData;if(!t)return;if(t.files&&t.files.length>0){e.preventDefault(),this.showToast("Images not supported (use attachments)","error");return}const s=t.getData("text/html");if(s){e.preventDefault();const a=this.cleanHtmlForClickUp(s);document.execCommand("insertHTML",!1,a)}}cleanHtmlForClickUp(e){const t=document.createElement("div");return t.innerHTML=e,t.querySelectorAll("img, script, style, iframe, object, embed, video, audio, canvas, svg, form, input, button").forEach(s=>s.remove()),t.querySelectorAll("*").forEach(s=>{s.removeAttribute("style"),s.removeAttribute("class"),s.removeAttribute("id")}),t.innerHTML}htmlToClickUpMarkdown(e){const t=document.createElement("div");t.innerHTML=e,t.querySelectorAll("script, style, img, svg, canvas, video, audio, iframe").forEach(a=>a.remove()),t.querySelectorAll("pre").forEach(a=>{const i=a.querySelector("code"),o=i?i.textContent:a.textContent;a.replaceWith("\n```\n"+(o||"").trim()+"\n```\n")}),t.querySelectorAll("blockquote").forEach(a=>{const o=(a.textContent||"").trim().split(`
`).map(n=>"> "+n.trim()).join(`
`);a.replaceWith(o+`
`)}),t.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach(a=>{const i=parseInt(a.tagName.charAt(1)),o="#".repeat(i)+" ",n=(a.textContent||"").trim();n&&a.replaceWith(`
`+o+n+`
`)}),t.querySelectorAll("a").forEach(a=>{const i=a.getAttribute("href"),o=(a.textContent||"").trim();i&&o?a.replaceWith(`[${o}](${i})`):o&&a.replaceWith(o)}),t.querySelectorAll("strong, b").forEach(a=>{const i=(a.textContent||"").trim();i&&a.replaceWith(`**${i}**`)}),t.querySelectorAll("em, i").forEach(a=>{const i=(a.textContent||"").trim();i&&a.replaceWith(`_${i}_`)}),t.querySelectorAll("del, s, strike").forEach(a=>{const i=(a.textContent||"").trim();i&&a.replaceWith(`~~${i}~~`)}),t.querySelectorAll("code").forEach(a=>{const i=(a.textContent||"").trim();i&&a.replaceWith(`\`${i}\``)}),t.querySelectorAll("ol").forEach(a=>{let i=1;a.querySelectorAll(":scope > li").forEach(o=>{const n=(o.textContent||"").trim();n&&(o.replaceWith(i+". "+n+`
`),i++)})}),t.querySelectorAll("ul li").forEach(a=>{let i=(a.textContent||"").trim();i.startsWith("\u2610")?i="- [ ] "+i.substring(1).trim():i.startsWith("\u2611")||i.startsWith("\u2713")?i="- [x] "+i.substring(1).trim():i="- "+i,a.replaceWith(i+`
`)});let s=t.textContent||t.innerText||"";return s=s.replace(/\r\n/g,`
`).replace(/\t/g," ").replace(/ +/g," ").replace(/\n +/g,`
`).replace(/ +\n/g,`
`).replace(/\n{3,}/g,`

`).split(`
`).map(a=>a.trim()).filter((a,i,o)=>a?!0:i>0&&o[i-1]&&i<o.length-1&&o[i+1]).join(`
`).trim(),s}async loadFullHierarchy(){try{console.log("[Modal] Loading hierarchy (cache-first mode)...");const e=await chrome.runtime.sendMessage({action:"getHierarchyCache"});if(e&&e.lists&&e.lists.length>0){console.log("[Modal] Cache hit!",e.lists.length,"lists from cache"),this.hierarchy.allLists=e.lists,this.hierarchy.spaces=e.spaces||[],this.hierarchy.members=e.members||[],this.teamId=e.teamId,Date.now()-(e.timestamp||0)>5*60*1e3&&(console.log("[Modal] Cache stale, refreshing in background..."),chrome.runtime.sendMessage({action:"preloadFullHierarchy"}));return}console.log("[Modal] Cache miss, loading from API...");const t=await chrome.runtime.sendMessage({action:"getHierarchy"});if(!t||!t.teams||t.teams.length===0){console.error("[Modal] No teams found in response");return}const s=t.teams[0];this.teamId=s.id,this.hierarchy.members=s.members||[];const a=await chrome.runtime.sendMessage({action:"getSpaces",teamId:s.id});a&&a.spaces&&(this.hierarchy.spaces=a.spaces),console.log("[Modal] First load - waiting for hierarchy preload..."),await chrome.runtime.sendMessage({action:"preloadFullHierarchy"});const i=await chrome.runtime.sendMessage({action:"getHierarchyCache"});i&&i.lists&&(console.log("[Modal] Preload complete!",i.lists.length,"lists loaded"),this.hierarchy.allLists=i.lists)}catch(e){console.error("[Modal] Failed to load hierarchy:",e)}}async loadSpaceLists(e){const t=e.color||"#7B68EE",s=e.avatar?e.avatar.url:null,a=[];try{const i=await chrome.runtime.sendMessage({action:"getLists",spaceId:e.id,folderId:null});i&&i.lists&&i.lists.forEach(n=>{a.push({id:n.id,name:n.name,path:`${e.name} > ${n.name}`,spaceName:e.name,spaceColor:t,spaceAvatar:s})});const o=await chrome.runtime.sendMessage({action:"getFolders",spaceId:e.id});if(o&&o.folders)for(const n of o.folders){const c=await chrome.runtime.sendMessage({action:"getLists",folderId:n.id});c&&c.lists&&c.lists.forEach(l=>{a.push({id:l.id,name:l.name,path:`${e.name} > ${n.name} > ${l.name}`,spaceName:e.name,folderName:n.name,spaceColor:t,spaceAvatar:s})})}}catch(i){console.error("[Modal] Error loading lists for space:",e.name,i)}return a}async loadDefaultList(){try{const e=await chrome.storage.local.get(["defaultList","defaultListConfig"]);if(console.log("[Modal] Checking for saved default list:",e),e.defaultListConfig&&e.defaultListConfig.listId){const t=e.defaultListConfig;console.log("[Modal] Pre-selecting saved list:",t.listName||t.listId),this.selectLocation(t.listId,t.path||t.listName||t.listId)}else e.defaultList&&(console.log("[Modal] Pre-selecting list by ID (legacy):",e.defaultList),this.selectLocation(e.defaultList,e.defaultList))}catch(e){console.error("[Modal] Error loading default list:",e)}}searchLists(e){const t=this.modal.querySelector(".cu-location-dropdown"),s=this.modal.querySelector(".cu-location-results");if(!e||e.length<2){t.classList.add("hidden");return}const a=e.toLowerCase(),i=this.hierarchy.allLists.filter(o=>o.name.toLowerCase().includes(a)||o.path.toLowerCase().includes(a));if(this.hierarchy.allLists.length===0){s.innerHTML='<p class="cu-hint">Loading lists... please wait</p>',t.classList.remove("hidden");return}this.renderSearchResults(i,e,t,s)}renderSearchResults(e,t,s,a){e.length>0?(a.innerHTML=e.slice(0,15).map(i=>{const o=i.spaceAvatar?`<img src="${i.spaceAvatar}" class="cu-space-avatar">`:`<span class="cu-space-avatar" style="background:${i.spaceColor}">${i.spaceName[0]}</span>`;return`
          <div class="cu-location-item" data-list-id="${i.id}" data-path="${this.escapeHtml(i.path)}">
            ${o}
            <div class="cu-location-info">
              <span class="cu-location-item-name">${this.highlightMatch(i.name,t)}</span>
              <span class="cu-location-item-path">${this.escapeHtml(i.path)}</span>
            </div>
          </div>
        `}).join(""),a.querySelectorAll(".cu-location-item").forEach(i=>{i.addEventListener("click",()=>{this.selectLocation(i.dataset.listId,i.dataset.path)})}),s.classList.remove("hidden")):(a.innerHTML='<p class="cu-hint">No lists found. Try another search term.</p>',s.classList.remove("hidden"))}highlightMatch(e,t){const s=new RegExp(`(${this.escapeRegex(t)})`,"gi");return this.escapeHtml(e).replace(s,"<strong>$1</strong>")}escapeRegex(e){return e.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}async selectLocation(e,t){this.selectedListId=e,this.selectedListPath=t;const s=this.modal.querySelector("#cu-location-input"),a=this.modal.querySelector(".cu-selected-location"),i=this.modal.querySelector(".cu-location-path");s.classList.add("hidden"),a.classList.remove("hidden"),i.textContent=t,this.modal.querySelector(".cu-location-dropdown").classList.add("hidden");try{console.log("[Modal] Loading members for list:",e);const o=await chrome.runtime.sendMessage({action:"getMembers",data:{listId:e}});console.log("[Modal] Members result:",o),o&&o.members&&(this.hierarchy.members=o.members,console.log("[Modal] Loaded",o.members.length,"members"))}catch(o){console.error("[Modal] Failed to load members:",o)}}clearLocation(){this.selectedListId=null,this.selectedListPath="";const e=this.modal.querySelector("#cu-location-input"),t=this.modal.querySelector(".cu-selected-location");e.classList.remove("hidden"),e.value="",t.classList.add("hidden")}switchTab(e){this.modal.querySelectorAll(".cu-tab").forEach(s=>s.classList.remove("cu-tab-active")),this.modal.querySelector(`[data-tab="${e}"]`).classList.add("cu-tab-active"),this.modal.querySelectorAll(".cu-tab-content").forEach(s=>s.classList.remove("active")),this.modal.querySelector(`.cu-tab-${e}`).classList.add("active");const t=this.modal.querySelector(".cu-btn-submit .cu-btn-text");t.textContent=e==="create"?"Create Task":"Attach Email"}switchEditorView(e){const t=this.modal.querySelector("#cu-editor-visual"),s=this.modal.querySelector("#cu-editor-source"),a=this.modal.querySelector(".cu-editor-toolbar");this.modal.querySelectorAll(".cu-editor-tab").forEach(i=>i.classList.remove("active")),this.modal.querySelector(`[data-view="${e}"]`).classList.add("active"),e==="source"?(s.value=this.htmlToClickUpMarkdown(t.innerHTML),t.classList.add("hidden"),s.classList.remove("hidden"),a.classList.add("hidden")):(t.classList.remove("hidden"),s.classList.add("hidden"),a.classList.remove("hidden"))}searchAssignees(e){const t=this.modal.querySelector(".cu-assignee-dropdown");if(console.log("[Modal] searchAssignees called, query:",e,"members:",this.hierarchy.members),!e){t.classList.add("hidden");return}this.hierarchy.members.length>0&&console.log("[Modal] First member structure:",JSON.stringify(this.hierarchy.members[0]));const s=this.hierarchy.members.filter(a=>{const i=a.user||a;return i&&(i.username?.toLowerCase().includes(e.toLowerCase())||i.email?.toLowerCase().includes(e.toLowerCase()))});console.log("[Modal] Filtered members:",s.length),s.length>0?(t.innerHTML=s.map(a=>{const i=a.user||a,o=i.profilePicture?`<img src="${i.profilePicture}" class="cu-avatar">`:`<span class="cu-avatar cu-avatar-default">${(i.username||i.email||"?")[0].toUpperCase()}</span>`;return`
          <div class="cu-assignee-option" data-id="${i.id}">
            ${o}
            <span class="cu-assignee-name">${i.username||i.email}</span>
          </div>
        `}).join(""),t.querySelectorAll(".cu-assignee-option").forEach(a=>{a.addEventListener("click",()=>{const i=s.find(o=>(o.user||o).id?.toString()===a.dataset.id);this.selectAssignee(a.dataset.id,i)})}),t.classList.remove("hidden")):t.classList.add("hidden")}showAssigneeDropdown(){const e=this.modal.querySelector("#cu-assignee-search").value;e&&this.searchAssignees(e)}selectAssignee(e,t){const s=this.modal.querySelector(".cu-selected-assignees");if(s.querySelector(`[data-id="${e}"]`))return;const a=t?.user||t,i=a?.profilePicture?`<img src="${a.profilePicture}" class="cu-avatar-small">`:`<span class="cu-avatar-small cu-avatar-default">${(a?.username||a?.email||"?")[0]}</span>`,o=document.createElement("span");o.className="cu-assignee-tag",o.dataset.id=e,o.innerHTML=`${i} ${a?.username||a?.email||"User"} <button type="button">x</button>`,o.querySelector("button").addEventListener("click",()=>o.remove()),s.appendChild(o),this.modal.querySelector(".cu-assignee-dropdown").classList.add("hidden"),this.modal.querySelector("#cu-assignee-search").value=""}parseTime(e){if(!e)return null;let t=0;const s=e.match(/(\d+)\s*h/i),a=e.match(/(\d+)\s*m/i);if(s&&(t+=parseInt(s[1])*60*60*1e3),a&&(t+=parseInt(a[1])*60*1e3),!s&&!a){const i=parseFloat(e);isNaN(i)||(t=i*60*60*1e3)}return t>0?t:null}getDescription(){const e=this.modal.querySelector("#cu-editor-visual"),t=this.modal.querySelector("#cu-editor-source");return t.classList.contains("hidden")?this.htmlToClickUpMarkdown(e.innerHTML):t.value}async submit(){if(this.modal.querySelector(".cu-tab-active").dataset.tab==="attach"){const s=this.selectedTaskId||this.modal.querySelector("#cu-task-search").value.trim();s?await this.attachToTask(s):this.showToast("Please select or enter a task","error");return}if(!this.selectedListId){this.showToast("Please select a location","error");return}const t=this.modal.querySelector(".cu-btn-submit");t.disabled=!0,t.querySelector(".cu-btn-spinner").classList.remove("hidden"),t.querySelector(".cu-btn-text").textContent="Creating...";try{const s=Array.from(this.modal.querySelectorAll(".cu-assignee-tag")).map(u=>parseInt(u.dataset.id)),a=this.modal.querySelector("#cu-start-date").value,i=this.modal.querySelector("#cu-due-date").value,o=this.parseTime(this.modal.querySelector("#cu-time-estimate").value),n=this.parseTime(this.modal.querySelector("#cu-time-tracked").value),c={name:this.modal.querySelector("#cu-task-name").value||"Email Task",markdown_description:this.getDescription(),assignees:s,start_date:a?new Date(a).getTime():void 0,due_date:i?new Date(i).getTime():void 0},l=this.modal.querySelector("#cu-priority").value;l&&(c.priority=parseInt(l)),o&&(c.time_estimate=o);const r=this.modal.querySelector("#cu-attach-files").checked,d=await chrome.runtime.sendMessage({action:"createTaskFull",listId:this.selectedListId,taskData:c,emailData:this.modal.querySelector("#cu-attach-email").checked?this.emailData:null,attachWithFiles:r,timeTracked:n,teamId:this.teamId});d&&d.id?(this.showSuccessPopup(d),window.dispatchEvent(new CustomEvent("cu-task-created",{detail:{task:d,threadId:this.emailData.threadId}})),this.close()):this.showToast(d?.error||"Failed","error")}catch(s){this.showToast(s.message,"error")}t.disabled=!1,t.querySelector(".cu-btn-spinner").classList.add("hidden"),t.querySelector(".cu-btn-text").textContent="Create Task"}async attachToTask(e){const t=this.modal.querySelector(".cu-btn-submit");t.disabled=!0;try{const s=await chrome.runtime.sendMessage({action:"attachToTask",taskId:e,emailData:this.emailData});s&&(s.id||s.success)?(this.showToast("Email attached!","success"),window.dispatchEvent(new CustomEvent("cu-task-created",{detail:{task:s,threadId:this.emailData.threadId}})),this.close()):this.showToast(s?.error||"Failed","error")}catch(s){this.showToast(s.message,"error")}t.disabled=!1}showSuccessPopup(e){const t=document.querySelector(".cu-success-popup");t&&t.remove();const s=document.createElement("div");s.className="cu-success-popup",s.innerHTML=`
            <div class="cu-success-popup-content">
                <div class="cu-success-icon">\u2713</div>
                <div class="cu-success-title">Task Created!</div>
                <div class="cu-success-task-name">${this.escapeHtml(e.name)}</div>
                <button class="cu-btn cu-btn-primary cu-success-view-btn" data-url="${e.url}">
                    \u{1F517} View Task in ClickUp
                </button>
                <div class="cu-success-auto-close">Closing in <span class="cu-countdown">5</span>s...</div>
            </div>
        `,document.body.appendChild(s),s.querySelector(".cu-success-view-btn").addEventListener("click",()=>{window.open(e.url,"_blank"),s.remove()}),s.addEventListener("click",c=>{c.target===s&&s.remove()});let i=5;const o=s.querySelector(".cu-countdown"),n=setInterval(()=>{i--,o.textContent=i.toString(),i<=0&&(clearInterval(n),s.remove())},1e3)}showToast(e,t){const s=document.querySelector(".cu-toast");s&&s.remove();const a=document.createElement("div");a.className=`cu-toast cu-toast-${t}`,a.textContent=e,document.body.appendChild(a),setTimeout(()=>a.remove(),3e3)}close(){this.modal?.remove(),this.modal=null}escapeHtml(e){const t=document.createElement("div");return t.textContent=e,t.innerHTML}async searchTasks(e){const t=this.modal.querySelector(".cu-task-search-results");if(e.length<4){t.classList.add("hidden");return}t.innerHTML='<div class="cu-search-loading">Searching...</div>',t.classList.remove("hidden");try{const s=this.extractTaskId(e);let a=[],i=null;if(s)try{const r=await chrome.runtime.sendMessage({action:"getTaskById",taskId:s});r&&r.id&&(i=r)}catch(r){console.log("[Modal] Exact task lookup failed:",r)}const o=s||e,n=await chrome.runtime.sendMessage({action:"searchTasks",query:o});n&&n.tasks&&(a=n.tasks);const c=e.toLowerCase().split(/\s+/).filter(r=>r.length>2);c.length>0&&!s&&(a=a.filter(r=>{const d=r.name.toLowerCase();return c.some(u=>d.includes(u))})),i&&(a=a.filter(r=>r.id!==i.id),a.unshift(i));const l=(s||e).toLowerCase();a.sort((r,d)=>{if(r.id.toLowerCase()===l)return-1;if(d.id.toLowerCase()===l)return 1;const u=c.filter(m=>r.name.toLowerCase().includes(m)).length,h=c.filter(m=>d.name.toLowerCase().includes(m)).length;return u!==h?h-u:r.id.toLowerCase().includes(l)&&!d.id.toLowerCase().includes(l)?-1:d.id.toLowerCase().includes(l)&&!r.id.toLowerCase().includes(l)?1:0}),a.length>0?(t.innerHTML=a.slice(0,10).map(r=>{const d=typeof r.list=="object"?r.list?.name:r.list||"Unknown";return`
                    <div class="cu-task-result ${r.id.toLowerCase()===l?"cu-task-exact":""}" data-task-id="${r.id}" data-task-name="${this.escapeHtml(r.name)}" 
                         data-task-url="${r.url}" data-task-list="${this.escapeHtml(d)}">
                        <div class="cu-task-result-name">${this.highlightMatch(r.name,e)}</div>
                        <div class="cu-task-result-meta">
                            <span class="cu-task-result-id">#${r.id}</span>
                            <span class="cu-task-result-list">${this.escapeHtml(d)}</span>
                        </div>
                    </div>
                `}).join(""),t.querySelectorAll(".cu-task-result").forEach(r=>{r.addEventListener("click",()=>{this.selectTask({id:r.dataset.taskId,name:r.dataset.taskName,url:r.dataset.taskUrl,list:r.dataset.taskList})})})):t.innerHTML='<div class="cu-search-empty">No tasks found</div>'}catch(s){console.error("[Modal] Search error:",s),t.innerHTML='<div class="cu-search-error">Search failed</div>'}}extractTaskId(e){const t=e.match(/clickup\.com\/t\/([a-zA-Z0-9]+)/);if(t)return t[1];if(/^[a-zA-Z0-9]{6,12}$/.test(e.trim()))return e.trim();const s=e.match(/^#([a-zA-Z0-9]+)$/);return s?s[1]:null}selectTask(e){this.selectedTaskId=e.id,this.selectedTaskData=e;const t=this.modal.querySelector("#cu-task-search"),s=this.modal.querySelector(".cu-task-search-results"),a=this.modal.querySelector(".cu-selected-task"),i=this.modal.querySelector(".cu-search-hint");t.classList.add("hidden"),s.classList.add("hidden"),i&&i.classList.add("hidden"),a.classList.remove("hidden"),a.querySelector(".cu-selected-task-name").textContent=e.name;const o=typeof e.list=="object"?e.list?.name:e.list;a.querySelector(".cu-selected-task-list").textContent=o?`in ${o}`:`#${e.id}`}clearSelectedTask(){this.selectedTaskId=null,this.selectedTaskData=null;const e=this.modal.querySelector("#cu-task-search"),t=this.modal.querySelector(".cu-selected-task"),s=this.modal.querySelector(".cu-search-hint");e.classList.remove("hidden"),e.value="",t.classList.add("hidden"),s&&s.classList.remove("hidden")}}window.TaskModal=p;})();

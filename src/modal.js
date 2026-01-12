"use strict";(()=>{class u{constructor(){this.modal=null;this.emailData=null;this.hierarchy={spaces:[],folders:{},lists:{},members:[],allLists:[]};this.selectedListId=null;this.selectedListPath="";this.selectedTaskId=null;this.selectedTaskData=null;this.isResizing=!1;this.teamId=null}async show(t){this.emailData=t,this.createModal(),await this.loadFullHierarchy(),await this.loadDefaultList(),await this.prefillCurrentUser(),document.body.appendChild(this.modal),this.modal.querySelector("#cu-task-name").focus()}createModal(){this.modal=document.createElement("div"),this.modal.className="cu-modal-container",this.modal.innerHTML=`
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
    `,this.bindEvents(),this.prefillData(),this.setupResize(),this.setupDrag()}prefillData(){if(!this.emailData)return;this.modal.querySelector("#cu-task-name").value=this.emailData.subject||"";const t=new Date().toISOString().split("T")[0];this.modal.querySelector("#cu-start-date").value=t,this.modal.querySelector("#cu-due-date").value=t}async prefillCurrentUser(){try{const t=await chrome.runtime.sendMessage({action:"getStatus"});if(console.log("[Modal] Getting current user for assignee:",t),t&&t.user){const e=t.user.user||t.user;if(e.id){const s={user:{id:e.id,username:e.username,email:e.email,profilePicture:e.profilePicture}};this.selectAssignee(e.id.toString(),s),console.log("[Modal] Pre-selected current user as assignee:",e.username||e.email)}}}catch(t){console.error("[Modal] Error prefilling current user:",t)}}setupResize(){const t=this.modal.querySelector(".cu-resize-handle"),e=this.modal.querySelector(".cu-modal-window");t.addEventListener("mousedown",s=>{s.preventDefault(),this.isResizing=!0;const a=s.clientX,o=s.clientY,i=e.offsetWidth,n=e.offsetHeight,c=l=>{this.isResizing&&(e.style.width=Math.max(400,i+(l.clientX-a))+"px",e.style.height=Math.max(400,n+(l.clientY-o))+"px")},r=()=>{this.isResizing=!1,document.removeEventListener("mousemove",c),document.removeEventListener("mouseup",r)};document.addEventListener("mousemove",c),document.addEventListener("mouseup",r)})}setupDrag(){const t=this.modal.querySelector("#cu-modal-drag-handle"),e=this.modal.querySelector(".cu-modal-window");t.addEventListener("mousedown",s=>{if(s.target.classList.contains("cu-modal-close"))return;s.preventDefault();const a=s.clientX-e.offsetLeft,o=s.clientY-e.offsetTop,i=c=>{e.style.left=c.clientX-a+"px",e.style.top=c.clientY-o+"px",e.style.transform="none"},n=()=>{document.removeEventListener("mousemove",i),document.removeEventListener("mouseup",n)};document.addEventListener("mousemove",i),document.addEventListener("mouseup",n)})}bindEvents(){this.modal.querySelector(".cu-modal-close").addEventListener("click",()=>this.close()),this.modal.querySelector(".cu-btn-cancel").addEventListener("click",()=>this.close()),this.modal.querySelector(".cu-modal-window").addEventListener("keydown",i=>{i.key==="Escape"&&this.close()}),this.modal.querySelectorAll(".cu-tab").forEach(i=>{i.addEventListener("click",()=>this.switchTab(i.dataset.tab))});const t=this.modal.querySelector("#cu-location-input");t.addEventListener("input",()=>this.searchLists(t.value)),t.addEventListener("focus",()=>{this.selectedListId||this.searchLists(t.value)}),this.modal.querySelector(".cu-location-clear").addEventListener("click",()=>this.clearLocation());const e=this.modal.querySelector("#cu-assignee-search");e.addEventListener("input",i=>this.searchAssignees(i.target.value)),e.addEventListener("focus",()=>this.showAssigneeDropdown()),this.modal.querySelectorAll(".cu-editor-toolbar button[data-cmd]").forEach(i=>{i.addEventListener("click",()=>this.execEditorCommand(i.dataset.cmd))}),this.modal.querySelectorAll(".cu-editor-toolbar button[data-block]").forEach(i=>{i.addEventListener("click",()=>this.formatBlock(i.dataset.block))}),this.modal.querySelectorAll(".cu-editor-toolbar button[data-insert]").forEach(i=>{i.addEventListener("click",()=>this.insertElement(i.dataset.insert))});const s=this.modal.querySelector(".cu-toolbar-dropdown");s&&(s.querySelector(".cu-dropdown-trigger").addEventListener("click",n=>{n.stopPropagation(),s.classList.toggle("open")}),s.querySelectorAll(".cu-dropdown-menu button").forEach(n=>{n.addEventListener("click",()=>s.classList.remove("open"))})),this.modal.querySelectorAll(".cu-editor-tab").forEach(i=>{i.addEventListener("click",()=>this.switchEditorView(i.dataset.view))}),this.modal.querySelector("#cu-editor-visual").addEventListener("paste",i=>this.handleVisualPaste(i)),this.modal.querySelector("#cu-editor-visual").addEventListener("keydown",i=>{const n=i;if(n.ctrlKey||n.metaKey)switch(n.key.toLowerCase()){case"b":i.preventDefault(),this.execEditorCommand("bold");break;case"i":i.preventDefault(),this.execEditorCommand("italic");break;case"s":i.preventDefault(),this.execEditorCommand("strikeThrough");break;case"k":i.preventDefault(),this.execEditorCommand("createLink");break}}),this.modal.querySelector(".cu-btn-submit").addEventListener("click",()=>this.submit());const a=this.modal.querySelector("#cu-task-search");let o=null;a.addEventListener("input",()=>{o&&clearTimeout(o),o=setTimeout(()=>this.searchTasks(a.value),300)}),this.modal.querySelector(".cu-selected-task-clear").addEventListener("click",()=>this.clearSelectedTask()),document.addEventListener("click",i=>{if(this.modal){if(!i.target.closest(".cu-location-search")){const n=this.modal.querySelector(".cu-location-dropdown");n&&n.classList.add("hidden")}if(!i.target.closest(".cu-assignee-container")){const n=this.modal.querySelector(".cu-assignee-dropdown");n&&n.classList.add("hidden")}if(!i.target.closest(".cu-task-search-container")){const n=this.modal.querySelector(".cu-task-search-results");n&&n.classList.add("hidden")}}})}execEditorCommand(t){if(this.modal.querySelector("#cu-editor-visual").focus(),t==="createLink"){const s=prompt("Ingresa la URL:");s&&document.execCommand(t,!1,s)}else document.execCommand(t,!1,void 0)}formatBlock(t){this.modal.querySelector("#cu-editor-visual").focus(),document.execCommand("formatBlock",!1,"<"+t+">")}insertElement(t){this.modal.querySelector("#cu-editor-visual").focus();const a=window.getSelection()?.toString().trim()||"";let o="";switch(t){case"code":const i=a||"// Tu c\xF3digo aqu\xED";o='<pre style="background:#1e1e1e;color:#d4d4d4;padding:12px;border-radius:6px;font-family:monospace;overflow-x:auto;"><code>'+this.escapeHtml(i)+"</code></pre><br>";break;case"quote":o='<blockquote style="border-left:4px solid #7B68EE;padding-left:16px;margin:8px 0;color:#555;font-style:italic;">'+(a||"Tu cita aqu\xED")+"</blockquote><br>";break}o&&document.execCommand("insertHTML",!1,o)}handleVisualPaste(t){const e=t.clipboardData;if(!e)return;if(e.files&&e.files.length>0){t.preventDefault(),this.showToast("Images not supported (use attachments)","error");return}const s=e.getData("text/html");if(s){t.preventDefault();const a=this.cleanHtmlForClickUp(s);document.execCommand("insertHTML",!1,a)}}cleanHtmlForClickUp(t){const e=document.createElement("div");return e.innerHTML=t,e.querySelectorAll("img, script, style, iframe, object, embed, video, audio, canvas, svg, form, input, button").forEach(s=>s.remove()),e.querySelectorAll("*").forEach(s=>{s.removeAttribute("style"),s.removeAttribute("class"),s.removeAttribute("id")}),e.innerHTML}htmlToClickUpMarkdown(t){const e=document.createElement("div");e.innerHTML=t,e.querySelectorAll("script, style, img, svg, canvas, video, audio, iframe").forEach(a=>a.remove()),e.querySelectorAll("pre").forEach(a=>{const o=a.querySelector("code"),i=o?o.textContent:a.textContent;a.replaceWith("\n```\n"+(i||"").trim()+"\n```\n")}),e.querySelectorAll("blockquote").forEach(a=>{const i=(a.textContent||"").trim().split(`
`).map(n=>"> "+n.trim()).join(`
`);a.replaceWith(i+`
`)}),e.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach(a=>{const o=parseInt(a.tagName.charAt(1)),i="#".repeat(o)+" ",n=(a.textContent||"").trim();n&&a.replaceWith(`
`+i+n+`
`)}),e.querySelectorAll("a").forEach(a=>{const o=a.getAttribute("href"),i=(a.textContent||"").trim();o&&i?a.replaceWith(`[${i}](${o})`):i&&a.replaceWith(i)}),e.querySelectorAll("strong, b").forEach(a=>{const o=(a.textContent||"").trim();o&&a.replaceWith(`**${o}**`)}),e.querySelectorAll("em, i").forEach(a=>{const o=(a.textContent||"").trim();o&&a.replaceWith(`_${o}_`)}),e.querySelectorAll("del, s, strike").forEach(a=>{const o=(a.textContent||"").trim();o&&a.replaceWith(`~~${o}~~`)}),e.querySelectorAll("code").forEach(a=>{const o=(a.textContent||"").trim();o&&a.replaceWith(`\`${o}\``)}),e.querySelectorAll("ol").forEach(a=>{let o=1;a.querySelectorAll(":scope > li").forEach(i=>{const n=(i.textContent||"").trim();n&&(i.replaceWith(o+". "+n+`
`),o++)})}),e.querySelectorAll("ul li").forEach(a=>{let o=(a.textContent||"").trim();o.startsWith("\u2610")?o="- [ ] "+o.substring(1).trim():o.startsWith("\u2611")||o.startsWith("\u2713")?o="- [x] "+o.substring(1).trim():o="- "+o,a.replaceWith(o+`
`)});let s=e.textContent||e.innerText||"";return s=s.replace(/\r\n/g,`
`).replace(/\t/g," ").replace(/ +/g," ").replace(/\n +/g,`
`).replace(/ +\n/g,`
`).replace(/\n{3,}/g,`

`).split(`
`).map(a=>a.trim()).filter((a,o,i)=>a?!0:o>0&&i[o-1]&&o<i.length-1&&i[o+1]).join(`
`).trim(),s}async loadFullHierarchy(){try{console.log("[Modal] Loading hierarchy...");const t=await chrome.runtime.sendMessage({action:"getHierarchy"});if(console.log("[Modal] Teams response:",t),!t||!t.teams||t.teams.length===0){console.error("[Modal] No teams found in response");return}const e=t.teams[0];this.teamId=e.id,console.log("[Modal] Team ID:",e.id,"Team members:",e.members?.length||0),this.hierarchy.members=e.members||[];const s=await chrome.runtime.sendMessage({action:"getSpaces",teamId:e.id});if(console.log("[Modal] Spaces response:",s),!s||!s.spaces){console.error("[Modal] No spaces found in response");return}this.hierarchy.spaces=s.spaces,console.log("[Modal] Found",s.spaces.length,"spaces"),await this.loadAllLists()}catch(t){console.error("[Modal] Failed to load hierarchy:",t)}}async loadAllLists(){const t=[];console.log("[Modal] Loading lists for",this.hierarchy.spaces.length,"spaces...");for(const e of this.hierarchy.spaces){const s=e.color||"#7B68EE",a=e.avatar?e.avatar.url:null;try{console.log("[Modal] Loading lists for space:",e.name,e.id);const o=await chrome.runtime.sendMessage({action:"getLists",spaceId:e.id,folderId:null});console.log("[Modal] Space",e.name,"lists:",o),o&&o.lists&&o.lists.forEach(n=>{t.push({id:n.id,name:n.name,path:`${e.name} > ${n.name}`,spaceName:e.name,spaceColor:s,spaceAvatar:a})});const i=await chrome.runtime.sendMessage({action:"getFolders",spaceId:e.id});if(i&&i.folders)for(const n of i.folders){const c=await chrome.runtime.sendMessage({action:"getLists",folderId:n.id});c&&c.lists&&c.lists.forEach(r=>{t.push({id:r.id,name:r.name,path:`${e.name} > ${n.name} > ${r.name}`,spaceName:e.name,folderName:n.name,spaceColor:s,spaceAvatar:a})})}}catch(o){console.error("Error loading lists:",o)}}this.hierarchy.allLists=t}async loadDefaultList(){try{const t=await chrome.storage.local.get(["defaultList","defaultListConfig"]);if(console.log("[Modal] Checking for saved default list:",t),t.defaultListConfig&&t.defaultListConfig.listId){const e=t.defaultListConfig,s=this.hierarchy.allLists.find(a=>a.id===e.listId);if(s)console.log("[Modal] Pre-selecting saved list:",s.name),this.selectLocation(s.id,s.path);else if(t.defaultList){const a=this.hierarchy.allLists.find(o=>o.id===t.defaultList);a&&(console.log("[Modal] Pre-selecting list by ID:",a.name),this.selectLocation(a.id,a.path))}}else if(t.defaultList){const e=this.hierarchy.allLists.find(s=>s.id===t.defaultList);e&&(console.log("[Modal] Pre-selecting list (legacy format):",e.name),this.selectLocation(e.id,e.path))}}catch(t){console.error("[Modal] Error loading default list:",t)}}searchLists(t){const e=this.modal.querySelector(".cu-location-dropdown"),s=this.modal.querySelector(".cu-location-results");if(!t){e.classList.add("hidden");return}const a=t.toLowerCase(),o=this.hierarchy.allLists.filter(i=>i.name.toLowerCase().includes(a)||i.path.toLowerCase().includes(a));o.length>0?(s.innerHTML=o.slice(0,15).map(i=>{const n=i.spaceAvatar?`<img src="${i.spaceAvatar}" class="cu-space-avatar">`:`<span class="cu-space-avatar" style="background:${i.spaceColor}">${i.spaceName[0]}</span>`;return`
          <div class="cu-location-item" data-list-id="${i.id}" data-path="${this.escapeHtml(i.path)}">
            ${n}
            <div class="cu-location-info">
              <span class="cu-location-item-name">${this.highlightMatch(i.name,t)}</span>
              <span class="cu-location-item-path">${this.escapeHtml(i.path)}</span>
            </div>
          </div>
        `}).join(""),s.querySelectorAll(".cu-location-item").forEach(i=>{i.addEventListener("click",()=>{this.selectLocation(i.dataset.listId,i.dataset.path)})}),e.classList.remove("hidden")):(s.innerHTML='<p class="cu-hint">No lists found</p>',e.classList.remove("hidden"))}highlightMatch(t,e){const s=new RegExp(`(${this.escapeRegex(e)})`,"gi");return this.escapeHtml(t).replace(s,"<strong>$1</strong>")}escapeRegex(t){return t.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}async selectLocation(t,e){this.selectedListId=t,this.selectedListPath=e;const s=this.modal.querySelector("#cu-location-input"),a=this.modal.querySelector(".cu-selected-location"),o=this.modal.querySelector(".cu-location-path");s.classList.add("hidden"),a.classList.remove("hidden"),o.textContent=e,this.modal.querySelector(".cu-location-dropdown").classList.add("hidden");try{console.log("[Modal] Loading members for list:",t);const i=await chrome.runtime.sendMessage({action:"getMembers",data:{listId:t}});console.log("[Modal] Members result:",i),i&&i.members&&(this.hierarchy.members=i.members,console.log("[Modal] Loaded",i.members.length,"members"))}catch(i){console.error("[Modal] Failed to load members:",i)}}clearLocation(){this.selectedListId=null,this.selectedListPath="";const t=this.modal.querySelector("#cu-location-input"),e=this.modal.querySelector(".cu-selected-location");t.classList.remove("hidden"),t.value="",e.classList.add("hidden")}switchTab(t){this.modal.querySelectorAll(".cu-tab").forEach(s=>s.classList.remove("cu-tab-active")),this.modal.querySelector(`[data-tab="${t}"]`).classList.add("cu-tab-active"),this.modal.querySelectorAll(".cu-tab-content").forEach(s=>s.classList.remove("active")),this.modal.querySelector(`.cu-tab-${t}`).classList.add("active");const e=this.modal.querySelector(".cu-btn-submit .cu-btn-text");e.textContent=t==="create"?"Create Task":"Attach Email"}switchEditorView(t){const e=this.modal.querySelector("#cu-editor-visual"),s=this.modal.querySelector("#cu-editor-source"),a=this.modal.querySelector(".cu-editor-toolbar");this.modal.querySelectorAll(".cu-editor-tab").forEach(o=>o.classList.remove("active")),this.modal.querySelector(`[data-view="${t}"]`).classList.add("active"),t==="source"?(s.value=this.htmlToClickUpMarkdown(e.innerHTML),e.classList.add("hidden"),s.classList.remove("hidden"),a.classList.add("hidden")):(e.classList.remove("hidden"),s.classList.add("hidden"),a.classList.remove("hidden"))}searchAssignees(t){const e=this.modal.querySelector(".cu-assignee-dropdown");if(console.log("[Modal] searchAssignees called, query:",t,"members:",this.hierarchy.members),!t){e.classList.add("hidden");return}this.hierarchy.members.length>0&&console.log("[Modal] First member structure:",JSON.stringify(this.hierarchy.members[0]));const s=this.hierarchy.members.filter(a=>{const o=a.user||a;return o&&(o.username?.toLowerCase().includes(t.toLowerCase())||o.email?.toLowerCase().includes(t.toLowerCase()))});console.log("[Modal] Filtered members:",s.length),s.length>0?(e.innerHTML=s.map(a=>{const o=a.user||a,i=o.profilePicture?`<img src="${o.profilePicture}" class="cu-avatar">`:`<span class="cu-avatar cu-avatar-default">${(o.username||o.email||"?")[0].toUpperCase()}</span>`;return`
          <div class="cu-assignee-option" data-id="${o.id}">
            ${i}
            <span class="cu-assignee-name">${o.username||o.email}</span>
          </div>
        `}).join(""),e.querySelectorAll(".cu-assignee-option").forEach(a=>{a.addEventListener("click",()=>{const o=s.find(i=>(i.user||i).id?.toString()===a.dataset.id);this.selectAssignee(a.dataset.id,o)})}),e.classList.remove("hidden")):e.classList.add("hidden")}showAssigneeDropdown(){const t=this.modal.querySelector("#cu-assignee-search").value;t&&this.searchAssignees(t)}selectAssignee(t,e){const s=this.modal.querySelector(".cu-selected-assignees");if(s.querySelector(`[data-id="${t}"]`))return;const a=e?.user||e,o=a?.profilePicture?`<img src="${a.profilePicture}" class="cu-avatar-small">`:`<span class="cu-avatar-small cu-avatar-default">${(a?.username||a?.email||"?")[0]}</span>`,i=document.createElement("span");i.className="cu-assignee-tag",i.dataset.id=t,i.innerHTML=`${o} ${a?.username||a?.email||"User"} <button type="button">x</button>`,i.querySelector("button").addEventListener("click",()=>i.remove()),s.appendChild(i),this.modal.querySelector(".cu-assignee-dropdown").classList.add("hidden"),this.modal.querySelector("#cu-assignee-search").value=""}parseTime(t){if(!t)return null;let e=0;const s=t.match(/(\d+)\s*h/i),a=t.match(/(\d+)\s*m/i);if(s&&(e+=parseInt(s[1])*60*60*1e3),a&&(e+=parseInt(a[1])*60*1e3),!s&&!a){const o=parseFloat(t);isNaN(o)||(e=o*60*60*1e3)}return e>0?e:null}getDescription(){const t=this.modal.querySelector("#cu-editor-visual"),e=this.modal.querySelector("#cu-editor-source");return e.classList.contains("hidden")?this.htmlToClickUpMarkdown(t.innerHTML):e.value}async submit(){if(this.modal.querySelector(".cu-tab-active").dataset.tab==="attach"){const s=this.selectedTaskId||this.modal.querySelector("#cu-task-search").value.trim();s?await this.attachToTask(s):this.showToast("Please select or enter a task","error");return}if(!this.selectedListId){this.showToast("Please select a location","error");return}const e=this.modal.querySelector(".cu-btn-submit");e.disabled=!0,e.querySelector(".cu-btn-spinner").classList.remove("hidden"),e.querySelector(".cu-btn-text").textContent="Creating...";try{const s=Array.from(this.modal.querySelectorAll(".cu-assignee-tag")).map(d=>parseInt(d.dataset.id)),a=this.modal.querySelector("#cu-start-date").value,o=this.modal.querySelector("#cu-due-date").value,i=this.parseTime(this.modal.querySelector("#cu-time-estimate").value),n=this.parseTime(this.modal.querySelector("#cu-time-tracked").value),c={name:this.modal.querySelector("#cu-task-name").value||"Email Task",markdown_description:this.getDescription(),assignees:s,start_date:a?new Date(a).getTime():void 0,due_date:o?new Date(o).getTime():void 0},r=this.modal.querySelector("#cu-priority").value;r&&(c.priority=parseInt(r)),i&&(c.time_estimate=i);const l=await chrome.runtime.sendMessage({action:"createTaskFull",listId:this.selectedListId,taskData:c,emailData:this.modal.querySelector("#cu-attach-email").checked?this.emailData:null,timeTracked:n,teamId:this.teamId});l&&l.id?(this.showSuccessPopup(l),window.dispatchEvent(new CustomEvent("cu-task-created",{detail:{task:l,threadId:this.emailData.threadId}})),this.close()):this.showToast(l?.error||"Failed","error")}catch(s){this.showToast(s.message,"error")}e.disabled=!1,e.querySelector(".cu-btn-spinner").classList.add("hidden"),e.querySelector(".cu-btn-text").textContent="Create Task"}async attachToTask(t){const e=this.modal.querySelector(".cu-btn-submit");e.disabled=!0;try{const s=await chrome.runtime.sendMessage({action:"attachToTask",taskId:t,emailData:this.emailData});s&&(s.id||s.success)?(this.showToast("Email attached!","success"),window.dispatchEvent(new CustomEvent("cu-task-created",{detail:{task:s,threadId:this.emailData.threadId}})),this.close()):this.showToast(s?.error||"Failed","error")}catch(s){this.showToast(s.message,"error")}e.disabled=!1}showSuccessPopup(t){const e=document.querySelector(".cu-success-popup");e&&e.remove();const s=document.createElement("div");s.className="cu-success-popup",s.innerHTML=`
            <div class="cu-success-popup-content">
                <div class="cu-success-icon">\u2713</div>
                <div class="cu-success-title">Task Created!</div>
                <div class="cu-success-task-name">${this.escapeHtml(t.name)}</div>
                <button class="cu-btn cu-btn-primary cu-success-view-btn" data-url="${t.url}">
                    \u{1F517} View Task in ClickUp
                </button>
                <div class="cu-success-auto-close">Closing in <span class="cu-countdown">5</span>s...</div>
            </div>
        `,document.body.appendChild(s),s.querySelector(".cu-success-view-btn").addEventListener("click",()=>{window.open(t.url,"_blank"),s.remove()}),s.addEventListener("click",c=>{c.target===s&&s.remove()});let o=5;const i=s.querySelector(".cu-countdown"),n=setInterval(()=>{o--,i.textContent=o.toString(),o<=0&&(clearInterval(n),s.remove())},1e3)}showToast(t,e){const s=document.querySelector(".cu-toast");s&&s.remove();const a=document.createElement("div");a.className=`cu-toast cu-toast-${e}`,a.textContent=t,document.body.appendChild(a),setTimeout(()=>a.remove(),3e3)}close(){this.modal?.remove(),this.modal=null}escapeHtml(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML}async searchTasks(t){const e=this.modal.querySelector(".cu-task-search-results");if(t.length<4){e.classList.add("hidden");return}e.innerHTML='<div class="cu-search-loading">Searching...</div>',e.classList.remove("hidden");try{const s=this.extractTaskId(t);let a=[],o=null;if(s)try{const r=await chrome.runtime.sendMessage({action:"getTaskById",taskId:s});r&&r.id&&(o=r)}catch(r){console.log("[Modal] Exact task lookup failed:",r)}const i=s||t,n=await chrome.runtime.sendMessage({action:"searchTasks",query:i});n&&n.tasks&&(a=n.tasks),o&&(a=a.filter(r=>r.id!==o.id),a.unshift(o));const c=(s||t).toLowerCase();a.sort((r,l)=>r.id.toLowerCase()===c?-1:l.id.toLowerCase()===c?1:r.id.toLowerCase().includes(c)&&!l.id.toLowerCase().includes(c)?-1:l.id.toLowerCase().includes(c)&&!r.id.toLowerCase().includes(c)?1:0),a.length>0?(e.innerHTML=a.slice(0,10).map(r=>{const l=typeof r.list=="object"?r.list?.name:r.list||"Unknown";return`
                    <div class="cu-task-result ${r.id.toLowerCase()===c?"cu-task-exact":""}" data-task-id="${r.id}" data-task-name="${this.escapeHtml(r.name)}" 
                         data-task-url="${r.url}" data-task-list="${this.escapeHtml(l)}">
                        <div class="cu-task-result-name">${this.highlightMatch(r.name,t)}</div>
                        <div class="cu-task-result-meta">
                            <span class="cu-task-result-id">#${r.id}</span>
                            <span class="cu-task-result-list">${this.escapeHtml(l)}</span>
                        </div>
                    </div>
                `}).join(""),e.querySelectorAll(".cu-task-result").forEach(r=>{r.addEventListener("click",()=>{this.selectTask({id:r.dataset.taskId,name:r.dataset.taskName,url:r.dataset.taskUrl,list:r.dataset.taskList})})})):e.innerHTML='<div class="cu-search-empty">No tasks found</div>'}catch(s){console.error("[Modal] Search error:",s),e.innerHTML='<div class="cu-search-error">Search failed</div>'}}extractTaskId(t){const e=t.match(/clickup\.com\/t\/([a-zA-Z0-9]+)/);if(e)return e[1];if(/^[a-zA-Z0-9]{6,12}$/.test(t.trim()))return t.trim();const s=t.match(/^#([a-zA-Z0-9]+)$/);return s?s[1]:null}selectTask(t){this.selectedTaskId=t.id,this.selectedTaskData=t;const e=this.modal.querySelector("#cu-task-search"),s=this.modal.querySelector(".cu-task-search-results"),a=this.modal.querySelector(".cu-selected-task"),o=this.modal.querySelector(".cu-search-hint");e.classList.add("hidden"),s.classList.add("hidden"),o&&o.classList.add("hidden"),a.classList.remove("hidden"),a.querySelector(".cu-selected-task-name").textContent=t.name;const i=typeof t.list=="object"?t.list?.name:t.list;a.querySelector(".cu-selected-task-list").textContent=i?`in ${i}`:`#${t.id}`}clearSelectedTask(){this.selectedTaskId=null,this.selectedTaskData=null;const t=this.modal.querySelector("#cu-task-search"),e=this.modal.querySelector(".cu-selected-task"),s=this.modal.querySelector(".cu-search-hint");t.classList.remove("hidden"),t.value="",e.classList.add("hidden"),s&&s.classList.remove("hidden")}}window.TaskModal=u;})();

import{e as D}from"./chunk-WGMH7ZD2.js";import{Qa as W,Ra as J,U as L,Ua as x,V as j,Va as G,W as V,Wa as Y,X as $,Y as K,Ya as Z,Za as C,a as p,b as P,c as z,ib as v,mb as E,ob as O}from"./chunk-RKFUX3HF.js";import{a as T,b as k,c as M,d as U,e as I,f as S,h as w}from"./chunk-EA4QC63W.js";import{b}from"./chunk-CI6AM5G6.js";import{b as H}from"./chunk-DNOIYVEK.js";import{a as B}from"./chunk-NICZD2J2.js";import{a as A,c as q}from"./chunk-JOVBCH5E.js";function X(){try{let i=b.getProfile(),e=i.college||i.faculty;e&&e!=="All"&&!i.education_type&&b.migrateEducationType("University")}catch(i){console.warn("Legacy profile migration skipped:",i)}}var Q=class{constructor(e,t,s){if(this.container=document.querySelector(e),this.onSearchCallback=t,this.getNavigationStack=s,this.allCourses=[],this.filteredCourses=[],this.categoryTree=null,this.userQuizzes=[],this.currentContext=null,this.searchConfig={debounceDelay:300,minSearchLength:1,maxHistoryItems:10},this.filters={searchQuery:"",scope:"all",contentType:"all",educationType:"all",faculty:"all",sortBy:"relevance"},this.settings=this.loadSearchSettings(),this.settings.educationType)this.filters.educationType=this.settings.educationType;else{let r=b.getProfile();r&&r.education_type&&(this.filters.educationType=r.education_type)}this.searchHistory=this.loadSearchHistory(),this.debounceTimer=null,this.isFiltersPanelOpen=!1,this.isBarOpen=!1,this.elements={}}init(e,t){this.allCourses=e,this.filteredCourses=e,this.categoryTree=t,this.cacheElements(),this.syncEducationTypeUI(),this.bindSearchInput(),this.bindFilterControls(),this.bindFilterToggle(),this.bindHeaderSearchBtn(),this.bindSearchClose(),this.populateFacultyFilter(),this.bindResetFilters(),this.bindOutsideClick(),this.setupKeyboardShortcuts(),this.updateContextVisibility(),this.bindHeaderReserveHeight()}syncEducationTypeUI(){document.querySelectorAll('input[name="educationType"]').forEach(e=>{e.checked=e.value===this.filters.educationType})}cacheElements(){this.elements={searchInput:document.getElementById("courseSearch"),searchClose:document.getElementById("searchClose"),headerSearchBtn:document.getElementById("headerSearchBtn"),headerEl:document.querySelector(".header"),searchBar:document.querySelector(".search-bar"),contentArea:document.getElementById("contentArea"),filterToggle:document.getElementById("filterToggle"),searchFilters:document.getElementById("searchFilters"),searchSummary:document.getElementById("searchSummary"),resultCount:document.getElementById("resultCount"),activeFilterTags:document.getElementById("activeFilterTags"),facultyFilterGroup:document.getElementById("facultyFilterGroup"),facultyFilter:document.getElementById("facultyFilter"),sortBy:document.getElementById("sortBy"),applyFilters:document.getElementById("applyFilters"),resetFilters:document.getElementById("resetFilters")}}updateContextVisibility(){let e=this.getNavigationStack?this.getNavigationStack():[];if(e.length===0)this.currentContext="courses",this.elements.searchInput&&(this.elements.searchInput.placeholder="\u0627\u0628\u062D\u062B \u0639\u0646 \u0645\u0627\u062F\u0629"),this.elements.headerSearchBtn&&(this.elements.headerSearchBtn.style.display="flex");else{let t=e[e.length-1];if(t.name==="\u0645\u062D\u062A\u0648\u0627\u064A"||t.name==="\u0627\u0645\u062A\u062D\u0627\u0646\u0627\u062A\u0643")this.currentContext="userQuizzes",this.elements.searchInput&&(this.elements.searchInput.placeholder="\u0627\u0628\u062D\u062B \u0641\u064A \u0645\u062D\u062A\u0648\u0627\u064A..."),this.elements.headerSearchBtn&&(this.elements.headerSearchBtn.style.display="flex");else{let s=t&&this.collectAllExams(t).length>0;this.currentContext="quizzes",s?(this.elements.searchInput&&(this.elements.searchInput.placeholder="\u0627\u0628\u062D\u062B \u0639\u0646 \u0627\u0645\u062A\u062D\u0627\u0646"),this.elements.headerSearchBtn&&(this.elements.headerSearchBtn.style.display="flex")):(this.elements.headerSearchBtn&&(this.elements.headerSearchBtn.style.display="none"),this.closeSearchBar(!0))}}this.elements.filterToggle&&(this.elements.filterToggle.style.display=this.currentContext==="courses"?"flex":"none"),this._resetSearchState()}_resetSearchState(){this.filters.searchQuery="",this.elements.searchInput&&(this.elements.searchInput.value=""),this.updateCloseButtonMode(""),this.elements.searchSummary&&(this.elements.searchSummary.style.display="none"),this.elements.headerEl&&this.elements.headerEl.classList.remove("summary-is-open")}bindSearchInput(){this.elements.searchInput&&(this.elements.searchInput.addEventListener("input",e=>{this.handleSearchInput(e.target.value)}),this.elements.searchInput.addEventListener("keydown",e=>{e.key==="Enter"?(e.preventDefault(),this.performSearch()):e.key==="Escape"&&this.closeSearchBar()}))}handleSearchInput(e){this.updateCloseButtonMode(e),clearTimeout(this.debounceTimer),this.elements.contentArea&&this.elements.contentArea.setAttribute("aria-busy","true"),this.elements.searchBar&&this.elements.searchBar.classList.add("is-searching"),this.debounceTimer=setTimeout(()=>{this.filters.searchQuery=e,this.performSearch()},this.searchConfig.debounceDelay)}updateCloseButtonMode(e){if(!this.elements.searchClose)return;let t=!!e;this.elements.searchClose.setAttribute("aria-label",t?"\u0645\u0633\u062D \u0627\u0644\u0628\u062D\u062B":"\u0625\u063A\u0644\u0627\u0642 \u0627\u0644\u0628\u062D\u062B"),this.elements.searchClose.title=t?"\u0645\u0633\u062D \u0627\u0644\u0628\u062D\u062B":"\u0625\u063A\u0644\u0627\u0642 \u0627\u0644\u0628\u062D\u062B",this.elements.searchClose.classList.toggle("mode-clear",t)}performSearch(){this.elements.searchBar&&this.elements.searchBar.classList.remove("is-searching"),this.currentContext==="courses"?this.searchCourses():this.currentContext==="quizzes"?this.searchQuizzes():this.currentContext==="userQuizzes"&&this.searchUserQuizzes()}searchCourses(){let e=[...this.allCourses],t=this.filterByTrackScope(e);if(this.filters.educationType!=="all"&&(t=this.filterByEducationType(t)),this.filters.faculty!=="all"&&(t=this.filterByFaculty(t)),this.filters.contentType==="exams"&&this.filters.searchQuery&&this.filters.searchQuery.length>=this.searchConfig.minSearchLength){let s=[],r=new Set;t.forEach(c=>{s.push(...this.collectAllExams(c,r))});let a=this.filterQuizzesBySearchQuery(s);this.addToSearchHistory(this.filters.searchQuery);let o=this.sortQuizzes(a);this.filteredCourses=o,this.updateUI(o),this.onSearchCallback&&this.onSearchCallback(o,"quizzes");return}e=t,this.filters.searchQuery&&this.filters.searchQuery.length>=this.searchConfig.minSearchLength&&(e=this.filterCoursesBySearchQuery(e),this.addToSearchHistory(this.filters.searchQuery)),this.filters.contentType!=="all"&&(e=this.filterByContentType(e)),e=this.sortResults(e),this.filteredCourses=e,this.updateUI(e),this.onSearchCallback&&this.onSearchCallback(e,"courses")}searchQuizzes(){let e=this.getNavigationStack?this.getNavigationStack():[];if(e.length===0)return;let t=e[e.length-1];if(!t)return;let s=this.collectAllExams(t);if(s.length===0)return;let r=s;this.filters.searchQuery&&this.filters.searchQuery.length>=this.searchConfig.minSearchLength&&(r=this.filterQuizzesBySearchQuery(r),this.addToSearchHistory(this.filters.searchQuery)),r=this.sortQuizzes(r),this.updateUI(r),this.onSearchCallback&&this.onSearchCallback(r,"quizzes")}searchUserQuizzes(){if(!this.userQuizzes||this.userQuizzes.length===0){this.onSearchCallback&&this.onSearchCallback([],"userQuizzes");return}let e=this.userQuizzes;this.filters.searchQuery&&this.filters.searchQuery.length>=this.searchConfig.minSearchLength&&(e=this.filterUserQuizzesBySearchQuery(e),this.addToSearchHistory(this.filters.searchQuery)),this.updateUI(e),this.onSearchCallback&&this.onSearchCallback(e,"userQuizzes")}setUserQuizzesContext(e){this.userQuizzes=e,this.currentContext="userQuizzes"}collectAllExams(e,t=new Set){if(!e)return[];let s=e.id||e.name;if(s&&t.has(s))return[];s&&t.add(s);let r=(e.exams||e.quizzes||[]).map(o=>({...o,_sourceCategoryName:e.name||""})),a=[];if(Array.isArray(e.subcategories)&&this.categoryTree)for(let o of e.subcategories){let c=this.categoryTree[o];c&&a.push(...this.collectAllExams(c,t))}return[...r,...a]}filterCoursesBySearchQuery(e){let s=this.filters.searchQuery.toLowerCase().trim().split(/\s+/);return e.filter(r=>{let a=[r.name||"",r.id||"",r.code||"",r.faculty||"",r.description||"",r.education_type||"",(r.tags||[]).join(" ")].join(" ").toLowerCase();return s.every(o=>a.includes(o))})}filterQuizzesBySearchQuery(e){let s=this.filters.searchQuery.toLowerCase().trim().split(/\s+/);return e.filter(r=>{let a=[r.title||"",r.name||"",r.id||"",r.description||"",r.education_type||"",r.category||"",r._sourceCategoryName||""].join(" ").toLowerCase();return s.every(o=>a.includes(o))})}filterUserQuizzesBySearchQuery(e){let s=this.filters.searchQuery.toLowerCase().trim().split(/\s+/);return e.filter(r=>{let a=[r.title||"",r.description||""].join(" ").toLowerCase();return s.every(o=>a.includes(o))})}filterByTrackScope(e){if(this.filters.scope==="all")return e;let t=b.getProfile(),s=t?t.education_type:null,r=b.getSubscribedCourseIds();return e.filter(a=>a.education_type==="Featured"?r.includes(a.id):!(!r.includes(a.id)||s&&a.education_type!==s))}filterByContentType(e){return e.filter(t=>{let s=t.exams&&t.exams.length>0,r=t.subcategories&&t.subcategories.length>0;return this.filters.contentType==="courses"?r:this.filters.contentType==="exams"?s:!0})}filterByEducationType(e){let s={"High-School":"High","Middle-School":"Middle"}[this.filters.educationType]||this.filters.educationType;return e.filter(r=>r.education_type==="Featured"?!0:r.education_type===s)}filterByFaculty(e){return e.filter(t=>t.faculty===this.filters.faculty)}sortResults(e){let t={relevance:(r,a)=>{if(!this.filters.searchQuery)return 0;let o=this.filters.searchQuery.toLowerCase(),c=(r.name||"").toLowerCase(),l=(a.name||"").toLowerCase(),h=c===o?2:0,u=l===o?2:0,n=c.startsWith(o)?1:0,d=l.startsWith(o)?1:0,f=h+n;return u+d-f||c.localeCompare(l,"ar")},name:(r,a)=>{let o=(r.name||"").toLowerCase(),c=(a.name||"").toLowerCase();return o.localeCompare(c,"ar")},recent:(r,a)=>{let o=this.getLastAttemptTime(r.id)||0;return(this.getLastAttemptTime(a.id)||0)-o},progress:(r,a)=>{let o=this.getProgress(r.id)||0;return(this.getProgress(a.id)||0)-o}},s=t[this.filters.sortBy]||t.relevance;return[...e].sort(s)}sortQuizzes(e){let t=this.filters.searchQuery.toLowerCase();return[...e].sort((s,r)=>{if(!t)return 0;let a=(s.title||"").toLowerCase(),o=(r.title||"").toLowerCase(),c=a===t?2:0,l=o===t?2:0,h=a.startsWith(t)?1:0,u=o.startsWith(t)?1:0,n=c+h;return l+u-n||a.localeCompare(o,"ar")})}bindFilterControls(){document.querySelectorAll('input[name="searchScope"]').forEach(e=>{e.addEventListener("change",t=>{this.filters.scope=t.target.value,this.performSearch(),this.updateActiveFilters()})}),document.querySelectorAll('input[name="contentType"]').forEach(e=>{e.addEventListener("change",t=>{this.filters.contentType=t.target.value,this.performSearch(),this.updateActiveFilters()})}),document.querySelectorAll('input[name="educationType"]').forEach(e=>{e.addEventListener("change",t=>{this.filters.educationType=t.target.value,this.setEducationTypeSetting(t.target.value),this.updateFacultyVisibility(),this.performSearch(),this.updateActiveFilters()})}),this.elements.facultyFilter&&this.elements.facultyFilter.addEventListener("change",e=>{this.filters.faculty=e.target.value,this.performSearch(),this.updateActiveFilters()}),this.elements.sortBy&&this.elements.sortBy.addEventListener("change",e=>{this.filters.sortBy=e.target.value,this.performSearch(),this.updateActiveFilters()})}populateFacultyFilter(){if(!this.elements.facultyFilter)return;let e=new Set;this.allCourses.forEach(t=>{t.faculty&&t.education_type==="University"&&e.add(t.faculty)}),this.elements.facultyFilter.innerHTML='<option value="all">\u062C\u0645\u064A\u0639 \u0627\u0644\u0643\u0644\u064A\u0627\u062A</option>',Array.from(e).sort((t,s)=>t.localeCompare(s,"ar")).forEach(t=>{let s=document.createElement("option");s.value=t,s.textContent=t,this.elements.facultyFilter.appendChild(s)}),this.updateFacultyVisibility()}updateFacultyVisibility(){let e=this.elements.facultyFilterGroup;if(!e)return;let t=this.filters.educationType==="University";e.style.display=t?"":"none",!t&&this.filters.faculty!=="all"&&(this.filters.faculty="all",this.elements.facultyFilter&&(this.elements.facultyFilter.value="all"))}bindHeaderSearchBtn(){this.elements.headerSearchBtn&&this.elements.headerSearchBtn.addEventListener("click",()=>{this.isBarOpen?this.closeSearchBar():this.openSearchBar()})}bindSearchClose(){this.elements.searchClose&&this.elements.searchClose.addEventListener("click",()=>{!!(this.elements.searchInput&&this.elements.searchInput.value)?this.clearSearch():this.closeSearchBar()})}bindHeaderReserveHeight(){let e=this.container?this.container.querySelector(".search-bar-row"):null;if(!e||!this.elements.headerEl)return;let t=()=>{let s=e.getBoundingClientRect().height;this.elements.headerEl.style.setProperty("--search-reserve-height",`${Math.ceil(s)}px`)};t(),typeof ResizeObserver<"u"?(this._searchRowResizeObserver=new ResizeObserver(t),this._searchRowResizeObserver.observe(e)):window.addEventListener("resize",t)}openSearchBar(){this.container&&(this.isBarOpen=!0,this.container.classList.add("is-open"),this.container.setAttribute("aria-hidden","false"),this.elements.headerEl&&this.elements.headerEl.classList.add("is-open"),this.elements.headerSearchBtn&&(this.elements.headerSearchBtn.setAttribute("aria-expanded","true"),this.elements.headerSearchBtn.classList.add("is-bar-open")),setTimeout(()=>{this.elements.searchInput&&this.elements.searchInput.focus()},80))}closeSearchBar(e=!1){this.container&&(this.isBarOpen=!1,this.container.classList.remove("is-open"),this.container.setAttribute("aria-hidden","true"),this.elements.headerEl&&this.elements.headerEl.classList.remove("is-open"),this.elements.headerSearchBtn&&(this.elements.headerSearchBtn.setAttribute("aria-expanded","false"),this.elements.headerSearchBtn.classList.remove("is-bar-open")),this.isFiltersPanelOpen&&(this.isFiltersPanelOpen=!1,this.elements.searchFilters&&(this.elements.searchFilters.style.display="none"),this.elements.filterToggle&&(this.elements.filterToggle.classList.remove("active"),this.elements.filterToggle.setAttribute("aria-expanded","false"))),!e&&(this.filters.searchQuery||this.hasActiveFilters())?(this._resetSearchState(),this.onSearchCallback&&this.onSearchCallback(null,this.currentContext,!0)):e&&this._resetSearchState())}bindFilterToggle(){this.elements.filterToggle&&this.elements.filterToggle.addEventListener("click",()=>{this.toggleFiltersPanel()})}bindResetFilters(){this.elements.resetFilters&&this.elements.resetFilters.addEventListener("click",()=>{this.resetFilters()})}bindOutsideClick(){document.addEventListener("pointerdown",e=>{if(!this.isFiltersPanelOpen||!this.elements.searchFilters)return;let t=this.elements.searchFilters.contains(e.target),s=this.elements.filterToggle&&this.elements.filterToggle.contains(e.target);!t&&!s&&this.toggleFiltersPanel()})}clearSearch(){this.elements.searchInput&&(this.elements.searchInput.value="",this.elements.searchInput.focus()),this.updateCloseButtonMode(""),this.filters.searchQuery="",this.performSearch()}toggleFiltersPanel(){this.currentContext==="courses"&&(this.isFiltersPanelOpen=!this.isFiltersPanelOpen,this.elements.searchFilters&&(this.elements.searchFilters.style.display=this.isFiltersPanelOpen?"block":"none"),this.elements.filterToggle&&(this.elements.filterToggle.classList.toggle("active",this.isFiltersPanelOpen),this.elements.filterToggle.setAttribute("aria-expanded",this.isFiltersPanelOpen)))}resetFilters(){this.filters={searchQuery:this.filters.searchQuery,scope:"all",contentType:"all",educationType:"all",faculty:"all",sortBy:"relevance"},this.setEducationTypeSetting("all"),document.querySelectorAll('input[name="searchScope"]').forEach(e=>{e.checked=e.value==="all"}),document.querySelectorAll('input[name="contentType"]').forEach(e=>{e.checked=e.value==="all"}),document.querySelectorAll('input[name="educationType"]').forEach(e=>{e.checked=e.value==="all"}),this.elements.facultyFilter&&(this.elements.facultyFilter.value="all"),this.elements.sortBy&&(this.elements.sortBy.value="relevance"),this.updateFacultyVisibility(),this.performSearch(),this.updateActiveFilters()}updateUI(e){this.elements.resultCount&&(this.elements.resultCount.textContent=e.length);let t=this.hasActiveFilters();this.elements.searchSummary&&(this.elements.searchSummary.style.display=t?"flex":"none"),this.elements.headerEl&&this.elements.headerEl.classList.toggle("summary-is-open",t),this.currentContext==="courses"&&this.updateActiveFilters(),this.elements.filterToggle&&(this.elements.filterToggle.style.display=this.currentContext==="courses"?"flex":"none")}hasActiveFilters(){return this.filters.searchQuery.length>=this.searchConfig.minSearchLength||this.filters.scope!=="all"||this.filters.contentType!=="all"||this.filters.educationType!=="all"||this.filters.faculty!=="all"||this.filters.sortBy!=="relevance"}updateActiveFilters(){if(!this.elements.activeFilterTags)return;let e=[];if(this.filters.scope==="subscribed"&&e.push({label:"\u0627\u0644\u0645\u0648\u0627\u062F \u0627\u0644\u0645\u0634\u062A\u0631\u0643 \u0628\u0647\u0627",key:"scope"}),this.filters.contentType==="courses"?e.push({label:"\u0645\u0648\u0627\u062F \u0641\u0642\u0637",key:"contentType"}):this.filters.contentType==="exams"&&e.push({label:"\u0627\u0645\u062A\u062D\u0627\u0646\u0627\u062A \u0641\u0642\u0637",key:"contentType"}),this.filters.educationType!=="all"){let t={University:"\u062C\u0627\u0645\u0639\u064A","High-School":"\u062B\u0627\u0646\u0648\u064A","Middle-School":"\u0625\u0639\u062F\u0627\u062F\u064A",Primary:"\u0627\u0628\u062A\u062F\u0627\u0626\u064A"};e.push({label:t[this.filters.educationType]||this.filters.educationType,key:"educationType"})}if(this.filters.faculty!=="all"&&e.push({label:this.filters.faculty,key:"faculty"}),this.filters.sortBy!=="relevance"){let t={name:"\u0627\u0644\u062A\u0631\u062A\u064A\u0628: \u0627\u0644\u0627\u0633\u0645",recent:"\u0627\u0644\u062A\u0631\u062A\u064A\u0628: \u0627\u0644\u0623\u062D\u062F\u062B",progress:"\u0627\u0644\u062A\u0631\u062A\u064A\u0628: \u0627\u0644\u062A\u0642\u062F\u0645"};e.push({label:t[this.filters.sortBy],key:"sortBy"})}this.elements.activeFilterTags.innerHTML=e.map(t=>`
      <button class="filter-tag" data-filter="${t.key}" aria-label="\u0625\u0632\u0627\u0644\u0629 \u0641\u0644\u062A\u0631 ${t.label}">
        ${t.label}
        <span class="filter-tag-remove" aria-hidden="true">\xD7</span>
      </button>
    `).join(""),this.elements.activeFilterTags.querySelectorAll(".filter-tag").forEach(t=>{t.addEventListener("click",()=>{this.removeFilter(t.dataset.filter)})})}removeFilter(e){switch(e){case"scope":this.filters.scope="all",document.querySelectorAll('input[name="searchScope"]').forEach(t=>{t.checked=t.value==="all"});break;case"contentType":this.filters.contentType="all",document.querySelectorAll('input[name="contentType"]').forEach(t=>{t.checked=t.value==="all"});break;case"educationType":this.filters.educationType="all",this.setEducationTypeSetting("all"),document.querySelectorAll('input[name="educationType"]').forEach(t=>{t.checked=t.value==="all"}),this.updateFacultyVisibility();break;case"faculty":this.filters.faculty="all",this.elements.facultyFilter&&(this.elements.facultyFilter.value="all");break;case"sortBy":this.filters.sortBy="relevance",this.elements.sortBy&&(this.elements.sortBy.value="relevance");break}this.performSearch(),this.updateActiveFilters()}loadSearchSettings(){try{let e=localStorage.getItem("quiz_search_settings");return e?JSON.parse(e):{}}catch(e){return console.error("Error loading search settings:",e),{}}}saveSearchSettings(){try{localStorage.setItem("quiz_search_settings",JSON.stringify(this.settings))}catch(e){console.error("Error saving search settings:",e)}}setEducationTypeSetting(e){this.settings.educationType=e,this.saveSearchSettings()}loadSearchHistory(){try{let e=localStorage.getItem("quiz_search_history");return e?JSON.parse(e):[]}catch(e){return console.error("Error loading search history:",e),[]}}saveSearchHistory(){try{localStorage.setItem("quiz_search_history",JSON.stringify(this.searchHistory))}catch(e){console.error("Error saving search history:",e)}}addToSearchHistory(e){!e||e.length<this.searchConfig.minSearchLength||(this.searchHistory=this.searchHistory.filter(t=>t!==e),this.searchHistory.unshift(e),this.searchHistory.length>this.searchConfig.maxHistoryItems&&(this.searchHistory=this.searchHistory.slice(0,this.searchConfig.maxHistoryItems)),this.saveSearchHistory())}getLastAttemptTime(e){try{let s=b.getQuizHistory().filter(r=>r.courseId===e);return s.length===0?0:Math.max(...s.map(r=>r.timestamp||0))}catch{return 0}}getProgress(e){try{return b.getCourseProgress(e)||0}catch{return 0}}setupKeyboardShortcuts(){document.addEventListener("keydown",e=>{(e.ctrlKey||e.metaKey)&&e.key==="k"&&(e.preventDefault(),this.elements.headerSearchBtn&&this.elements.headerSearchBtn.style.display!=="none"&&(this.isBarOpen?this.elements.searchInput&&this.elements.searchInput.focus():this.openSearchBar())),e.key==="Escape"&&this.isBarOpen&&this.closeSearchBar(),(e.ctrlKey||e.metaKey)&&e.key==="f"&&this.isBarOpen&&this.currentContext==="courses"&&(e.preventDefault(),this.isFiltersPanelOpen||this.toggleFiltersPanel())})}getResults(){return this.filteredCourses}isSearchActive(){return this.hasActiveFilters()}search(e){this.isBarOpen||this.openSearchBar(),this.elements.searchInput&&(this.elements.searchInput.value=e),this.updateCloseButtonMode(e),this.filters.searchQuery=e,this.performSearch()}};function ee(i,e){try{let s=b.getSubscribedCourseIds().includes(e.id),r=document.createElement("div");r.className="subscribe-btn-container";let a=document.createElement("button");a.className=s?"subscribe-btn subscribe-btn--subscribed":"subscribe-btn subscribe-btn--add",a.textContent=s?"\u2713 \u0645\u0634\u062A\u0631\u0643":"+ \u0625\u0636\u0627\u0641\u0629",a.type="button",a.setAttribute("aria-label",s?`\u0645\u0634\u062A\u0631\u0643 \u0641\u064A ${e.name}`:`\u0625\u0636\u0627\u0641\u0629 ${e.name}`),s||(a.onclick=o=>{o.stopPropagation(),ie(e,a)}),r.appendChild(a),i.appendChild(r)}catch(t){console.error("Error adding subscribe button:",t)}}function ie(i,e){try{b.subscribeToCourse(i.id),e.textContent="\u2713 \u0645\u0634\u062A\u0631\u0643",e.className="subscribe-btn subscribe-btn--subscribed",e.onclick=null,e.setAttribute("aria-label",`\u0645\u0634\u062A\u0631\u0643 \u0641\u064A ${i.name}`),A("\u062A\u0645 \u0627\u0644\u0625\u0634\u062A\u0631\u0627\u0643",`\u062A\u0645 \u0625\u0636\u0627\u0641\u0629 ${i.name} \u0625\u0644\u0649 \u0645\u0648\u0627\u062F\u0643`,"./favicon.png")}catch(t){console.error("Error subscribing to course:",t),q("\u062D\u062F\u062B \u062E\u0637\u0623 \u0623\u062B\u0646\u0627\u0621 \u0627\u0644\u0625\u0634\u062A\u0631\u0627\u0643. \u062D\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649.")}}function R(){try{let i=T(),e=Object.entries(i).filter(([s,r])=>!r.parent).map(([s,r])=>({key:s,...r})),t=new Q("#searchContainer",ne,()=>I());t.init(e,i),U(t)}catch(i){console.error("Error initializing search manager:",i)}}function ne(i,e,t=!1){try{if(t){e==="userQuizzes"?v():C();return}e==="courses"?ae(i):e==="quizzes"?oe(i):e==="userQuizzes"&&le(i)}catch(s){console.error("Error handling search results:",s)}}function ae(i){try{let e=M();e&&e.isSearchActive()?(I().length=0,Y(),P&&(P.textContent="\u0646\u062A\u0627\u0626\u062C \u0627\u0644\u0628\u062D\u062B"),ce(i)):C()}catch(e){console.error("Error handling course search results:",e)}}function oe(i){try{he(i)}catch(e){console.error("Error handling quiz search results:",e)}}function le(i){try{if(!p)return;p.innerHTML="";let e=document.createElement("div");if(e.className="user-quiz-search-actions",p.appendChild(e),!i||i.length===0){let t=L({variant:"panel",icon:"search",title:"\u0644\u0627 \u062A\u0648\u062C\u062F \u0646\u062A\u0627\u0626\u062C \u0628\u062D\u062B"});p.appendChild(t)}else{let t=JSON.parse(B("user_quizzes","[]"));i.forEach(s=>{let r=t.findIndex(o=>o.id===s.id),a=J(s,r!==-1?r:0);p.appendChild(a)})}}catch(e){console.error("Error handling user quiz search results:",e)}}function ce(i){try{if(!p)return;p.innerHTML="",p.className="hive-root",p.setAttribute("aria-busy","false");let e=document.createDocumentFragment();if(i.length===0){let r=L({variant:"grid",icon:"search",title:"\u0644\u0627 \u062A\u0648\u062C\u062F \u0646\u062A\u0627\u0626\u062C",subtitle:"\u062C\u0631\u0651\u0628 \u0627\u0644\u0628\u062D\u062B \u0628\u0643\u0644\u0645\u0627\u062A \u0645\u062E\u062A\u0644\u0641\u0629 \u0623\u0648 \u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0641\u0644\u0627\u062A\u0631"});p.className="grid-container",p.appendChild(r);return}let{comb:t,cells:s}=K();p.appendChild(t),i.forEach(r=>{let a=O(r),o=T(),c=$({name:r.name,subtext:V(a),href:j(r),courseData:r,onActivate:()=>x(o[r.key])});Z(c,r,o,{showUnsubscribe:!1});let l=M();l&&l.isSearchActive()&&ee(c,r),e.appendChild(c)}),s.appendChild(e)}catch(e){console.error("Error rendering course search results:",e),p&&(p.innerHTML=`
        <div class="error-state" role="alert">
          <p>\u062D\u062F\u062B \u062E\u0637\u0623 \u0623\u062B\u0646\u0627\u0621 \u0639\u0631\u0636 \u0627\u0644\u0646\u062A\u0627\u0626\u062C. \u064A\u0631\u062C\u0649 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649.</p>
        </div>
      `)}}function he(i){try{if(!p)return;let e=I(),t=e[e.length-1];p.innerHTML="",p.className="grid-container",p.setAttribute("aria-busy","false");let s=document.createDocumentFragment();if(t&&t.subcategories&&t.subcategories.length>0){let r=T();t.subcategories.forEach(a=>{let o=r[a];if(o){let c=O(o),l=G(o.name,c,!0,null,!0);l.onclick=()=>x(o),s.appendChild(l)}})}if(i.length===0&&(!t||!t.subcategories||t.subcategories.length===0)){let r=L({variant:"grid",icon:"search",title:"\u0644\u0627 \u062A\u0648\u062C\u062F \u0646\u062A\u0627\u0626\u062C",subtitle:"\u062C\u0631\u0651\u0628 \u0627\u0644\u0628\u062D\u062B \u0628\u0643\u0644\u0645\u0627\u062A \u0645\u062E\u062A\u0644\u0641\u0629"});p.appendChild(r);return}i.forEach(r=>{let a=W(r);s.appendChild(a)}),p.appendChild(s)}catch(e){console.error("Error rendering quiz search results:",e)}}async function ue(){let{finalizeAppRender:i}=await import("./navigation-4HEMZPTR.js");i()}function te(){if(!p)return;p.setAttribute("aria-busy","false"),p.innerHTML="";let i="landing-screen-styles";if(!document.getElementById(i)){let u=document.createElement("style");u.id=i,u.textContent=`
      /* \u2500\u2500 Full-viewport page (not a modal \u2014 see header note) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
      .landing-page {
        position: fixed;
        inset: 0;
        z-index: var(--z-overlay, 4000);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        background: var(--color-background, #fafbfc);
        animation: landingFadeIn 0.4s ease both;
      }

      /* Soft directional wash so the page doesn't feel flat \u2014 sits behind
         the particle canvas, in front of the plain background color. */
      .landing-page::before {
        content: "";
        position: absolute;
        inset: 0;
        z-index: 0;
        background:
          radial-gradient(ellipse 900px 600px at 50% -10%, rgba(99,102,241,0.16) 0%, transparent 60%),
          radial-gradient(ellipse 700px 500px at 100% 100%, rgba(139,92,246,0.10) 0%, transparent 55%),
          radial-gradient(ellipse 700px 500px at 0% 100%, rgba(236,72,153,0.08) 0%, transparent 55%);
        pointer-events: none;
      }

      /* \u2500\u2500 Particle canvas \u2014 full-bleed ambient motion \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
      .landing-particles {
        position: absolute;
        inset: 0;
        z-index: 0;
        pointer-events: none;
      }

      /* \u2500\u2500 Content column \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
      .landing-content {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        direction: rtl;
        width: 100%;
        max-width: 640px;
        padding: 0 24px;
      }

      /* \u2500\u2500 Hero mark: bold graduation-cap glyph, not a small emoji \u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
      .landing-hero-mark {
        position: relative;
        width: 96px;
        height: 96px;
        margin-bottom: 32px;
        border-radius: var(--radius-2xl, 24px);
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--gradient-accent);
        box-shadow:
          0 20px 50px -12px rgba(99,102,241,0.45),
          inset 0 1px 0 rgba(255,255,255,0.25);
        animation: landingMarkPop 0.7s 0.1s var(--ease-spring, cubic-bezier(0.34,1.56,0.64,1)) both;
      }
      .landing-hero-mark svg {
        width: 48px;
        height: 48px;
        stroke: #fff;
        fill: none;
        stroke-width: 1.8;
      }

      /* \u2500\u2500 Headline: the one bold visual element \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
      .landing-headline {
        position: relative;
        z-index: 1;
        font-family: "Tajawal", "IBM Plex Sans Arabic", sans-serif;
        font-size: clamp(2rem, 7vw, 3.5rem);
        font-weight: 900;
        line-height: 1.15;
        letter-spacing: -0.02em;
        margin: 0 0 16px;
        color: var(--color-text-primary);
        animation: landingSlideUp 0.5s 0.25s ease both;
      }
      .landing-headline .accent {
        background: var(--gradient-accent);
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
      }

      /* \u2500\u2500 Support line: one sentence, done \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
      .landing-support {
        position: relative;
        z-index: 1;
        font-size: var(--font-size-lg, 1.125rem);
        font-weight: 500;
        color: var(--color-text-secondary);
        line-height: 1.6;
        margin: 0 0 44px;
        max-width: 460px;
        animation: landingSlideUp 0.5s 0.35s ease both;
      }

      /* \u2500\u2500 Actions \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
      .landing-actions {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        width: 100%;
        max-width: 380px;
        animation: landingSlideUp 0.5s 0.45s ease both;
      }

      .landing-btn-primary {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        width: 100%;
        padding: 17px 28px;
        border: none;
        border-radius: var(--radius-lg, 12px);
        font-family: inherit;
        font-size: 1.05rem;
        font-weight: 800;
        color: #fff;
        cursor: pointer;
        background: var(--gradient-accent);
        box-shadow:
          0 10px 30px -6px rgba(99,102,241,0.5),
          inset 0 1px 0 rgba(255,255,255,0.2);
        transition: transform 0.25s var(--ease-spring, cubic-bezier(0.34,1.56,0.64,1)),
                    box-shadow 0.25s ease;
        overflow: hidden;
      }
      .landing-btn-primary:hover {
        transform: scale(1.015);
        box-shadow:
          0 14px 36px -6px rgba(99,102,241,0.6),
          inset 0 1px 0 rgba(255,255,255,0.25);
      }
      .landing-btn-primary:active {
        transform: translateY(0) scale(0.98);
      }
      .landing-btn-primary::after {
        content: "";
        position: absolute;
        top: 0;
        left: -100%;
        width: 60%;
        height: 100%;
        background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.25) 50%, transparent 100%);
        animation: landingBtnShimmer 3.2s 1s ease-in-out infinite;
        pointer-events: none;
      }

      .landing-btn-secondary {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 10px 20px;
        border: none;
        background: transparent;
        font-family: inherit;
        font-size: 0.9rem;
        font-weight: 600;
        color: var(--color-text-tertiary);
        cursor: pointer;
        transition: color 0.2s ease;
      }
      .landing-btn-secondary:hover {
        color: var(--color-text-secondary);
      }

      /* \u2500\u2500 Keyframes \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
      @keyframes landingFadeIn {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      @keyframes landingMarkPop {
        from { opacity: 0; transform: scale(0.7) rotate(-8deg); }
        to   { opacity: 1; transform: scale(1) rotate(0deg); }
      }
      @keyframes landingSlideUp {
        from { opacity: 0; transform: translateY(16px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes landingBtnShimmer {
        0%   { left: -100%; }
        40%  { left: 120%; }
        100% { left: -100%; }
      }

      /* \u2500\u2500 Responsive \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
      @media (max-width: 520px) {
        .landing-hero-mark { width: 76px; height: 76px; margin-bottom: 24px; border-radius: var(--radius-xl, 16px); }
        .landing-hero-mark svg { width: 38px; height: 38px; }
        .landing-support { font-size: 0.95rem; margin-bottom: 36px; }
        .landing-btn-primary { font-size: 0.98rem; padding: 15px 22px; }
      }

      @media (max-height: 640px) {
        .landing-hero-mark { width: 64px; height: 64px; margin-bottom: 18px; }
        .landing-headline { font-size: clamp(1.6rem, 6vw, 2.4rem); margin-bottom: 10px; }
        .landing-support { margin-bottom: 26px; }
      }
    `,document.head.appendChild(u)}let e=document.createElement("div");e.className="landing-page",e.id="landingOverlay",e.setAttribute("role","dialog"),e.setAttribute("aria-modal","true"),e.setAttribute("aria-label","\u0634\u0627\u0634\u0629 \u0627\u0644\u062A\u0631\u062D\u064A\u0628");let t=document.createElement("canvas");t.className="landing-particles",e.appendChild(t);let s=document.createElement("div");s.className="landing-content";let r=document.createElement("div");r.className="landing-hero-mark",r.setAttribute("aria-hidden","true"),r.innerHTML=`
    <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 10 12 5 2 10l10 5 10-5Z" />
      <path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
      <path d="M22 10v6" />
    </svg>`;let a=document.createElement("h1");a.className="landing-headline",a.innerHTML='\u0623\u0647\u0644\u0627\u064B \u0628\u064A\u0643 \u0641\u064A <span class="accent">\u0628\u0635\u0645\u062C\u064A</span>';let o=document.createElement("p");o.className="landing-support",o.textContent="\u0645\u0643\u062A\u0628\u0629 \u0627\u0645\u062A\u062D\u0627\u0646\u0627\u062A \u0645\u062C\u0627\u0646\u064A\u0629 \u0628\u0627\u0644\u0643\u0627\u0645\u0644 \u0644\u0645\u0648\u0627\u062F \u0643\u0644\u064A\u062A\u0643 \u2014 \u0628\u062F\u0648\u0646 \u062A\u0633\u062C\u064A\u0644 \u062F\u062E\u0648\u0644\u060C \u0648\u0628\u062F\u0648\u0646 \u062A\u0639\u0642\u064A\u062F.";let c=document.createElement("div");c.className="landing-actions";let l=document.createElement("button");l.className="landing-btn-primary",l.id="landingStartBtn",l.innerHTML="<span>\u{1F680}</span><span>\u0627\u0628\u062F\u0623 \u0627\u0644\u0622\u0646</span>",l.onclick=()=>{window.location.hash&&sessionStorage.setItem("intended_redirect_hash",window.location.hash),window.location.href="onboarding"};let h=document.createElement("button");h.className="landing-btn-secondary",h.id="landingSkipBtn",h.innerHTML='<span>\u062A\u062E\u0637\u064A</span><span style="font-size:1.1em">\u2190</span>',h.onclick=()=>{localStorage.setItem("first_visit_complete","true"),e.style.transition="opacity 0.35s ease",e.style.opacity="0",setTimeout(()=>{e.remove(),ue()},350)},c.appendChild(l),c.appendChild(h),s.appendChild(r),s.appendChild(a),s.appendChild(o),s.appendChild(c),e.appendChild(s),document.body.appendChild(e),requestAnimationFrame(()=>{de(t)}),l.focus()}function de(i){if(!i||!i.parentElement)return;let e=i.getContext("2d");if(!e)return;let t=()=>{i.width=i.parentElement.clientWidth,i.height=i.parentElement.clientHeight};t(),window.addEventListener("resize",t);let s=i.width*i.height,r=Math.round(Math.min(Math.max(s/14e3,30),90)),a=["rgba(99,102,241,0.55)","rgba(139,92,246,0.50)","rgba(236,72,153,0.45)","rgba(16,185,129,0.45)","rgba(245,158,11,0.40)","rgba(59,130,246,0.45)"],o=Array.from({length:r},()=>({x:Math.random()*i.width,y:Math.random()*i.height,vx:(Math.random()-.5)*.4,vy:(Math.random()-.5)*.3-.15,size:Math.random()*4+2,color:a[Math.floor(Math.random()*a.length)],opacity:Math.random()*.6+.3,rotation:Math.random()*Math.PI*2,rotationSpeed:(Math.random()-.5)*.02,shape:Math.floor(Math.random()*3),pulseOffset:Math.random()*Math.PI*2})),c,l=()=>{if(!i.parentElement){cancelAnimationFrame(c);return}e.clearRect(0,0,i.width,i.height);let u=Date.now()*.001;for(let n of o){n.x+=n.vx,n.y+=n.vy,n.rotation+=n.rotationSpeed,n.x<-10&&(n.x=i.width+10),n.x>i.width+10&&(n.x=-10),n.y<-10&&(n.y=i.height+10),n.y>i.height+10&&(n.y=-10);let d=.8+Math.sin(u*1.5+n.pulseOffset)*.2;e.save(),e.translate(n.x,n.y),e.rotate(n.rotation),e.globalAlpha=n.opacity*d,e.fillStyle=n.color;let f=n.size*d;if(n.shape===0)e.beginPath(),e.arc(0,0,f,0,Math.PI*2),e.fill();else if(n.shape===1)e.beginPath(),e.moveTo(0,-f),e.lineTo(f*.7,0),e.lineTo(0,f),e.lineTo(-f*.7,0),e.closePath(),e.fill();else{e.beginPath();for(let m=0;m<8;m++){let y=m%2===0?f:f*.4,g=m*Math.PI/4;e[m===0?"moveTo":"lineTo"](Math.cos(g)*y,Math.sin(g)*y)}e.closePath(),e.fill()}e.restore()}c=requestAnimationFrame(l)};l();let h=new MutationObserver(()=>{document.getElementById("landingOverlay")||(cancelAnimationFrame(c),window.removeEventListener("resize",t),h.disconnect())});h.observe(document.body,{childList:!0})}function N(i,e){if(!e||!i)return[];for(let[t,s]of Object.entries(e))if(Array.isArray(s.subcategories)&&s.subcategories.includes(i))return[...N(t,e),s];return[]}function re(){let i=window.location.hash.slice(1),e=window.location.pathname;if(e.match(/^\/lesson\/([^/]+)\/?$/)){S([]),D();return}let s=e.match(/^\/course\/([^/]+)((?:\/[^/]+)*)\/?$/);if(s){let l;try{l=decodeURIComponent(s[1])}catch{l=s[1]}let h=s[2].split("/").filter(Boolean).map(d=>{try{return decodeURIComponent(d)}catch{return d}}),u=h.length>0?h:i.split("/").filter(Boolean).map(d=>{try{return decodeURIComponent(d)}catch{return d}}),n=T();if(n){let d=Object.keys(n).find(f=>{let m=n[f];return!m.parent&&z(m.name)===l});if(d){if(u.length===0){S([]),x(n[d]);return}let f=d,m=n[d],y=!0;for(let g of u){let F=(m.subcategories||[]).find(_=>n[_]&&z(n[_].name)===g);if(!F){y=!1;break}f=F,m=n[F]}if(y){let g=N(f,n);S([...g]),x(m);return}S([]),x(n[d]);return}}C();return}let r=e.match(/^\/my-content((?:\/[^/]+)*)\/?$/);if(r){let l=r[1].split("/").filter(Boolean).map(h=>{try{return decodeURIComponent(h)}catch{return h}});if(l.length>0){let h=JSON.parse(B("user_quizzes","[]")),u=[],n=null,d=!0;for(let f of l){let m=h.find(g=>(g.meta?.parentId||null)===n&&(g.meta?.type==="folder"||g.meta?.type==="course")&&z(g.meta?.title||"")===f);if(!m){d=!1;break}let y=m.id||m.meta?.id;u.push({id:y,title:m.meta?.title}),n=y}if(d&&u.length>0){S([]),E(u,u[u.length-1].id),v();return}}S([]),E([],null),v();return}if(!i){C();return}if(i==="my-content"||i==="my-quizzes"){S([]),E([],null),v();return}let o=i.startsWith("my-content/")?"my-content/":i.startsWith("my-quizzes/")?"my-quizzes/":null;if(o){let l=i.slice(o.length).split("/").filter(Boolean).map(h=>{try{return decodeURIComponent(h)}catch{return h}});if(l.length>0){let h=JSON.parse(B("user_quizzes","[]")),u=[],n=null,d=!0;for(let f of l){let m=h.find(g=>(g.meta?.parentId||null)===n&&(g.meta?.type==="folder"||g.meta?.type==="course")&&z(g.meta?.title||"")===f);if(!m){d=!1;break}let y=m.id||m.meta?.id;u.push({id:y,title:m.meta?.title}),n=y}if(d&&u.length>0){S([]),E(u,u[u.length-1].id),v();return}}S([]),E([],null),v();return}let c=T();if(c){let l=i.split("/").filter(Boolean).map(n=>{try{return decodeURIComponent(n)}catch{return n}}),h=null,u=null;for(let[n,d]of Object.entries(c)){let f=n.split("/");if(f.length===l.length&&f.every((m,y)=>z(m)===l[y])){h=n,u=d;break}}if(u){let n=N(h,c);S([...n]),x(u);return}}C()}function se(){try{history.replaceState({view:"initial"},"",window.location.href),w(!0);try{re()}finally{w(!1)}}catch(i){console.error("Error in initApp render phase:",i),C()}}async function Xe(){X();let i=/^#(?:my-content|my-quizzes)(?:\/|$)/.test(window.location.hash)||window.location.pathname.startsWith("/my-content");if(i){w(!0);try{re()}finally{w(!1)}}let e=!0;try{e=!!localStorage.getItem("first_visit_complete")}catch(s){console.error("Error checking first-visit state:",s)}let t=document.getElementById("contentArea");t&&t.setAttribute("aria-busy","true");try{let s=await H();k(s.categoryTree),R(),s.fromCache&&(console.warn("[initApp] Supabase unreachable \u2014 showing last-good catalog from local snapshot."),A("\u0648\u0636\u0639 \u0639\u062F\u0645 \u0627\u0644\u0627\u062A\u0635\u0627\u0644","\u062A\u0639\u0630\u0651\u0631 \u0627\u0644\u0648\u0635\u0648\u0644 \u0644\u0644\u062E\u0627\u062F\u0645 \u062D\u0627\u0644\u064A\u0627\u064B \u2014 \u064A\u062A\u0645 \u0639\u0631\u0636 \u0627\u0644\u0645\u0648\u0627\u062F \u0645\u0646 \u0646\u0633\u062E\u0629 \u0645\u062D\u0641\u0648\u0638\u0629 \u0645\u0633\u0628\u0642\u0627\u064B.","warning"))}catch(s){console.error("Failed to load quiz manifest:",s),k(null)}if(!i){if(!e){te();return}se()}}async function et(){try{let i=await H();k(i.categoryTree),R()}catch(i){console.error("Retry failed to load quiz manifest:",i),k(null)}se()}export{re as a,se as b,Xe as c,et as d};

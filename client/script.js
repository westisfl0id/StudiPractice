const searchBtn = document.getElementById('searchBtn');
const keywordInput = document.getElementById('keyword');
const keywordList = document.getElementById('keywords');
const urlList = document.getElementById('urlList');
const loader = document.getElementById('loader');
const downloadedList = document.getElementById('downloadedList');
const alertBox = document.getElementById('alertBox');

let cachedKeywords = [];

const dbPromise = new Promise((resolve, reject) => {
  const request = indexedDB.open('keyword-downloader', 2);
  request.onupgradeneeded = event => {
    const db = event.target.result;
    if (!db.objectStoreNames.contains('files')) {
      db.createObjectStore('files', { keyPath: 'url' });
    }
  };
  request.onsuccess = event => resolve(event.target.result);
  request.onerror = event => reject(event.target.error);
});

async function loadKeywords() {
  try {
    const res = await fetch('/api/all-keywords');
    if (!res.ok) throw new Error('Не удалось загрузить ключевые слова.');
    const { keywords } = await res.json();
    cachedKeywords = keywords;
    keywordList.innerHTML = '';
    keywords.forEach(k => {
      const option = document.createElement('option');
      option.value = k;
      keywordList.appendChild(option);
    });
  } catch (err) {
    showAlert(err.message);
  }
}

searchBtn.addEventListener('click', async () => {
  const keyword = keywordInput.value.trim();
  if (!keyword) { showAlert('Введите ключевое слово!'); return; }
  loader.classList.remove('d-none');
  urlList.innerHTML = '';
  alertBox.classList.add('d-none');
  try {
    const res = await fetch('/api/keywords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword })
    });
    loader.classList.add('d-none');
    if (!res.ok) {
      const { error } = await res.json();
      throw new Error(error || 'Нет ссылок для этого ключа.');
    }
    const { urls } = await res.json();
    displayURLs(urls);
  } catch (err) {
    loader.classList.add('d-none');
    showAlert(err.message);
  }
});

function getFileType(url) {
  const ext = url.split('.').pop().toLowerCase();
  if (['mp3','wav','ogg'].includes(ext)) return 'audio';
  if (['mp4','mov','avi'].includes(ext)) return 'video';
  if (ext === 'pdf') return 'pdf';
  if (['jpg','jpeg','png','gif','webp'].includes(ext)) return 'image';
  return 'other';
}

function displayURLs(urls) {
  urlList.innerHTML = `
    <div class="mb-3">
      <label for="urlSort" class="form-label">Сортировать по:</label>
      <select id="urlSort" class="form-select w-auto d-inline-block">
        <option value="name-asc">Имени (А-Я)</option>
        <option value="name-desc">Имени (Я-А)</option>
        <option value="type-asc">Типу (А-Я)</option>
        <option value="type-desc">Типу (Я-А)</option>
      </select>
    </div>
  `;
  const sortSelect = document.getElementById('urlSort');
  sortSelect.addEventListener('change', () => displayURLs(urls));

  let sorted = [...urls];
  const mode = sortSelect.value;
  if (mode === 'name-asc') sorted.sort((a,b) => a.localeCompare(b));
  if (mode === 'name-desc') sorted.sort((a,b) => b.localeCompare(a));
  if (mode === 'type-asc') sorted.sort((a,b) => getFileType(a).localeCompare(getFileType(b)));
  if (mode === 'type-desc') sorted.sort((a,b) => getFileType(b).localeCompare(getFileType(a)));

  // Создание карточек
  sorted.forEach(url => {
    const type = getFileType(url);
    const iconMap = { audio:'music-note', video:'camera-video', pdf:'file-earmark-pdf', image:'image' };
    const icon = iconMap[type] || 'file-earmark';
    const cardClass = `card-${type}`;

    const col = document.createElement('div');
    col.className = 'col-md-6 mb-3';
    col.innerHTML = `
      <div class="card shadow-sm ${cardClass}">
        <div class="card-body d-flex align-items-center">
          <i class="bi bi-${icon}"></i>
          <h6 class="card-title text-truncate ms-2">${url}</h6>
          <button class="btn btn-sm btn-download ms-auto">
            <i class="bi bi-cloud-arrow-down"></i> Скачать
          </button>
        </div>
        <div class="progress-container mt-2 d-none p-3 bg-light rounded-bottom">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <div><span class="download-status fw-bold">Подготовка...</span> <span class="file-size text-muted ms-2"></span></div>
            <div class="download-percentage fw-bold">0%</div>
          </div>
          <div class="progress"><div class="progress-bar" role="progressbar"></div></div>
          <div class="d-flex justify-content-between mt-2">
            <small class="downloaded-size text-primary">0 MB</small>
            <small class="total-size text-muted">0 MB</small>
          </div>
        </div>
      </div>
    `;
    const btn = col.querySelector('button');
    const container = col.querySelector('.progress-container');
    const bar = col.querySelector('.progress-bar');
    const statusElem = col.querySelector('.download-status');
    const fsElem = col.querySelector('.file-size');
    const percElem = col.querySelector('.download-percentage');
    const dlElem = col.querySelector('.downloaded-size');
    const totElem = col.querySelector('.total-size');

    btn.addEventListener('click', () => downloadFile(url, container, bar, statusElem, percElem, dlElem, totElem, fsElem));

    urlList.appendChild(col);
  });
}

async function saveToIndexedDB(fileData) {
  const db = await dbPromise;
  const tx = db.transaction('files', 'readwrite');
  const store = tx.objectStore('files');
  await new Promise((res, rej) => {
    const req = store.put(fileData);
    req.onsuccess = res;
    req.onerror = () => rej(req.error);
  });
  await tx.complete;
}

async function downloadFile(url, container, bar, statusElem, percElem, dlElem, totElem, fsElem) {
  try {
    // UI
    container.classList.remove('d-none');
    bar.style.width = '0%'; statusElem.textContent = 'Подготовка...'; percElem.textContent = '0%';
    dlElem.textContent = '0 MB'; totElem.textContent = '0 MB'; fsElem.textContent = '';

    const response = await fetch(`/api/download?url=${encodeURIComponent(url)}`);
    if (!response.ok) throw new Error(`Сервер: ${response.status}`);

    const len = response.headers.get('content-length');
    const total = len ? parseInt(len,10) : null;
    const fmt = b => b<1024?b+' B':b<1048576?(b/1024).toFixed(1)+' KB':(b/1048576).toFixed(1)+' MB';
    if (total) { fsElem.textContent = `(${fmt(total)})`; totElem.textContent = fmt(total); }

    const reader = response.body.getReader();
    let recv=0, chunks=[];
    statusElem.textContent = 'Загрузка...';
    while(true) {
      const {done, value} = await reader.read(); if(done) break;
      chunks.push(value); recv+=value.length;
      if (total) {
        const p = Math.round(recv/total*100);
        bar.style.width = `${p}%`; percElem.textContent = `${p}%`; dlElem.textContent = fmt(recv);
      } else {
        dlElem.textContent = fmt(recv); bar.style.width = `${Math.min(95, recv/5000000*100)}%`;
      }
    }

    const blob = new Blob(chunks);
    const fileName = url.split('/').pop();
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const size = blob.size;

    let fileData = { url, fileName, contentType, size, lastModified: new Date().toISOString() };

    if (size <= 1048576) {
      const reader2 = new FileReader();
      reader2.readAsDataURL(blob);
      const dataUrl = await new Promise(res => reader2.onloadend = () => res(reader2.result));
      fileData = { ...fileData, data: dataUrl, storage: 'localStorage' };
      localStorage.setItem(`file_${btoa(url)}`, JSON.stringify(fileData));
    } else {
      fileData = { ...fileData, blob, storage: 'indexedDB' };
      await saveToIndexedDB(fileData);
    }

    statusElem.textContent = 'Сохранено!'; statusElem.classList.add('text-success');
    updateDownloadedList();
  } catch(err) {
    console.error('Ошибка:', err);
    statusElem.textContent = 'Ошибка: ' + err.message;
    statusElem.classList.add('text-danger');
  }
}

// Отображение сохраненных файлов
async function updateDownloadedList() {
  downloadedList.innerHTML = `
    <div class="mb-3">
      <label for="dlSort" class="form-label">Сортировать по:</label>
      <select id="dlSort" class="form-select w-auto d-inline-block">
        <option value="name-asc">Имени (А-Я)</option>
        <option value="name-desc">Имени (Я-А)</option>
        <option value="date-asc">Дате (старые)</option>
        <option value="date-desc">Дате (новые)</option>
      </select>
    </div>
  `;
  const dlSort = document.getElementById('dlSort');
  dlSort.addEventListener('change', updateDownloadedList);

  // Считываем LS
  const lsFiles = [];
  for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k.startsWith('file_')){
    try { const f=JSON.parse(localStorage.getItem(k)); f.storage='localStorage'; lsFiles.push(f);}catch{} }
  }

  // Считываем IDB
  let idbFiles = [];
  try {
    const db = await dbPromise;
    const tx = db.transaction('files','readonly');
    const store = tx.objectStore('files');
    idbFiles = await new Promise((res,rej)=>{
      const r = store.getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
    });
    idbFiles.forEach(f=>f.storage='indexedDB');
  } catch {}

  let all = [...lsFiles, ...idbFiles];
  const mode = dlSort.value;
  if(mode==='name-asc') all.sort((a,b)=>a.fileName.localeCompare(b.fileName));
  if(mode==='name-desc') all.sort((a,b)=>b.fileName.localeCompare(a.fileName));
  if(mode==='date-asc') all.sort((a,b)=>new Date(a.lastModified)-new Date(b.lastModified));
  if(mode==='date-desc') all.sort((a,b)=>new Date(b.lastModified)-new Date(a.lastModified));

  if(!all.length){ downloadedList.innerHTML += '<p class="text-center text-muted">Нет файлов</p>'; return; }

  all.forEach(file=>{
    const col=document.createElement('div'); col.className='col-md-6 mb-3';
    const iconMap={image:'image',audio:'music-note',video:'camera-video',pdf:'file-earmark-pdf'};
    const extIcon=iconMap[getFileType(file.url)]||'file-earmark';
    const badge=file.storage==='localStorage'?'<span class="badge bg-info ms-2">LS</span>':'<span class="badge bg-warning ms-2">IDB</span>';
    const fmt=b=>b<1024?b+'B':b<1048576?(b/1024).toFixed(1)+'KB':(b/1048576).toFixed(1)+'MB';
    col.innerHTML=`
      <div class="card">
        <div class="card-body">
          <div class="d-flex align-items-center mb-2">
            <i class="bi bi-${extIcon} fs-4 me-3"></i>
            <div>
              <h6 class="mb-0">${file.fileName} ${badge}</h6>
              <small class="text-muted">${fmt(file.size)}</small>
            </div>
          </div>
          <div class="d-flex justify-content-between">
            <button class="btn btn-sm btn-outline-primary view-btn"><i class="bi bi-eye"></i></button>
            <button class="btn btn-sm btn-outline-danger del-btn"><i class="bi bi-trash"></i></button>
          </div>
        </div>
      </div>
    `;
    col.querySelector('.view-btn').onclick=()=>viewFile(file);
    col.querySelector('.del-btn').onclick=()=>deleteFile(file);
    downloadedList.appendChild(col);
  });
}

// Просмотр файла
async function viewFile(file) {
  let blob;
  if(file.storage==='localStorage'){
    const base64 = file.data.split(',')[1];
    const raw = atob(base64); const arr=[];
    for(let i=0;i<raw.length;i+=1024){const slice=raw.slice(i,i+1024), nums=slice.split('').map(c=>c.charCodeAt(0));arr.push(new Uint8Array(nums));}
    blob=new Blob(arr,{type:file.contentType});
  } else {
    const db=await dbPromise; const tx=db.transaction('files','readonly'); const store=tx.objectStore('files');
    const rec=await new Promise((res,rej)=>{const r=store.get(file.url);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
    blob=rec.blob;
  }
  const u=URL.createObjectURL(blob); const w=window.open();
  if(file.contentType.startsWith('image/')) w.document.write(`<img src="${u}" style="max-width:90%;max-height:90%;"/>`);
  else if(file.contentType.startsWith('audio/')) w.document.write(`<audio controls src="${u}"></audio>`);
  else if(file.contentType.startsWith('video/')) w.document.write(`<video controls src="${u}" style="max-width:100%"></video>`);
  else w.location.href=u;
}

// Удаление файла
async function deleteFile(file) {
  if(!confirm('Удалить файл?')) return;
  if(file.storage==='localStorage') localStorage.removeItem(`file_${btoa(file.url)}`);
  else {const db=await dbPromise;const tx=db.transaction('files','readwrite');tx.objectStore('files').delete(file.url);await tx.complete;}
  updateDownloadedList();
}

function showAlert(msg) {
  alertBox.textContent=msg; alertBox.className='alert alert-danger';
  setTimeout(()=>alertBox.classList.add('d-none'),5000);
}

window.onload = () => {
  loadKeywords();
  updateDownloadedList();
};

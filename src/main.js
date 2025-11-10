const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
// const { spawn } = require('child_process'); // Более не используется
const { scrapeProfiles } = require('./profileScraper'); // JS-функция для парсинга профилей (использует partition 'persist:fb')

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false, // Нужно для работы с Facebook
      webviewTag: true // Включаем поддержку webview
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Открываем DevTools в режиме разработки
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Обработка сообщений от renderer процесса
ipcMain.handle('save-csv', async (event, payload) => {
  try {
    const { data, options } = typeof payload === 'string'
      ? { data: payload, options: {} }
      : (payload || {});

    if (typeof data !== 'string') {
      throw new Error('Неверный формат данных для экспорта CSV');
    }

    const defaultPath = options?.defaultPath ?? `group-members-${new Date().toISOString().split('T')[0]}.csv`;
    const filters = options?.filters ?? [{ name: 'CSV файлы', extensions: ['csv'] }];

    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath,
      filters
    });

    if (filePath) {
      fs.writeFileSync(filePath, data, 'utf-8');
      return { success: true, path: filePath };
    }

    return { success: false, cancelled: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Экспорт в Excel
ipcMain.handle('save-excel', async (event, payload) => {
  try {
    const { rows, options } = Array.isArray(payload)
      ? { rows: payload, options: {} }
      : (payload || {});

    if (!Array.isArray(rows)) {
      throw new Error('Неверный формат данных для экспорта Excel');
    }

    const defaultPath = options?.defaultPath ?? `group-members-${new Date().toISOString().split('T')[0]}.xlsx`;
    const filters = options?.filters ?? [{ name: 'Excel файлы', extensions: ['xlsx'] }];

    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath,
      filters
    });

    if (filePath) {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, 'Data');
      XLSX.writeFile(wb, filePath);
      return { success: true, path: filePath };
    }

    return { success: false, cancelled: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-json', async (event, payload) => {
  try {
    const { data, options } = typeof payload === 'string'
      ? { data: payload, options: {} }
      : (payload || {});

    if (typeof data !== 'string') {
      throw new Error('Неверный формат данных для экспорта JSON');
    }

    const defaultPath = options?.defaultPath ?? `fb-groups-${new Date().toISOString().split('T')[0]}.json`;
    const filters = options?.filters ?? [{ name: 'JSON файлы', extensions: ['json'] }];

    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath,
      filters
    });

    if (filePath) {
      fs.writeFileSync(filePath, data, 'utf-8');
      return { success: true, path: filePath };
    }

    return { success: false, cancelled: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Выход из аккаунта Facebook (очистка сессии)
ipcMain.handle('logout', async () => {
  try {
    const fbSession = session.fromPartition('persist:fb');
    await fbSession.clearStorageData();
    await fbSession.clearCache();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-external', async (event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    console.error('Ошибка открытия ссылки:', error);
    return { success: false, error: error.message };
  }
});

// Запуск Python-скрипта для парсинга профилей по ссылкам
ipcMain.handle('scrape-links', async () => {
  try {
    // Шаг 1. Запрашиваем файл со ссылками у пользователя
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Text files', extensions: ['txt', 'csv'] }]
    });

    if (canceled || !filePaths || !filePaths.length) {
      return { success: false, cancelled: true };
    }

    const filePath = filePaths[0];
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const links = fileContent.split(/\r?\n/).map(l => l.trim()).filter(l => l && l.includes('facebook.com'));

    if (links.length === 0) {
      return { success: false, error: 'Файл не содержит валидных ссылок Facebook' };
    }

    // Шаг 2. Запускаем скрытый парсер профилей
    const results = await scrapeProfiles(links);

    return { success: true, data: results };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-script', (event, scriptType) => {
  if (scriptType === 'group-search') {
    try {
      const scriptPath = path.join(__dirname, 'scripts', 'groupSearch.js');
      return fs.readFileSync(scriptPath, 'utf-8');
    } catch (error) {
      console.error('Ошибка загрузки скрипта парсинга групп:', error);
      throw error;
    }
  }

  // Возвращаем скрипт с исправленным позиционированием кнопки
  return `
function exportToCsv(e,t){for(var n="",o=0;o<t.length;o++)n+=function(e){for(var t="",n=0;n<e.length;n++){var o=null===e[n]||void 0===e[n]?"":e[n].toString(),o=(o=e[n]instanceof Date?e[n].toLocaleString():o).replace(/"/g,'""');0<n&&(t+=","),t+=o=0<=o.search(/("|,|\\n)/g)?'"'+o+'"':o}return t+"\\n"}(t[o]);var r=new Blob([n],{type:"text/csv;charset=utf-8;"}),i=document.createElement("a");void 0!==i.download&&(r=URL.createObjectURL(r),i.setAttribute("href",r),i.setAttribute("download",e),document.body.appendChild(i),i.click(),document.body.removeChild(i))}

/* Загрузка библиотеки XLSX при необходимости */
if (!window.XLSX) {
  var s=document.createElement('script');
  s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  document.head.appendChild(s);
}

function exportToXlsx(filename, rows){
  if (!window.XLSX) {
    alert('Загрузка библиотеки для Excel... попробуйте еще раз через пару секунд');
    return;
  }
  var wb = XLSX.utils.book_new();
  var ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  var wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  var blob = new Blob([wbout], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  var link=document.createElement('a');
  link.href=URL.createObjectURL(blob);
  link.download=filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function buildCTABtn(){
  // Проверяем, существует ли уже кнопка
  var existingBtn = document.getElementById("fb-group-scraper-download-btn");
  if (existingBtn) {
    // Обновляем счетчик в существующей кнопке
    var counter = document.getElementById("fb-group-scraper-number-tracker");
    if (counter && window.members_list) {
      counter.textContent = (window.members_list.length - 1).toString();
    }
    return existingBtn;
  }

  var e=document.createElement("div"),t=(e.setAttribute("style",[
    "position: fixed;",
    "top: 80px;",
    "left: 50%;", 
    "transform: translateX(-50%);",
    "z-index: 99999;",
    "width: 100%;",
    "height: 100%;",
    "pointer-events: none;"
  ].join("")),document.createElement("div"));
  
  t.setAttribute("id", "fb-group-scraper-download-btn");
  t.setAttribute("style",[
    "position: absolute;",
    "top: 0;",
    "left: 50%;",
    "transform: translateX(-50%);",
    "color: white;",
    "min-width: 200px;",
    "background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);",
    "border-radius: 12px;",
    "padding: 15px 25px;",
    "cursor: pointer;",
    "font-weight: 600;",
    "font-size: 16px;",
    "display: inline-flex;",
    "pointer-events: auto;",
    "height: auto;",
    "align-items: center;",
    "justify-content: center;",
    "box-shadow: 0 8px 32px rgba(0,0,0,0.3);",
    "border: 2px solid rgba(255,255,255,0.2);",
    "backdrop-filter: blur(10px);"
  ].join(""));
  
  var n=document.createTextNode("📥 Скачать "),o=document.createElement("span"),r=(o.setAttribute("id","fb-group-scraper-number-tracker"),o.setAttribute("style","font-weight:700;color:#FFD700;margin:0 5px;"),o.textContent=(window.members_list ? (window.members_list.length - 1).toString() : "0"),document.createTextNode(" участников"));
  var x=document.createElement("div");
  x.setAttribute("style", t.getAttribute("style").replace('#4CAF50','#2196F3').replace('#45a049','#1976D2'));
  x.setAttribute("id","fb-group-scraper-download-btn-xlsx");
  x.style.display="none";

  var xText=document.createTextNode("📊 Excel ");
  var xCount=o.cloneNode(true);
  var xTail=document.createTextNode(" участников");

  x.appendChild(xText);
  x.appendChild(xCount);
  x.appendChild(xTail);

  x.addEventListener("click",function(){var e=(new Date).toISOString();exportToXlsx("groupMemberExport-".concat(e,".xlsx"),window.members_list)});
  
  return t.appendChild(n),t.appendChild(o),t.appendChild(r),t.addEventListener("click",function(){var e=(new Date).toISOString();exportToCsv("groupMemberExport-".concat(e,".csv"),window.members_list)}),e.appendChild(t),e.appendChild(x),document.body.appendChild(e),e
}

function processResponse(e){var t,n;if(null!==(t=null==e?void 0:e.data)&&void 0!==t&&t.group)o=e.data.group;else{if("Group"!==(null===(t=null===(t=null==e?void 0:e.data)||void 0===t?void 0:t.node)||void 0===t?void 0:t.__typename))return;o=e.data.node}if(null!==(t=null==o?void 0:o.new_members)&&void 0!==t&&t.edges)n=o.new_members.edges;else if(null!==(e=null==o?void 0:o.new_forum_members)&&void 0!==e&&e.edges)n=o.new_forum_members.edges;else{if(null===(t=null==o?void 0:o.search_results)||void 0===t||!t.edges)return;n=o.search_results.edges}var e=n.map(function(e){var t=e.node,n=t.id,o=t.name,r=t.bio_text,i=t.url,s=t.profile_picture,t=t.__isProfile,d=(null===(d=null==e?void 0:e.join_status_text)||void 0===d?void 0:d.text)||(null===(d=null===(d=null==e?void 0:e.membership)||void 0===d?void 0:d.join_status_text)||void 0===d?void 0:d.text),e=null===(e=e.node.group_membership)||void 0===e?void 0:e.associated_group.id;return[n,o,i,(null==r?void 0:r.text)||"",(null==s?void 0:s.uri)||"",e,d||"",t]});window.__fbExistingIds=window.__fbExistingIds||new Set();var newMembers=e.filter(function(member){if(window.__fbExistingIds.has(member[0])){return false}window.__fbExistingIds.add(member[0]);return true});var o=((t=window.members_list).push.apply(t,newMembers),document.getElementById("fb-group-scraper-number-tracker"));o&&(o.textContent=(window.members_list.length-1).toString())}

function parseResponse(e){var n=[];try{n.push(JSON.parse(e))}catch(t){var o=e.split("\\n");if(o.length<=1)return void console.error("Fail to parse API response",t);for(var r=0;r<o.length;r++){var i=o[r];try{n.push(JSON.parse(i))}catch(e){console.error("Fail to parse API response",t)}}}for(var t=0;t<n.length;t++)processResponse(n[t])}

function main(){buildCTABtn();var counter=document.getElementById("fb-group-scraper-number-tracker");if(counter&&window.members_list){counter.textContent=(window.members_list.length-1).toString()}if(!window.__fbScraperInitialized){window.__fbScraperInitialized=true;var e=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.send=function(){this.addEventListener("readystatechange",function(){this.responseURL.includes("/api/graphql/")&&4===this.readyState&&parseResponse(this.responseText)},!1),e.apply(this,arguments)}}}

window.members_list=window.members_list||[["Profile Id","Full Name","ProfileLink","Bio","Image Src","Groupe Id","Group Joining Text","Profile Type"]],main();

/* Auto-scroll to load more members with stop button */
(function(){
  try {
    var maxIdleIterations = 8;
    var idleIterations = 0;
    var lastScrollHeight = 0;
    var totalScrollSteps = 0;
    var scrollStep = Math.max(400, Math.floor(window.innerHeight * 0.8));
    var scrollIntervalMs = 650;
    var maxScrollSteps = 2000;
    var isScrollingStopped = false;

    // Create stop button
    function createStopButton() {
      if (document.getElementById('fb-scraper-stop-btn')) return;
      
      var stopBtn = document.createElement('div');
      stopBtn.id = 'fb-scraper-stop-btn';
      stopBtn.innerHTML = '⏹️ Остановить скролл';
      stopBtn.style.cssText = [
        'position: fixed',
        'top: 120px',
        'right: 20px',
        'z-index: 99999',
        'background: linear-gradient(135deg, #f44336 0%, #d32f2f 100%)',
        'color: white',
        'padding: 12px 20px',
        'border-radius: 8px',
        'cursor: pointer',
        'font-weight: 600',
        'font-size: 14px',
        'box-shadow: 0 4px 15px rgba(244, 67, 54, 0.3)',
        'border: none',
        'transition: all 0.3s ease'
      ].join(';');
      
      stopBtn.addEventListener('click', function() {
        isScrollingStopped = true;
        clearInterval(window.__fbAutoScrollTimer);
        stopBtn.innerHTML = '✅ Скролл остановлен';
        stopBtn.style.background = 'linear-gradient(135deg, #4CAF50 0%, #45a049 100%)';
        setTimeout(function() {
          if (stopBtn.parentNode) stopBtn.parentNode.removeChild(stopBtn);
        }, 2000);
        console.log('[FB Scraper] Auto-scroll stopped by user');
      });
      
      stopBtn.addEventListener('mouseenter', function() {
        if (!isScrollingStopped) {
          stopBtn.style.background = 'linear-gradient(135deg, #e53935 0%, #c62828 100%)';
          stopBtn.style.transform = 'translateY(-2px)';
        }
      });
      
      stopBtn.addEventListener('mouseleave', function() {
        if (!isScrollingStopped) {
          stopBtn.style.background = 'linear-gradient(135deg, #f44336 0%, #d32f2f 100%)';
          stopBtn.style.transform = 'translateY(0)';
        }
      });
      
      document.body.appendChild(stopBtn);
    }

    createStopButton();

    if (window.__fbAutoScrollTimer) clearInterval(window.__fbAutoScrollTimer);
    window.__fbAutoScrollTimer = setInterval(function(){
      if (isScrollingStopped) {
        clearInterval(window.__fbAutoScrollTimer);
        return;
      }
      
      var currentHeight = document.body.scrollHeight;
      if (currentHeight === lastScrollHeight) idleIterations++; else idleIterations = 0;
      lastScrollHeight = currentHeight;

      window.scrollBy({ top: scrollStep, left: 0, behavior: 'smooth' });
      totalScrollSteps++;

      if (idleIterations >= maxIdleIterations || totalScrollSteps >= maxScrollSteps) {
        clearInterval(window.__fbAutoScrollTimer);
        var stopBtn = document.getElementById('fb-scraper-stop-btn');
        if (stopBtn) {
          stopBtn.innerHTML = '✅ Скролл завершен';
          stopBtn.style.background = 'linear-gradient(135deg, #4CAF50 0%, #45a049 100%)';
          setTimeout(function() {
            if (stopBtn.parentNode) stopBtn.parentNode.removeChild(stopBtn);
          }, 3000);
        }
        console.log('[FB Scraper] Auto-scroll complete');
      }
    }, scrollIntervalMs);
  } catch (e) {
    console.log('[FB Scraper] Auto-scroll error', e);
  }
})();

// Добавляем интеграцию с Electron
window.electronAPI && window.electronAPI.onScriptReady && window.electronAPI.onScriptReady();
`;
});

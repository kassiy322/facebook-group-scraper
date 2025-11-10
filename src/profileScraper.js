const { BrowserWindow } = require('electron');

// Простая задержка
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Функция для создания случайной задержки
const humanDelay = (min = 1000, max = 3000) => {
  const randomMs = Math.random() * (max - min) + min;
  return delay(randomMs);
};

// Helper to wait for a selector to appear (in the page context)
function waitForSelector(webContents, selector, timeout = 15000) {
  const expr = `new Promise((res) => {
    const check = () => {
      const element = document.querySelector('${selector.replace(/'/g,"\\'")}');
      if (element) {
        res(true);
      } else if (Date.now() - start > ${timeout}) {
        res(false);
      } else {
        setTimeout(check, 500);
      }
    };
    const start = Date.now();
    check();
  })`;
  return webContents.executeJavaScript(expr, true);
}

// JS-код, который выполняется в контексте страницы профиля Facebook и возвращает необходимые данные.
const extractionScript = `(() => {
  function cleanFacebookUrl(url) {
    try {
      // Если это Facebook редирект
      if (url.includes('l.facebook.com/l.php')) {
        const urlObj = new URL(url);
        const realUrl = urlObj.searchParams.get('u');
        if (realUrl) {
          // Убираем fbclid параметр
          return realUrl.split('?fbclid=')[0].split('&fbclid=')[0];
        }
      }
      
      // Убираем fbclid из обычных ссылок
      return url.replace(/\\?fbclid=[^&]+/, '').replace(/&fbclid=[^&]+/, '');
    } catch (e) {
      return url;
    }
  }

  function isSocialLink(url) {
    const domains = [
      'instagram.com', 'tiktok.com', 'vk.com', 'ok.ru', 
      'telegram.org', 't.me', 'youtube.com', 'twitter.com',
      'linkedin.com', 'whatsapp.com', 'viber.com'
    ];
    return domains.some(domain => url.toLowerCase().includes(domain));
  }

  // Сбор ссылок с расширенными селекторами
  const linkSelectors = [
    'a[href*="l.facebook.com/l.php"]',  // Редирект ссылки
    'a[href*="instagram.com"]',
    'a[href*="tiktok.com"]',
    'a[href*="vk.com"]',
    'a[href*="ok.ru"]',
    'a[href*="t.me"]',
    'a[href*="telegram"]',
    'a[href*="youtube.com"]',
    'a[href*="twitter.com"]',
    'a[href*="linkedin.com"]',
    'a.x1i10hfl.xjbqb8w.x1ejq31n.x18oe1m7.x1sy0etr.xstzfhl.x972fbf.x10w94by.x1qhh985.x14e42zd.x9f619.x1ypdohk.xt0psk2.xe8uvvx.xdj266r.x14z9mp.xat24cr.x1lziwak.xexx8yu.xyri2b.x18d9i69.x1c1uobl.x16tdsg8.x1hl2dhg.xggy1nq.x1a2a7pz.xkrqix3.x1sur9pj.x1qq9wsj.x1s688f'
  ];

  const allElements = [];
  linkSelectors.forEach(selector => {
    try {
      const elements = Array.from(document.querySelectorAll(selector));
      allElements.push(...elements);
    } catch (e) {
      // Игнорируем ошибки селекторов
    }
  });

  // Убираем дубликаты
  const uniqueElements = [];
  const seenHrefs = new Set();

  allElements.forEach(el => {
    const href = el.getAttribute('href');
    if (href && !seenHrefs.has(href)) {
      seenHrefs.add(href);
      uniqueElements.push(el);
    }
  });

  const linksData = [];
  uniqueElements.forEach(el => {
    try {
      let text = el.textContent ? el.textContent.trim() : '';
      const hrefRaw = el.getAttribute('href');
      
      if (!hrefRaw) return;
      
      // Фильтруем нежелательные ссылки
      const lower = hrefRaw.toLowerCase();
      const excludePatterns = ['recover', 'password', 'login', 'signup', 'facebook.com/privacy', 'facebook.com/help'];
      if (excludePatterns.some(pattern => lower.includes(pattern))) return;
      
      const href = cleanFacebookUrl(hrefRaw);
      
      // Проверяем, что это внешняя ссылка или социальная сеть
      if (isSocialLink(href) || (!href.includes('facebook.com') && href.startsWith('http'))) {
        // Если текста нет, используем домен
        if (!text || text.length < 3) {
          try {
            const domain = new URL(href).hostname.replace('www.', '');
            text = domain;
          } catch (e) {
            text = 'Ссылка';
          }
        }
        
        linksData.push(text + ' | ' + href);
      }
    } catch (e) {
      // Игнорируем ошибки отдельных элементов
    }
  });

  // Убираем дубликаты по URL
  const uniqueLinks = [];
  const seenUrls = new Set();
  linksData.forEach(linkData => {
    const url = linkData.split(' | ').pop();
    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      uniqueLinks.push(linkData);
    }
  });

  const allLinks = uniqueLinks.length > 0 ? uniqueLinks.join(' --- ') : 'Ссылки не найдены';

  // Извлечение основной информации профиля - ищем разные варианты контейнеров
  const targetDivSelectors = [
    'div.xieb3on',
    'div[data-pagelet^="ProfileTilesFeed_"]',
    'div[data-pagelet="ProfileApp"]',
    'div[data-testid="profile_header_info"]'
  ];
  
  let targetDiv = null;
  for (const selector of targetDivSelectors) {
    targetDiv = document.querySelector(selector);
    if (targetDiv) break;
  }
  
  let formattedProfile = 'Не найдено';
  if (targetDiv) {
    try {
      const lines = targetDiv.innerText
        .replace(/\\u200b/g, '')  // Убираем zero-width space
        .split('\\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
      
      // Ищем индекс "Актуальное" для обрезки
      const actualIndex = lines.findIndex(line => line.includes('Актуальное'));
      const profileInfo = actualIndex !== -1 ? lines.slice(0, actualIndex) : lines;
      
      if (profileInfo.length > 0) {
        formattedProfile = profileInfo.join('\\n');
      }
    } catch (e) {
      console.log('Error extracting profile data:', e);
    }
  }

  // Извлечение имени - расширенный поиск
  const nameSelectors = [
    'h1.html-h1.xdj266r.x14z9mp.xat24cr.x1lziwak.xexx8yu.xyri2b.x18d9i69.x1c1uobl.x1vvkbs.x1heor9g.x1qlqyl8.x1pd3egz.x1a2a7pz',
    'h1[data-testid="profile_header_name"]',
    'h1',
    'h2[data-testid="profile_header_name"]',
    '[data-testid="profile_header_name"]'
  ];
  
  let name = 'Не найдено';
  for (const selector of nameSelectors) {
    const nameEl = document.querySelector(selector);
    if (nameEl && nameEl.textContent.trim()) {
      name = nameEl.textContent.trim().replace(/\\u00a0/g, ' ');
      break;
    }
  }

  return { 
    formattedProfile: formattedProfile || 'Не найдено', 
    name, 
    links: allLinks 
  };
})();`;

/**
 * Парсит список ссылок профилей Facebook, возвращая массив строк:
 *  [url, name, full_profile, links]
 */
async function scrapeProfiles(links, onProgress = () => {}) {
  console.log(`Starting profile scraping for ${links.length} links`);
  
  const win = new BrowserWindow({
    show: false, // Скрытое окно для лучшей производительности
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: false,
      partition: 'persist:fb', // Используем сохраненную сессию Facebook
      webSecurity: false
    }
  });

  // Настраиваем user agent для лучшей совместимости
  await win.webContents.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  );

  const results = [];
  
  try {
    for (let i = 0; i < links.length; i++) {
      const url = links[i];
      console.log(`[${i + 1}/${links.length}] Processing: ${url}`);
      
      try {
        // Переходим к профилю
        await win.loadURL(url);
        
        // Ждем полной загрузки страницы
        await win.webContents.executeJavaScript(
          'document.readyState === "complete" ? true : new Promise(res => window.addEventListener("load", () => res(true)))',
          true
        );
        
        // Дополнительная задержка для рендеринга DOM
        await humanDelay(3000, 5000);

        // Проверяем, не перекинуло ли нас на страницу логина или блокировки
        const currentUrl = win.webContents.getURL();
        if (/facebook\.com\/(login|checkpoint)/i.test(currentUrl)) {
          throw new Error('Требуется авторизация или верификация в Facebook');
        }

        // Ждем появления основного контента страницы
        const hasContent = await waitForSelector(win.webContents, 'h1, [data-testid="profile_header_name"]', 15000);
        if (!hasContent) {
          throw new Error('Контент профиля не загрузился за отведенное время');
        }

        // Дополнительная пауза для стабильности
        await humanDelay(2000, 3000);

        // Выполняем скрипт извлечения данных
        const data = await win.webContents.executeJavaScript(extractionScript, true);
        
        if (!data) {
          throw new Error('Не удалось извлечь данные профиля');
        }

        results.push([url, data.name, data.formattedProfile, data.links]);
        console.log(`✅ Success: ${data.name}`);
        
        // Подсчитываем найденные ссылки
        const linkCount = data.links !== 'Ссылки не найдены' && data.links !== 'Ошибка при сборе ссылок' 
          ? data.links.split(' --- ').length 
          : 0;
        console.log(`🔗 Found ${linkCount} links`);
        
      } catch (err) {
        console.error(`❌ Error processing ${url}:`, err.message);
        results.push([url, 'Ошибка', 'Ошибка', 'Ошибка при сборе ссылок']);
      }
      
      // Уведомляем о прогрессе
      onProgress(i + 1, links.length);
      
      // Пауза между профилями для избежания блокировки
      if (i < links.length - 1) {
        console.log('⏱️ Пауза между профилями...');
        await humanDelay(5000, 8000);
      }
    }
  } finally {
    // Закрываем окно браузера
    try {
      win.destroy();
      console.log('🔒 Browser window closed');
    } catch (e) {
      console.error('Error closing browser window:', e);
    }
  }

  console.log(`✅ Profile scraping completed. Processed ${results.length} profiles`);
  return results;
}

module.exports = { scrapeProfiles };

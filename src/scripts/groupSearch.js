(function () {
  if (window.__fbGroupSearchCollector && window.__fbGroupSearchCollector.active) {
    if (typeof window.__fbGroupSearchCollector.reset === 'function') {
      window.__fbGroupSearchCollector.reset();
    }
    if (typeof window.__fbGroupSearchCollector.notify === 'function') {
      window.__fbGroupSearchCollector.notify();
    }
    console.log('[FB Group Parser] Уже активен, состояние обновлено.');
    return 'ALREADY_ACTIVE';
  }

  var HEADERS = [
    'id',
    'name',
    'url',
    'privacy',
    'memberInfo',
    'description',
    'highlight',
    'joinState',
    'hasMembershipQuestions',
    'facepile',
    'profilePicture',
    'searchRole',
    'friendlyName',
    'sourceDocId',
    'loggingSessionId',
    'loggingUnitId',
    'searchQuery',
    'fetchedAt'
  ];

  function sanitizeText(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value)
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parsePrivacy(memberInfo) {
    var text = sanitizeText(memberInfo);
    if (!text) {
      return '';
    }
    var parts = text.split('·');
    return sanitizeText(parts[0]);
  }

  function shorten(text, limit) {
    if (!text) {
      return '—';
    }
    if (text.length <= limit) {
      return text;
    }
    return text.slice(0, limit - 1) + '…';
  }

  function toArray(value) {
    return Array.isArray(value) ? value : [];
  }

  var collector = {
    active: true,
    headers: HEADERS.slice(0),
    dataMap: new Map(),
    data: [],
    meta: {
      totalRequests: 0,
      docIds: [],
      friendlyNames: [],
      lastQuery: '',
      lastDocId: ''
    },
    lastUpdate: null,
    overlay: null,
    overlayRefs: null
  };

  function ensureOverlay() {
    if (collector.overlay) {
      return collector.overlay;
    }

    var container = document.createElement('div');
    container.id = 'fb-group-search-overlay';
    container.style.cssText = [
      'position:fixed',
      'top:80px',
      'right:24px',
      'z-index:99999',
      'pointer-events:none',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif'
    ].join(';');

    var box = document.createElement('div');
    box.style.cssText = [
      'pointer-events:auto',
      'background:rgba(28,36,52,0.95)',
      'color:#ffffff',
      'padding:14px 18px',
      'border-radius:12px',
      'box-shadow:0 12px 32px rgba(9,17,31,0.35)',
      'min-width:240px',
      'max-width:320px'
    ].join(';');

    var title = document.createElement('div');
    title.textContent = 'Парсер групп активен';
    title.style.cssText = 'font-weight:600;font-size:14px;margin-bottom:6px;';

    var countLine = document.createElement('div');
    countLine.style.cssText = 'font-size:13px;margin-bottom:4px;';
    var countLabel = document.createElement('span');
    countLabel.textContent = 'Собрано групп: ';
    var countValue = document.createElement('span');
    countValue.setAttribute('data-role', 'count');
    countValue.style.cssText = 'font-weight:600;';
    countValue.textContent = '0';
    countLine.appendChild(countLabel);
    countLine.appendChild(countValue);

    var queryLine = document.createElement('div');
    queryLine.setAttribute('data-role', 'query');
    queryLine.style.cssText = 'font-size:12px;opacity:0.85;';
    queryLine.textContent = 'Поиск: —';

    var hintLine = document.createElement('div');
    hintLine.setAttribute('data-role', 'hint');
    hintLine.style.cssText = 'font-size:12px;opacity:0.75;margin-top:6px;';
    hintLine.textContent = 'Прокручивайте список, чтобы загрузить больше результатов';

    box.appendChild(title);
    box.appendChild(countLine);
    box.appendChild(queryLine);
    box.appendChild(hintLine);
    container.appendChild(box);
    document.body.appendChild(container);

    collector.overlay = container;
    collector.overlayRefs = {
      count: countValue,
      query: queryLine,
      hint: hintLine
    };

    return container;
  }

  function updateOverlay() {
    if (!collector.overlay) {
      ensureOverlay();
    }
    if (!collector.overlayRefs) {
      return;
    }

    collector.overlayRefs.count.textContent = collector.dataMap.size.toString();
    var queryText = collector.meta.lastQuery ? shorten(collector.meta.lastQuery, 60) : '—';
    collector.overlayRefs.query.textContent = 'Поиск: ' + queryText;

    var hintParts = ['Запросов: ' + collector.meta.totalRequests];
    if (collector.lastUpdate) {
      try {
        var updatedAt = new Date(collector.lastUpdate);
        hintParts.push('Обновление: ' + updatedAt.toLocaleTimeString());
      } catch (err) {
        // ignore
      }
    } else {
      hintParts.push('Скролльте вниз для загрузки новых групп');
    }
    collector.overlayRefs.hint.textContent = hintParts.join(' · ');
  }

  function notifyHost() {
    var payload = {
      count: collector.dataMap.size,
      lastQuery: collector.meta.lastQuery || '',
      lastUpdated: collector.lastUpdate
    };
    try {
      window.postMessage({ type: 'FB_GROUP_SEARCH_UPDATE', payload: payload }, '*');
    } catch (err) {
      console.warn('[FB Group Parser] postMessage error:', err);
    }
    try {
      var event = new CustomEvent('groupSearchUpdate', { detail: payload });
      document.dispatchEvent(event);
    } catch (err2) {
      console.warn('[FB Group Parser] CustomEvent error:', err2);
    }
  }

  function notify() {
    collector.data = Array.from(collector.dataMap.values());
    collector.summary = {
      total: collector.dataMap.size,
      lastQuery: collector.meta.lastQuery,
      lastUpdated: collector.lastUpdate,
      totalRequests: collector.meta.totalRequests
    };
    updateOverlay();
    notifyHost();
  }

  function upsert(entry) {
    if (!entry || !entry.id) {
      return false;
    }
    var existing = collector.dataMap.get(entry.id);
    if (existing) {
      collector.dataMap.set(entry.id, Object.assign({}, existing, entry));
      collector.lastUpdate = Date.now();
      return false;
    }
    collector.dataMap.set(entry.id, entry);
    collector.lastUpdate = Date.now();
    return true;
  }

  function parseRequestInfo(body) {
    var info = {
      docId: '',
      friendlyName: '',
      queryText: '',
      count: null,
      source: '',
      method: '',
      variables: null
    };

    if (!body) {
      return info;
    }

    var raw = '';

    if (typeof body === 'string') {
      raw = body;
    } else if (body instanceof URLSearchParams) {
      raw = body.toString();
    } else if (body && typeof body === 'object') {
      try {
        if (typeof body.entries === 'function') {
          var params = new URLSearchParams();
          var iterator = body.entries();
          var step;
          while (!(step = iterator.next()).done) {
            var pair = step.value;
            if (Array.isArray(pair) && pair.length > 1) {
              params.append(pair[0], pair[1]);
            }
          }
          raw = params.toString();
        }
      } catch (error) {
        console.warn('[FB Group Parser] Не удалось обработать тело запроса', error);
      }
    }

    if (!raw) {
      return info;
    }

    try {
      var paramsObj = new URLSearchParams(raw);
      info.docId = paramsObj.get('doc_id') || '';
      info.friendlyName = paramsObj.get('fb_api_req_friendly_name') || '';
      var variablesRaw = paramsObj.get('variables');
      if (variablesRaw) {
        try {
          info.variables = JSON.parse(variablesRaw);
          if (info.variables && info.variables.args) {
            if (info.variables.args.text) {
              info.queryText = sanitizeText(info.variables.args.text);
            }
            if (!info.queryText && info.variables.args.query) {
              info.queryText = sanitizeText(info.variables.args.query);
            }
          }
          if (typeof info.variables.count === 'number') {
            info.count = info.variables.count;
          }
        } catch (err) {
          console.warn('[FB Group Parser] Ошибка парсинга variables', err);
        }
      }
    } catch (err2) {
      console.warn('[FB Group Parser] Ошибка разбора параметров', err2);
    }

    return info;
  }

  function parseGraphqlPayloads(raw) {
    var payloads = [];
    if (!raw) {
      return payloads;
    }
    var text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) {
      return payloads;
    }
    try {
      payloads.push(JSON.parse(text));
      return payloads;
    } catch (err) {
      // fall through
    }

    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) {
        continue;
      }
      try {
        payloads.push(JSON.parse(line));
      } catch (error) {
        // ignore parsing errors for partial chunks
      }
    }
    return payloads;
  }

  function extractEdges(root) {
    var edges = [];
    var visited = new WeakSet();

    function walk(node) {
      if (!node || typeof node !== 'object') {
        return;
      }
      if (visited.has(node)) {
        return;
      }
      visited.add(node);

      if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) {
          walk(node[i]);
        }
        return;
      }

      if (Array.isArray(node.edges)) {
        for (var j = 0; j < node.edges.length; j++) {
          var edge = node.edges[j];
          if (edge) {
            edges.push(edge);
            walk(edge);
          }
        }
      }

      for (var key in node) {
        if (!Object.prototype.hasOwnProperty.call(node, key)) {
          continue;
        }
        var value = node[key];
        if (value && typeof value === 'object') {
          walk(value);
        }
      }
    }

    walk(root);
    return edges;
  }

  function firstPrimaryCtaProfile(viewModel) {
    if (!viewModel || !viewModel.ctas || !Array.isArray(viewModel.ctas.primary)) {
      return null;
    }
    if (viewModel.ctas.primary.length === 0) {
      return null;
    }
    var primary = viewModel.ctas.primary[0];
    return primary && primary.profile ? primary.profile : null;
  }

  function mapEdgeToEntry(edge, context) {
    if (!edge || typeof edge !== 'object') {
      return null;
    }

    var viewModel = null;
    if (edge.rendering_strategy && edge.rendering_strategy.view_model) {
      viewModel = edge.rendering_strategy.view_model;
    } else if (edge.node && edge.node.rendering_strategy && edge.node.rendering_strategy.view_model) {
      viewModel = edge.node.rendering_strategy.view_model;
    } else if (edge.view_model) {
      viewModel = edge.view_model;
    }

    if (!viewModel || typeof viewModel !== 'object') {
      return null;
    }

    var profile = viewModel.profile || null;
    if (!profile && viewModel.loggedProfile && viewModel.loggedProfile.__typename === 'Group') {
      profile = viewModel.loggedProfile;
    }
    if (!profile && edge.node && edge.node.profile) {
      profile = edge.node.profile;
    }

    if (!profile || (profile.__typename !== 'Group' && profile.type !== 'Group')) {
      return null;
    }

    var memberInfo = '';
    if (viewModel.primary_snippet_text_with_entities && viewModel.primary_snippet_text_with_entities.text) {
      memberInfo = sanitizeText(viewModel.primary_snippet_text_with_entities.text);
    }

    var descriptionPieces = [];
    var descriptionSource = toArray(viewModel.description_snippets_text_with_entities);
    for (var i = 0; i < descriptionSource.length; i++) {
      var piece = sanitizeText(descriptionSource[i] && descriptionSource[i].text);
      if (piece) {
        descriptionPieces.push(piece);
      }
    }

    var highlightText = '';
    if (viewModel.prominent_snippet_text_with_entities && viewModel.prominent_snippet_text_with_entities.text) {
      highlightText = sanitizeText(viewModel.prominent_snippet_text_with_entities.text);
    }

    var facepileText = '';
    if (viewModel.snippet_with_facepile && viewModel.snippet_with_facepile.simple_text_with_entities) {
      facepileText = sanitizeText(viewModel.snippet_with_facepile.simple_text_with_entities.text);
    }

    var ctaProfile = firstPrimaryCtaProfile(viewModel);

    var entry = {
      id: profile.id || '',
      name: sanitizeText(profile.name || profile.profile_name_with_possible_nickname || ''),
      url: profile.url || profile.profile_url || '',
      privacy: parsePrivacy(memberInfo),
      memberInfo: memberInfo,
      description: descriptionPieces.join(' | '),
      highlight: highlightText,
      joinState: ctaProfile && ctaProfile.viewer_join_state ? ctaProfile.viewer_join_state : '',
      hasMembershipQuestions: !!(ctaProfile && ctaProfile.has_membership_questions),
      facepile: facepileText,
      profilePicture: profile.profile_picture && profile.profile_picture.uri ? profile.profile_picture.uri : '',
      searchRole: sanitizeText((edge.node && edge.node.role) || edge.role || ''),
      friendlyName: context && context.friendlyName ? context.friendlyName : '',
      sourceDocId: context && context.docId ? context.docId : '',
      loggingSessionId: edge.logging_model && edge.logging_model.session_id ? edge.logging_model.session_id : '',
      loggingUnitId: edge.logging_unit_id || '',
      searchQuery: context && context.queryText ? context.queryText : '',
      fetchedAt: new Date().toISOString()
    };

    if (!entry.id) {
      return null;
    }

    return entry;
  }

  function handlePayload(root, context) {
    var edges = extractEdges(root);
    if (!edges.length) {
      return 0;
    }
    var added = 0;
    for (var i = 0; i < edges.length; i++) {
      var entry = mapEdgeToEntry(edges[i], context);
      if (!entry) {
        continue;
      }
      if (upsert(entry)) {
        added += 1;
      }
    }
    return added;
  }

  function handleResponse(raw, context) {
    var payloads = parseGraphqlPayloads(raw);
    if (!payloads.length) {
      return;
    }

    var totalAdded = 0;
    for (var i = 0; i < payloads.length; i++) {
      var payload = payloads[i];
      var root = payload && payload.data ? payload.data : payload;
      if (!root) {
        continue;
      }
      totalAdded += handlePayload(root, context);
    }

    if (context) {
      if (context.docId && collector.meta.docIds.indexOf(context.docId) === -1) {
        collector.meta.docIds.push(context.docId);
      }
      if (context.friendlyName && collector.meta.friendlyNames.indexOf(context.friendlyName) === -1) {
        collector.meta.friendlyNames.push(context.friendlyName);
      }
      if (context.docId) {
        collector.meta.lastDocId = context.docId;
      }
    }

    var previousQuery = collector.meta.lastQuery;
    if (context && context.queryText) {
      collector.meta.lastQuery = context.queryText;
    }

    if (totalAdded > 0) {
      console.log('[FB Group Parser] Добавлено групп:', totalAdded, 'Всего:', collector.dataMap.size);
      notify();
    } else if (collector.meta.lastQuery !== previousQuery) {
      notify();
    } else {
      updateOverlay();
    }
  }

  function shouldProcess(url) {
    return typeof url === 'string' && url.indexOf('/api/graphql') !== -1;
  }

  function installHooks() {
    if (window.__fbGroupSearchCollectorHooksInstalled) {
      return;
    }
    window.__fbGroupSearchCollectorHooksInstalled = true;

    var OriginalXMLHttpRequestSend = XMLHttpRequest.prototype.send;
    var OriginalXMLHttpRequestOpen = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function (method, url) {
      this.__fbGroupSearchMethod = method;
      this.__fbGroupSearchUrl = url;
      return OriginalXMLHttpRequestOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
      this.__fbGroupSearchBody = body;
      if (!this.__fbGroupSearchListenerAttached) {
        this.addEventListener('readystatechange', function () {
          if (this.readyState === 4 && shouldProcess(this.responseURL)) {
            var context = parseRequestInfo(this.__fbGroupSearchBody);
            context.source = 'xhr';
            context.method = this.__fbGroupSearchMethod || 'POST';
            collector.meta.totalRequests += 1;
            try {
              handleResponse(this.responseText, context);
            } catch (error) {
              console.error('[FB Group Parser] Ошибка обработки XHR ответа:', error);
            }
          }
        });
        this.__fbGroupSearchListenerAttached = true;
      }
      return OriginalXMLHttpRequestSend.apply(this, arguments);
    };

    var originalFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = '';
      var method = 'GET';
      if (typeof input === 'string') {
        url = input;
      } else if (input && typeof input === 'object') {
        url = input.url || '';
        method = input.method || method;
      }
      if (init && init.method) {
        method = init.method;
      }
      var body = init && init.body ? init.body : null;
      if (!body && input && typeof input === 'object' && input.body) {
        body = input.body;
      }

      return originalFetch.call(this, input, init).then(function (response) {
        if (shouldProcess(url)) {
          response.clone().text().then(function (text) {
            var context = parseRequestInfo(body);
            context.source = 'fetch';
            context.method = method || 'POST';
            collector.meta.totalRequests += 1;
            try {
              handleResponse(text, context);
            } catch (error) {
              console.error('[FB Group Parser] Ошибка обработки fetch ответа:', error);
            }
          }).catch(function (error) {
            console.warn('[FB Group Parser] Не удалось прочитать ответ fetch:', error);
          });
        }
        return response;
      });
    };
  }

  function resetCollector() {
    collector.dataMap.clear();
    collector.data = [];
    collector.meta.totalRequests = 0;
    collector.meta.docIds = [];
    collector.meta.friendlyNames = [];
    collector.meta.lastQuery = '';
    collector.meta.lastDocId = '';
    collector.lastUpdate = null;
    notify();
  }

  var existingOverlay = document.getElementById('fb-group-search-overlay');
  if (existingOverlay && existingOverlay.parentNode) {
    existingOverlay.parentNode.removeChild(existingOverlay);
  }

  installHooks();
  window.__fbGroupSearchCollector = collector;
  collector.reset = resetCollector;
  collector.notify = notify;

  ensureOverlay();
  resetCollector();

  console.log('[FB Group Parser] Инициализация завершена. Запустите поиск и прокручивайте результаты.');
  return 'FB_GROUP_PARSER_READY';
})();


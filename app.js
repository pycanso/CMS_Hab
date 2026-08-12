/* app.js — Motor de Perguntas & Respostas (100% offline). */
(function () {
  "use strict";

  const DATA = window.CMS_HABITACAO || { chunks: [], sources: [] };
  const HISTORY_KEY = "cms_hab_hist_v1";
  const LAST_N = 5;
  const MAX_CHUNKS = 2;
  const MAX_CHUNK_CHARS = 4000;
  const MAX_SEGMENT_CHARS = 1500;

  /* ==================== Normalização (espelha build_index.py) ==================== */

  function removeAccents(s) {
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  const STOPWORDS = new Set();
  (function initStopwords() {
    const raw = `
a o e é de da do das dos em na no nas nos ao aos à às as os um uma uns umas
por para com sem sob sobre entre até desde após antes depois como qual quais
quem que cujo cuja cujos cujas onde quando quanto quantos quantas porque
porquê se ou mas porém contudo não sim já ainda também mais menos muito muita
muitas muitos pouco pouca poucos poucas todo toda todos todas este esta estes
estas esse essa esses essas aquele aquela aqueles aquelas isto isso aquilo eu
tu ele ela nós vós eles elas me te lhe lhes ser estar ter haver fazer poder
dever querer dizer ir vir ficar olá oi bom boa bons boas dia tarde noite manhã
obrigado obrigada adeus favor talvez aqui ali lá tudo nada algo alguém ninguém
outro outra outros outras meu minha meus minhas teu tua teus tuas seu sua seus
suas nosso nossa nossos nossas vosso vossa vossos vossas dele dela deles
delas pode podem podia poderia deveria deve devem tenha tenham havia forma
fim caso pra pois então depois assim bem mal qual quais apenas está estão
`.trim().split(/\s+/);
    for (const w of raw) {
      STOPWORDS.add(w);
      STOPWORDS.add(removeAccents(w));
    }
  })();

  function stem(w) {
    if (w.length <= 4) return w;
    if (w.endsWith("ções") && w.length >= 7) return w.slice(0, -4) + "ção";
    if (w.endsWith("sões") && w.length >= 6) return w.slice(0, -4) + "são";
    if (w.endsWith("ães") && w.length >= 5) return w.slice(0, -3) + "ão";
    if (w.endsWith("ões") && w.length >= 5) return w.slice(0, -3) + "ão";
    if (w.endsWith("ais") && w.length >= 5) return w.slice(0, -2) + "al";
    if (w.endsWith("eis") && w.length >= 5) return w.slice(0, -2) + "el";
    if (w.endsWith("os") && w.length >= 5 && "aeiouáéíóú".includes(w[w.length - 3])) return w.slice(0, -1);
    if (w.endsWith("as") && w.length >= 5 && "aeiouáéíóú".includes(w[w.length - 3])) return w.slice(0, -1);
    if (w.endsWith("es") && w.length >= 5 && "aeiouáéíóú".includes(w[w.length - 3])) return w.slice(0, -2) + "e";
    if (w.endsWith("s") && w.length >= 5 && "aeiouáéíóúãõ".includes(w[w.length - 2])) return w.slice(0, -1);
    return w;
  }

  function tokenize(text) {
    const norm = removeAccents(text.toLowerCase());
    const words = norm.match(/[a-z0-9]+/g) || [];
    const out = [];
    for (const w of words) {
      if (w.length > 1 && !STOPWORDS.has(w)) out.push(stem(w));
    }
    return out;
  }

  function trigrams(w) {
    const r = [];
    for (let i = 0; i + 3 <= w.length; i++) r.push(w.slice(i, i + 3));
    return r;
  }

  function trigramSim(a, b) {
    const sa = trigrams(a);
    const sb = trigrams(b);
    if (!sa.length || !sb.length) return 0;
    const setB = new Set(sb);
    let inter = 0;
    const seen = new Set();
    for (const t of sa) {
      if (!seen.has(t)) {
        seen.add(t);
        if (setB.has(t)) inter++;
      }
    }
    const uni = new Set([...sa, ...sb]).size;
    return uni ? inter / uni : 0;
  }

  /* Correspondência de token de consulta contra token do corpus.
     Exata, prefixo ou semelhança de trigramas (robusto a flexões). */
  function tokenMatch(q, d) {
    if (q === d) return true;
    if (q.length >= 5 && d.startsWith(q)) return true;
    if (d.length >= 5 && q.startsWith(d)) return true;
    if (q.length >= 6 && d.length >= 6 && trigramSim(q, d) >= 0.5) return true;
    return false;
  }

  /* Sinónimos jurídicos comuns, em forma radical, para reforçar a correspondência. */
  const SYNONYMS = {
    "requisito": ["condicao"],
    "condicao": ["requisito"],
    "aceder": ["acesso"],
    "acesso": ["aceder"],
    "pagar": ["pagamento"],
    "pagamento": ["pagar"],
    "subarrendar": ["subarrendamento"]
  };

  function expandSynonyms(tokens) {
    const out = [];
    const seen = new Set();
    for (const t of tokens) {
      if (!seen.has(t)) { seen.add(t); out.push(t); }
      const syns = SYNONYMS[t];
      if (syns) {
        for (const s of syns) {
          if (!seen.has(s)) { seen.add(s); out.push(s); }
        }
      }
    }
    return out;
  }

  /* ==================== Índice ==================== */

  const chunks = DATA.chunks.map(function (c) {
    const title = c.title || "";
    const path = c.path || "";
    return {
      id: c.id !== undefined ? c.id : null,
      kind: c.kind,
      title: title,
      path: path,
      src: c.src,
      text: c.text,
      head: tokenize(title + " " + path),
      body: tokenize(c.text),
      tokens: tokenize(title + " " + path + " " + c.text)
    };
  });

  const N = chunks.length;
  let avgdl = 0;
  for (const c of chunks) avgdl += c.tokens.length;
  avgdl = avgdl / Math.max(1, N);
  const corpusTokens = [];
  const tokenSet = new Set();
  (function buildCorpus() {
    const seen = new Set();
    for (const c of chunks) {
      for (const t of c.tokens) {
        if (!seen.has(t)) {
          seen.add(t);
          corpusTokens.push(t);
          tokenSet.add(t);
        }
      }
    }
  })();

  // df e idf aproximados com base na contagem de chunks
  const df = {};
  (function computeDf() {
    for (const c of chunks) {
      const s = new Set(c.tokens);
      for (const t of s) df[t] = (df[t] || 0) + 1;
    }
  })();

  function idf(t) {
    const n = df[t] || 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  }

  // Para cada token da consulta, lista de tokens do corpus que lhe correspondem
  const matchCache = {};
  function matchingCorpusTokens(qt) {
    if (matchCache[qt]) return matchCache[qt];
    const out = [];
    const qSet = new Set();
    for (const dt of corpusTokens) {
      if (tokenMatch(qt, dt) && !qSet.has(dt)) {
        qSet.add(dt);
        out.push(dt);
      }
    }
    matchCache[qt] = out;
    return out;
  }

  /* Peso por tipo de chunk: preâmbulo/aviso e anexo não devem dominar artigos. */
  const KIND_WEIGHT = {
    "artigo": 1.0,
    "anexo": 0.55,
    "aviso": 0.45,
    "preambulo": 0.45
  };

  /* Pontuação fuzzy de um chunk para a consulta (BM25 com normalização pelo
     comprimento; os tokens correspondentes incluem equivalência, prefixo e
     semelhança de trigramas). */
  const K1 = 1.2;
  const B = 0.75;

  function scoreChunk(c, qtokens, bigrams) {
    const kindW = KIND_WEIGHT[c.kind] !== undefined ? KIND_WEIGHT[c.kind] : 1;

    function bm25(tokens) {
      const dl = tokens.length || 1;
      const tf = {};
      for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
      let score = 0;
      for (const qt of qtokens) {
        const m = matchingCorpusTokens(qt);
        if (!m.length) continue;
        let f = 0;
        for (const dt of m) f += tf[dt] || 0;
        if (!f) continue;
        const w = (f * (K1 + 1)) / (f + K1 * (1 - B + B * (dl / avgdl)));
        score += idf(qt) * w;
      }
      return score;
    }

    // Reforço de frase: bigramas adjacentes da pergunta presentes no chunk.
    let bigramBoost = 0;
    if (bigrams) {
      const toks = c.tokens;
      for (const bg of bigrams) {
        const a = bg[0];
        const b = bg[1];
        for (let i = 0; i + 1 < toks.length; i++) {
          if (toks[i] === a && toks[i + 1] === b) {
            bigramBoost += (idf(a) + idf(b)) * 2.2;
            break;
          }
        }
      }
    }

    return (bm25(c.body) + 1.6 * bm25(c.head)) * kindW + bigramBoost;
  }

  /* ==================== Segmentação e extração ==================== */

  function splitSegments(text) {
    const parts = text.split(
      /(?=\s+\d{1,2}\s+\u2014\s+|\s+[a-z]\)\s+(?:\u00ab|[A-Z0-9]))/
    );
    return parts
      .map(function (p) { return p.replace(/^\s+/, "").replace(/\s+$/, ""); })
      .filter(Boolean);
  }

  function segmentHits(segmentTokens, qtokens) {
    let n = 0;
    for (const qt of qtokens) {
      let ok = false;
      for (const dt of segmentTokens) {
        if (tokenMatch(qt, dt)) { ok = true; break; }
      }
      if (ok) n++;
    }
    return n;
  }

  function extractAnswer(chunk, qtokens) {
    const segs = splitSegments(chunk.text);
    const tokCache = [];
    for (let i = 0; i < segs.length; i++) tokCache.push(tokenize(segs[i]));
    const picked = [];
    for (let i = 0; i < segs.length; i++) {
      if (segmentHits(tokCache[i], qtokens) >= 1) {
        picked.push(maxSeg(segs[i]));
      }
    }
    if (!picked.length) {
      // sem segmentos diretamente correspondentes: apresenta o início do artigo
      picked.push(maxSeg(segs.length ? segs[0] : chunk.text));
    }
    let body = picked.join("\n\n");
    if (body.length > MAX_CHUNK_CHARS) body = body.slice(0, MAX_CHUNK_CHARS) + " […]";
    return body;
  }

  function maxSeg(seg) {
    if (seg.length > MAX_SEGMENT_CHARS) return seg.slice(0, MAX_SEGMENT_CHARS) + " […]";
    return seg;
  }

  /* ==================== Composição da resposta ==================== */

  function sourceLabel(srcId) {
    if (DATA.sources[srcId]) return DATA.sources[srcId].name;
    return "Documento";
  }

  function buildAnswer(qtokens, ranked) {
    const top = ranked.slice(0, MAX_CHUNKS).filter(function (r) { return r.score > 0; });
    if (!top.length) return null;

    const srcName = sourceLabel(top[0].chunk.src);

    const parts = [];
    parts.push("Com base no documento «" + srcName + "»:");

    let total = 0;
    for (let i = 0; i < top.length; i++) {
      const c = top[i].chunk;
      const head = c.title;
      const path = c.path ? "  ·  " + c.path : "";
      const body = extractAnswer(c, qtokens);
      const block = head + path + "\n" + body;
      if (total + block.length > 9000) break;
      total += block.length;
      parts.push(block);
    }

    parts.push("— Fonte: " + srcName);
    return parts.join("\n\n");
  }

  const DECLINE = "Lamento, mas não posso responder a essa questão. Este assistente responde " +
    "exclusivamente a perguntas relacionadas com a Habitação da C.M. Sintra, com base no " +
    "conteúdo dos dois documentos PDF disponíveis (Regulamento Geral de Habitação do " +
    "Município de Sintra). Se pretender, reformule a sua pergunta dentro deste âmbito.";

  /* Domínios claramente fora do âmbito (apenas domínio, não conteúdo do PDF). */
  const OFFTOPIC_TOKENS = new Set([
    "piscina", "biblioteca", "ginasio", "restaurante", "restaurantes", "cinema",
    "teatro", "mercado", "feira", "transporte", "autocarro", "comboio",
    "metropolitano", "estacionamento", "escola", "creche", "hospital",
    "farmacia", "correio", "padel", "futebol", "ginasio", "clube", "evento",
    "festa", "exposicao", "concerto", "praia", "turismo", "hotel", "voo",
    "voo", "franca", "france", "espanha", "madrid", "paris", "lisboa",
    "capital", "receita", "receitas", "cozinha", "previsao", "meteorologia",
    "temperatura", "eleicao", "eleicoes", "voto", "imposto", "irs", "matricula",
    "horoscopo", "temperatura", "musica", "jogo", "jogos", "famoso", "celebridade"
  ]);

  function answerQuestion(question) {
    const qtokens = tokenize(question);
    if (!qtokens.length) {
      return DECLINE;
    }

    for (const qt of qtokens) {
      if (OFFTOPIC_TOKENS.has(qt)) return DECLINE;
    }

    // Tokens da consulta com correspondência no corpus
    let matched = 0;
    for (const qt of qtokens) {
      if (matchingCorpusTokens(qt).length) matched++;
    }
    const ratio = matched / qtokens.length;

    let answerable = qtokens.length === 1
      ? matched >= 1
      : (matched >= 2 && ratio >= 0.5);
    if (!answerable) return DECLINE;

    const qtokensFull = expandSynonyms(qtokens);
    const bigrams = (function adjacentBigrams() {
      const out = [];
      for (let i = 0; i + 1 < qtokens.length; i++) out.push([qtokens[i], qtokens[i + 1]]);
      return out;
    })();

    const ranked = chunks
      .map(function (c) { return { chunk: c, score: scoreChunk(c, qtokensFull, bigrams) }; })
      .sort(function (a, b) { return b.score - a.score; });

    const topScore = ranked.length ? ranked[0].score : 0;
    if (topScore <= 0) return DECLINE;

    const answer = buildAnswer(qtokensFull, ranked);
    if (!answer) return DECLINE;
    return answer;
  }

  /* ==================== Histórico ==================== */

  let history = [];
  let showAll = false;

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      history = raw ? JSON.parse(raw) : [];
    } catch (e) {
      history = [];
    }
  }

  function itemKey(item) {
    return item.id !== undefined ? String(item.id) : String(item.t);
  }

  function removeHistoryItem(key) {
    history = history.filter(function (item) {
      return itemKey(item) !== key;
    });
    saveHistory();
    renderList();
  }

  function saveHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) { /* ignore */ }
  }

  /* ==================== UI ==================== */

  const $input = document.getElementById("question-input");
  const $askBtn = document.getElementById("ask-btn");
  const $answer = document.getElementById("answer-text");
  const $list = document.getElementById("history-list");
  const $toggle = document.getElementById("toggle-history");
  const $clear = document.getElementById("clear-history");
  const $suggestions = document.getElementById("suggestions");
  const $footerSources = document.getElementById("footer-sources");
  const $scopeNote = document.getElementById("scope-note");

  const SUGGESTIONS = [
    "Quais os requisitos para aceder ao arrendamento apoiado?",
    "Como é calculada a renda apoiada?",
    "Quais são os impedimentos à atribuição de habitação municipal?",
    "O que é o arrendamento de curta duração?",
    "Quais os deveres dos arrendatários?",
    "Quando entra em vigor o regulamento?"
  ];

  function fmtTime(iso) {
    try {
      return new Date(iso).toLocaleString("pt-PT", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit"
      });
    } catch (e) {
      return "";
    }
  }

  function renderList() {
    if (!history.length) {
      $list.innerHTML = '<p class="empty-history">Ainda não existem perguntas registadas.</p>';
      $toggle.hidden = true;
      return;
    }
    const items = showAll ? history.slice().reverse() : history.slice().reverse().slice(0, LAST_N);
    $list.innerHTML = "";
    items.forEach(function (item) {
      const key = itemKey(item);
      const div = document.createElement("div");
      div.className = "history-item";
      div.dataset.key = key;
      div.innerHTML =
        '<p class="q"></p>' +
        '<div class="item-foot">' +
        '<span class="time"></span>' +
        '<button type="button" class="delete-btn" aria-label="Apagar esta pergunta" title="Apagar">&times;</button>' +
        '</div>';
      div.querySelector(".q").textContent = item.q;
      div.querySelector(".time").textContent = fmtTime(item.t);

      div.addEventListener("click", function () {
        $input.value = item.q;
        $answer.value = item.a;
        document.querySelectorAll(".history-item").forEach(function (el) {
          el.classList.remove("active");
        });
        div.classList.add("active");
        window.scrollTo({ top: 0, behavior: "smooth" });
      });

      const del = div.querySelector(".delete-btn");
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        removeHistoryItem(key);
      });

      $list.appendChild(div);
    });
    $toggle.hidden = false;
    $toggle.textContent = showAll
      ? "Mostrar apenas as últimas " + LAST_N + " perguntas"
      : "Mostrar todas as perguntas (" + history.length + ")";
  }

  function submitQuestion() {
    const q = $input.value.trim();
    if (!q) {
      $input.focus();
      return;
    }
    $askBtn.disabled = true;
    const answer = answerQuestion(q);
    $answer.value = answer;
    $askBtn.disabled = false;

    history.push({
      q: q,
      a: answer,
      t: new Date().toISOString(),
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 8)
    });
    saveHistory();
    showAll = false;
    renderList();

    // Marca o item recém-criado como ativo
    const items = $list.querySelectorAll(".history-item");
    if (items.length) {
      const last = items[0]; // lista começa pela mais recente
      document.querySelectorAll(".history-item").forEach(function (el) {
        el.classList.remove("active");
      });
      last.classList.add("active");
    }
  }

  function initSuggestions() {
    SUGGESTIONS.forEach(function (s) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = s;
      b.addEventListener("click", function () {
        $input.value = s;
        submitQuestion();
      });
      $suggestions.appendChild(b);
    });
  }

  function initFooter() {
    const names = (DATA.sources || []).map(function (s) { return s.name; });
    $footerSources.textContent = "Fontes: " + names.join(" · ");
    $scopeNote.textContent =
      "As respostas reproduzem exclusivamente o texto dos documentos PDF. " +
      "Nada é inventado ou acrescentado; questões fora do âmbito da Habitação da C.M. Sintra são recusadas.";
  }

  // Estado inicial
  function init() {
    loadHistory();
    initSuggestions();
    initFooter();
    renderList();
    $input.focus();

    $askBtn.addEventListener("click", submitQuestion);
    $input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        submitQuestion();
      }
    });
    $toggle.addEventListener("click", function () {
      showAll = !showAll;
      renderList();
    });
    $clear.addEventListener("click", function () {
      history = [];
      saveHistory();
      renderList();
      $answer.value = "";
      $input.value = "";
      $input.focus();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* Hook de teste/inspeção (inofensivo em produção) */
  if (typeof window !== "undefined") {
    window.__CMS_TEST = {
      answerQuestion: answerQuestion,
      tokenize: tokenize,
      tokenMatch: tokenMatch,
      scoreChunk: scoreChunk,
      extractAnswer: extractAnswer,
      buildAnswer: buildAnswer,
      matchingCorpusTokens: matchingCorpusTokens,
      expandSynonyms: expandSynonyms,
      chunks: chunks
    };
  }
})();

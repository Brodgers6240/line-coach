
/* ============================================================
   Line Coach
   - Pick production -> pick character -> pick difficulty
   - Rehearse lines: app reads other characters in unique voices;
     listens when it's your turn; shows word-by-word diff.
   ============================================================ */

const STATE = {
  productionKey: null,    // 'last_supper' | 'passion'
  production: null,
  character: null,
  difficulty: 'easy',     // 'easy' | 'medium' | 'hard'
  view: 'home',           // 'home' | 'pickChar' | 'pickDiff' | 'rehearse'
  flat: [],               // flat list of items across scenes
  idx: 0,
  voices: [],
  charVoices: {},         // character -> SpeechSynthesisVoice
  listening: false,
  recognition: null,
  lastHeard: '',
  diff: null,             // last comparison result
  autoAdvance: true,
  ttsRate: 1.0,
  currentAudio: null,     // active HTMLAudioElement (so we can stop it)
};

// ---------- Voices ----------
function loadVoices() {
  return new Promise(resolve => {
    let v = speechSynthesis.getVoices();
    if (v && v.length) { STATE.voices = v; resolve(v); return; }
    speechSynthesis.onvoiceschanged = () => {
      v = speechSynthesis.getVoices();
      STATE.voices = v;
      resolve(v);
    };
    // Trigger load
    setTimeout(()=>{ const x = speechSynthesis.getVoices(); if (x.length){ STATE.voices = x; resolve(x); } }, 250);
  });
}

function hashStr(s) { let h = 0; for (let i=0;i<s.length;i++){ h = ((h<<5)-h + s.charCodeAt(i))|0; } return Math.abs(h); }

function pickVoicesForCharacters(characters) {
  // Pick English voices, prefer "premium / enhanced" ones if present
  const allEn = STATE.voices.filter(v => /^en[-_]/i.test(v.lang));
  if (!allEn.length) return {};
  // Sort: enhanced/premium first, then by name
  const sorted = allEn.slice().sort((a,b)=>{
    const score = v => (/(enhanced|premium|siri|natural)/i.test(v.name) ? 0 : 1);
    return score(a)-score(b) || a.name.localeCompare(b.name);
  });
  // Heuristic categorization by name (best-effort; varies by device)
  const looksMale = v => /(male|alex|aaron|daniel|fred|tom|reed|albert|arthur|gordon|oliver|rishi|mike|nicky|jasper|stephen|ralph|junior)/i.test(v.name);
  const looksFemale = v => /(female|samantha|karen|moira|fiona|tessa|victoria|allison|ava|susan|kate|sandy|nora|amelie|veena|martha|isha|princess|kathy|catherine|flo|grandma|grandpa is not|good news|whisper)/i.test(v.name);

  const males = sorted.filter(looksMale);
  const females = sorted.filter(looksFemale);
  const others = sorted.filter(v => !looksMale(v) && !looksFemale(v));

  // Lines like "Mary", "Claudia", "Woman at the fire" → female; others assumed male unless name suggests female
  const femaleish = ['Mary','Claudia','Woman at the fire','Salome'];

  const assigned = {};
  let mi = 0, fi = 0, oi = 0;
  characters.forEach(c => {
    const isFemale = femaleish.some(f => c.toLowerCase().includes(f.toLowerCase()));
    let pool, idx;
    if (isFemale && females.length) { pool = females; idx = fi++ % females.length; }
    else if (males.length)            { pool = males;   idx = mi++ % males.length; }
    else if (females.length)          { pool = females; idx = fi++ % females.length; }
    else                              { pool = others;  idx = oi++ % others.length; }
    // Special: try to give Jesus the deepest/first available voice
    if (c === 'Jesus' && males.length) pool = males, idx = 0;
    assigned[c] = pool[idx] || sorted[0];
  });
  return assigned;
}

function speak(text, voice, opts={}) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window) || !text || !text.trim()) { resolve(); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = opts.rate || STATE.ttsRate;
    u.pitch = opts.pitch || 1.0;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

// Try playing a pre-rendered MP3. Resolves true on successful end, false on failure.
function playAudioFile(src) {
  return new Promise(resolve => {
    if (!src) { resolve(false); return; }
    let done = false;
    const a = new Audio(src);
    a.playbackRate = STATE.ttsRate;
    STATE.currentAudio = a;
    const finish = (ok) => { if (done) return; done = true; STATE.currentAudio = null; resolve(ok); };
    a.onended = () => finish(true);
    a.onerror = () => finish(false);
    a.onstalled = () => { /* leave it; user can hit play again */ };
    const p = a.play();
    if (p && typeof p.then === 'function') {
      p.catch(() => finish(false));
    }
  });
}

function stopAudio() {
  if (STATE.currentAudio) {
    try { STATE.currentAudio.pause(); } catch(e){}
    STATE.currentAudio = null;
  }
}

// ---------- Text helpers ----------
function stripParentheticals(s) { return s.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim(); }

// Split a line into segments to render with cues in italic
function segmentLine(s) {
  const out = [];
  const re = /\(([^)]*)\)/g;
  let last = 0, m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push({ type:'speech', text: s.slice(last, m.index) });
    out.push({ type:'cue', text: '(' + m[1] + ')' });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ type:'speech', text: s.slice(last) });
  return out;
}

function tokenize(s) {
  // Lowercase, strip parentheticals, remove punctuation, split on whitespace
  return stripParentheticals(s).toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g,' ').trim().split(' ').filter(Boolean);
}

// Word-level diff (LCS-based)
function diffWords(expected, spoken) {
  const a = expected.slice(), b = spoken.slice();
  const m=a.length, n=b.length;
  const dp = Array.from({length:m+1}, ()=>new Array(n+1).fill(0));
  for (let i=m-1;i>=0;i--) for (let j=n-1;j>=0;j--) {
    dp[i][j] = a[i]===b[j] ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j], dp[i][j+1]);
  }
  const out = [];
  let i=0, j=0;
  while (i<m && j<n) {
    if (a[i]===b[j]) { out.push({type:'correct', word:a[i]}); i++; j++; }
    else if (dp[i+1][j] >= dp[i][j+1]) { out.push({type:'missing', word:a[i]}); i++; }
    else { out.push({type:'extra', word:b[j]}); j++; }
  }
  while (i<m) { out.push({type:'missing', word:a[i++]}); }
  while (j<n) { out.push({type:'extra', word:b[j++]}); }
  // Score
  const total = a.length || 1;
  const correct = out.filter(x=>x.type==='correct').length;
  return { tokens: out, pct: Math.round(100*correct/total), expectedCount: a.length, correctCount: correct };
}

// ---------- Speech recognition ----------
function newRecognizer() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = 'en-US';
  r.continuous = false;
  r.interimResults = true;
  r.maxAlternatives = 1;
  return r;
}

function listenOnce() {
  return new Promise((resolve, reject) => {
    const r = newRecognizer();
    if (!r) { reject(new Error('no_speech_api')); return; }
    STATE.recognition = r;
    STATE.listening = true;
    let finalText = '';
    r.onresult = (e) => {
      let interim='';
      for (let i=e.resultIndex; i<e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t + ' ';
        else interim += t;
      }
      updateHeard(finalText || interim, !!finalText);
    };
    r.onerror = (ev) => { STATE.listening = false; resolve(finalText.trim() || ''); };
    r.onend = () => { STATE.listening = false; resolve(finalText.trim()); };
    try { r.start(); } catch (err) { STATE.listening = false; reject(err); }
  });
}

function stopListening() {
  try { STATE.recognition && STATE.recognition.stop(); } catch(e){}
  STATE.listening = false;
}

// ---------- Flatten production ----------
function buildFlatItems(production) {
  const flat = [];
  production.scenes.forEach(sc => {
    flat.push({ type:'scene', name: sc.name });
    sc.items.forEach(it => flat.push(Object.assign({}, it, { sceneName: sc.name })));
  });
  return flat;
}

function charactersIn(production) {
  const set = new Map();
  production.scenes.forEach(sc => sc.items.forEach(i => {
    if (i.type === 'line') set.set(i.character, (set.get(i.character)||0) + 1);
  }));
  return Array.from(set.entries()).sort((a,b)=> b[1]-a[1] || a[0].localeCompare(b[0]));
}

// ---------- Rendering ----------
const root = () => document.getElementById('root');
const h = (tag, attrs={}, ...children) => {
  const el = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'onclick') el.addEventListener('click', attrs[k]);
    else if (k === 'class') el.className = attrs[k];
    else if (k === 'html') el.innerHTML = attrs[k];
    else el.setAttribute(k, attrs[k]);
  }
  children.flat().forEach(c => {
    if (c == null) return;
    if (typeof c === 'string') el.appendChild(document.createTextNode(c));
    else el.appendChild(c);
  });
  return el;
};

function setHeader(title, sub, showBack) {
  document.getElementById('hTitle').textContent = title;
  document.getElementById('hSub').textContent = sub || '';
  document.getElementById('hBack').style.display = showBack ? '' : 'none';
}

function go(view) {
  STATE.view = view;
  if (view === 'home') renderHome();
  else if (view === 'pickChar') renderPickCharacter();
  else if (view === 'pickDiff') renderPickDifficulty();
  else if (view === 'rehearse') renderRehearse();
}

// HOME
function renderHome() {
  setHeader('Line Coach', 'Pick a production', false);
  const r = root(); r.innerHTML = '';
  const productions = [
    { key:'last_supper', title: window.SCRIPTS.last_supper.title, desc: 'Scene 1: Before the Meal · Scene 2: The Last Supper' },
    { key:'passion',     title: window.SCRIPTS.passion.title,     desc: '7 scenes from Gethsemane to the Tomb' },
  ];
  productions.forEach(p => {
    const stats = (function(){
      const prod = window.SCRIPTS[p.key];
      const lines = prod.scenes.reduce((n,sc)=> n + sc.items.filter(i=>i.type==='line').length, 0);
      const chars = new Set();
      prod.scenes.forEach(sc => sc.items.forEach(i=>{ if(i.type==='line') chars.add(i.character); }));
      return `${lines} lines · ${chars.size} characters`;
    })();
    const card = h('div', {class:'card'},
      h('h2', {}, p.title),
      h('p', {}, p.desc),
      h('p', {class:'small'}, stats),
      h('button', {class:'btn', onclick: ()=> {
          STATE.productionKey = p.key;
          STATE.production = window.SCRIPTS[p.key];
          go('pickChar');
      }}, 'Choose this production')
    );
    r.appendChild(card);
  });

  r.appendChild(h('div', {class:'card'},
    h('h2', {}, 'How it works'),
    h('p', {}, '1) Pick your production and character.'),
    h('p', {}, '2) Choose Easy / Medium / Hard.'),
    h('p', {}, '3) The app reads other characters’ lines aloud. When it’s your turn, tap the mic and speak your line. You’ll see a word-by-word check.'),
    h('p', {class:'small'}, 'Tip: After it opens on your iPhone, tap the Share icon → “Add to Home Screen” for an app-like experience.')
  ));
}

// PICK CHARACTER
function renderPickCharacter() {
  setHeader(STATE.production.title, 'Pick your character', true);
  document.getElementById('hBack').onclick = () => go('home');
  const r = root(); r.innerHTML = '';
  const characters = charactersIn(STATE.production);
  const card = h('div', {class:'card'},
    h('h2', {}, 'Your character'),
    h('p', {}, 'Tap the character you’ll be playing. Number = how many lines they have.')
  );
  const list = h('div', {class:'list'});
  characters.forEach(([name, count]) => {
    const it = h('div', {class:'item', onclick: ()=>{
      STATE.character = name;
      list.querySelectorAll('.item').forEach(e=>e.classList.remove('selected'));
      it.classList.add('selected');
      nextBtn.disabled = false;
    }},
      h('span', {class:'name'}, name),
      h('span', {class:'count'}, count + ' line' + (count===1?'':'s'))
    );
    list.appendChild(it);
  });
  card.appendChild(list);
  r.appendChild(card);
  const nextBtn = h('button', {class:'btn', onclick: ()=> go('pickDiff') }, 'Continue');
  nextBtn.disabled = true;
  r.appendChild(nextBtn);
}

// PICK DIFFICULTY
function renderPickDifficulty() {
  setHeader(STATE.production.title, 'Difficulty for ' + STATE.character, true);
  document.getElementById('hBack').onclick = () => go('pickChar');
  const r = root(); r.innerHTML = '';

  const opts = [
    { key:'easy',   title:'Easy',   desc:'Your line is shown in full while you read it.' },
    { key:'medium', title:'Medium', desc:'Only the first letter of each word is shown.' },
    { key:'hard',   title:'Hard',   desc:'Just blanks — you see only how many words.' },
  ];
  const card = h('div', {class:'card'}, h('h2', {}, 'Difficulty'));
  const list = h('div', {class:'list'});
  opts.forEach(o => {
    const it = h('div', {class:'item' + (STATE.difficulty===o.key?' selected':''), onclick: ()=>{
      STATE.difficulty = o.key;
      list.querySelectorAll('.item').forEach(e=>e.classList.remove('selected'));
      it.classList.add('selected');
    }},
      h('div', {}, h('div',{class:'name'}, o.title), h('div',{class:'count'}, o.desc))
    );
    list.appendChild(it);
  });
  card.appendChild(list);
  r.appendChild(card);

  r.appendChild(h('div', {class:'card'},
    h('h2', {}, 'Reading speed'),
    h('div', {class:'pill-row'},
      ['0.85','1.0','1.15','1.3'].map(v => {
        const p = h('div', {class:'pill' + (parseFloat(v)===STATE.ttsRate?' selected':''), onclick:()=>{
          STATE.ttsRate = parseFloat(v);
          document.querySelectorAll('.pill-row .pill').forEach(e=>e.classList.remove('selected'));
          p.classList.add('selected');
        }}, v + '×');
        return p;
      })
    ),
    h('p', {class:'small'}, 'How fast the app speaks other characters’ lines.')
  ));

  r.appendChild(h('button', {class:'btn', onclick: async ()=> {
      // Build flat items, assign voices, start
      STATE.flat = buildFlatItems(STATE.production);
      const chars = charactersIn(STATE.production).map(x=>x[0]);
      STATE.charVoices = pickVoicesForCharacters(chars);
      STATE.idx = 0;
      go('rehearse');
  }}, 'Start rehearsal'));
}

// REHEARSE
function renderRehearse() {
  setHeader(STATE.production.title, STATE.character + ' · ' + STATE.difficulty.toUpperCase(), true);
  document.getElementById('hBack').onclick = () => { stopListening(); stopAudio(); speechSynthesis.cancel(); go('pickDiff'); };
  const r = root(); r.innerHTML = '';

  if (STATE.idx >= STATE.flat.length) {
    r.appendChild(h('div', {class:'card'},
      h('h2', {}, 'End of script — nice work!'),
      h('p', {}, 'You’ve walked through the whole production.'),
      h('button', {class:'btn', onclick: ()=>{ STATE.idx = 0; renderRehearse(); }}, 'Start over'),
      h('button', {class:'btn secondary', onclick: ()=> go('home')}, 'Pick a different production')
    ));
    return;
  }

  const item = STATE.flat[STATE.idx];
  const sceneCard = h('div', {class:'card'},
    h('div', {class:'scene-name'}, item.sceneName || item.name || ''),
    renderItemBody(item)
  );
  r.appendChild(sceneCard);

  // Controls
  const isYou = (item.type === 'line' && item.character === STATE.character);

  if (item.type === 'scene') {
    r.appendChild(h('button', {class:'btn', onclick: advance}, 'Begin scene'));
  }
  else if (item.type === 'direction') {
    r.appendChild(h('button', {class:'btn', onclick: advance}, 'Next ›'));
  }
  else if (item.type === 'line' && !isYou) {
    // Other character — speak then advance
    const speakBtn = h('button', {class:'btn', onclick: ()=>playOther(item, speakBtn)}, '▶ Play line');
    const skipBtn  = h('button', {class:'btn secondary', onclick: advance}, 'Skip ›');
    r.appendChild(speakBtn);
    r.appendChild(skipBtn);
    // Auto-play
    setTimeout(()=> playOther(item, speakBtn), 200);
  }
  else if (item.type === 'line' && isYou) {
    const heardEl = h('div', {class:'heard', id:'heard'}, h('div',{class:'label'},'You haven’t spoken yet'));
    r.appendChild(heardEl);
    const micBtn = h('button', {class:'mic', id:'mic', onclick: async ()=>{
      if (STATE.listening) { stopListening(); return; }
      // Tap to start
      micBtn.classList.add('listening'); micBtn.textContent = 'Listening…';
      let heard = '';
      try { heard = await listenOnce(); } catch(e) {}
      micBtn.classList.remove('listening'); micBtn.textContent = '🎤 Tap to speak';
      STATE.lastHeard = heard;
      const exp = tokenize(item.text);
      const got = tokenize(heard);
      STATE.diff = diffWords(exp, got);
      showHeard(item, STATE.diff);
      // Show next button
      nextWrap.style.display = '';
    }}, '🎤 Tap to speak');
    r.appendChild(micBtn);

    const showLineBtn = h('button', {class:'btn ghost', onclick: ()=>{
      reveal(item);
    }}, '👁 Show the line');
    const nextWrap = h('div', {style:'display:none'},
      h('button', {class:'btn', onclick: advance}, 'Next ›')
    );
    const skipBtn  = h('button', {class:'btn secondary', onclick: advance}, 'Skip ›');
    r.appendChild(showLineBtn);
    r.appendChild(skipBtn);
    r.appendChild(nextWrap);
  }

  // Progress
  const total = STATE.flat.length;
  r.appendChild(h('p', {class:'small', style:'text-align:center;margin-top:14px'},
    `Step ${STATE.idx+1} of ${total}`));
}

function advance() {
  stopListening();
  stopAudio();
  speechSynthesis.cancel();
  STATE.idx += 1;
  renderRehearse();
}

function renderItemBody(item) {
  if (item.type === 'scene') {
    return h('div', {},
      h('h2', {style:'margin-top:4px'}, item.name),
      h('p', {class:'small'}, 'Get ready — tap below to begin.')
    );
  }
  if (item.type === 'direction') {
    return h('div', {class:'direction'}, item.text);
  }
  // line
  const isYou = (item.character === STATE.character);
  const speakerEl = h('div', {class:'speaker' + (isYou ? ' yours' : '')},
    (isYou ? 'YOU — ' : '') + item.character);

  const lineEl = h('div', {class:'line-text', id:'lineText'});
  if (isYou) {
    renderLineForDifficulty(lineEl, item.text, STATE.difficulty);
  } else {
    segmentLine(item.text).forEach(seg => {
      if (seg.type==='cue') lineEl.appendChild(h('span',{class:'cue'}, seg.text + ' '));
      else lineEl.appendChild(document.createTextNode(seg.text));
    });
  }
  return h('div', {}, speakerEl, lineEl);
}

function renderLineForDifficulty(target, text, difficulty) {
  target.innerHTML = '';
  if (difficulty === 'easy') {
    segmentLine(text).forEach(seg => {
      if (seg.type==='cue') target.appendChild(h('span',{class:'cue'}, seg.text + ' '));
      else target.appendChild(document.createTextNode(seg.text));
    });
    return;
  }
  // For medium/hard, hide the speech text but always show parenthetical cues (they're stage instructions)
  segmentLine(text).forEach(seg => {
    if (seg.type === 'cue') {
      target.appendChild(h('span',{class:'cue'}, seg.text + ' '));
    } else {
      const words = seg.text.split(/(\s+)/);
      words.forEach(w => {
        if (/^\s+$/.test(w)) { target.appendChild(document.createTextNode(w)); return; }
        const wordOnly = w.replace(/[^A-Za-z0-9']/g,'');
        if (!wordOnly) { target.appendChild(document.createTextNode(w)); return; }
        if (difficulty === 'medium') {
          // first letter shown, rest replaced with underscores of same length
          const first = wordOnly[0];
          const rest = '_'.repeat(Math.max(0, wordOnly.length - 1));
          // Preserve any leading/trailing punctuation
          const lead = w.match(/^[^A-Za-z0-9']*/)[0];
          const tail = w.match(/[^A-Za-z0-9']*$/)[0];
          target.appendChild(document.createTextNode(lead + first + rest + tail + ' '));
        } else { // hard
          const blank = h('span', {class:'blank', style:'width:'+(wordOnly.length*0.55)+'em'});
          target.appendChild(blank);
          target.appendChild(document.createTextNode(' '));
        }
      });
    }
  });
}

function reveal(item) {
  const el = document.getElementById('lineText');
  if (!el) return;
  el.innerHTML = '';
  segmentLine(item.text).forEach(seg => {
    if (seg.type==='cue') el.appendChild(h('span',{class:'cue'}, seg.text + ' '));
    else el.appendChild(document.createTextNode(seg.text));
  });
}

async function playOther(item, btn) {
  if (btn) btn.textContent = '■ Playing…';
  let played = false;
  if (item.audioFile) {
    played = await playAudioFile(item.audioFile);
  }
  if (!played) {
    // Fall back to iOS built-in voice (robotic but better than silence)
    const voice = STATE.charVoices[item.character];
    const toSpeak = stripParentheticals(item.text);
    await speak(toSpeak, voice);
  }
  if (btn) btn.textContent = '▶ Play again';
  if (STATE.autoAdvance) advance();
}

function showHeard(item, diff) {
  const el = document.getElementById('heard');
  if (!el) return;
  el.innerHTML = '';
  el.appendChild(h('div', {class:'label'},
    `You said — ${diff.correctCount} of ${diff.expectedCount} words matched (${diff.pct}%)`));
  const line = h('div', {style:'margin-top:6px'});
  diff.tokens.forEach(t => {
    line.appendChild(h('span', {class:'word ' + t.type}, t.word + ' '));
  });
  el.appendChild(line);
  el.appendChild(h('div', {class:'small', style:'margin-top:8px'},
    'Green = correct, red = wrong, gray strike = missed, yellow = extra word.'));
}

function updateHeard(text, isFinal) {
  const el = document.getElementById('heard');
  if (!el) return;
  el.innerHTML = '';
  el.appendChild(h('div', {class:'label'}, isFinal ? 'Heard:' : 'Listening…'));
  el.appendChild(h('div', {style:'margin-top:4px'}, text || '—'));
}

// ---------- Init ----------
(async function init() {
  // Check Speech Recognition availability
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    console.warn('Speech recognition not available; mic features will be inactive but the rest works.');
  }
  await loadVoices();
  go('home');
})();

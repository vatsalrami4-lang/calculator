/* script.js
   Frontend-only full-feature set:
   - IndexedDB persistence
   - Upload & drag/drop songs
   - Playlist + play/pause/prev/next
   - Shuffle & Repeat
   - Volume & Speed
   - Favorites (saved in DB)
   - Lyrics modal (save lyrics per track)
   - Simple AI recommender (title-token overlap)
   - Animated gradient (CSS)
   - Search with autosuggestions
   - Waveform visualization & clickable seek
*/

(() => {
  // DOM
  const upload = document.getElementById('upload');
  const playlistEl = document.getElementById('playlist');
  const playBtn = document.getElementById('play');
  const prevBtn = document.getElementById('prev');
  const nextBtn = document.getElementById('next');
  const seek = document.getElementById('seek');
  const curT = document.getElementById('cur');
  const durT = document.getElementById('dur');
  const nowTitle = document.getElementById('nowTitle');
  const nowArtist = document.getElementById('nowArtist');
  const volume = document.getElementById('volume');
  const speed = document.getElementById('speed');
  const shuffleBtn = document.getElementById('shuffle');
  const repeatBtn = document.getElementById('repeat');
  const favBtn = document.getElementById('fav');
  const lyricsBtn = document.getElementById('lyricsBtn');
  const recsEl = document.getElementById('recs');
  const search = document.getElementById('search');
  const suggestions = document.getElementById('suggestions');
  const showFavs = document.getElementById('showFavs');
  const downloadAll = document.getElementById('downloadAll');
  const clearAll = document.getElementById('clearAll');
  const themeToggle = document.getElementById('themeToggle');
  const waveCanvas = document.getElementById('wave');

  const lyricsModal = document.getElementById('lyricsModal');
  const lyricsArea = document.getElementById('lyricsArea');
  const lyTitle = document.getElementById('lyTitle');
  const saveLyricsBtn = document.getElementById('saveLyrics');
  const closeLyricsBtn = document.getElementById('closeLyrics');

  // IndexedDB
  const DB = 'VMusicDB_v2';
  const STORE = 'tracks';
  let db;
  function openDB(){
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB, 2);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE)){
          const s = d.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          s.createIndex('name','name',{unique:false});
        }
      };
      req.onsuccess = e => { db = e.target.result; res(db); };
      req.onerror = () => rej(req.error);
    });
  }

  function addTrack(file, meta = {}){
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = e => {
        const tx = db.transaction([STORE],'readwrite');
        const store = tx.objectStore(STORE);
        const rec = {
          name: meta.name || file.name.replace(/\.[^/.]+$/,''),
          artist: meta.artist || '',
          blob: e.target.result, // ArrayBuffer
          date: Date.now(),
          favorite: false,
          lyrics: '' // store lyrics text or LRC
        };
        const q = store.add(rec);
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      };
      fr.onerror = () => rej(fr.error);
      fr.readAsArrayBuffer(file);
    });
  }

  function updateRecord(id, update){
    return new Promise((res, rej) => {
      const tx = db.transaction([STORE],'readwrite');
      const store = tx.objectStore(STORE);
      const g = store.get(id);
      g.onsuccess = () => {
        const rec = g.result;
        if (!rec) return rej('notfound');
        Object.assign(rec, update);
        const p = store.put(rec);
        p.onsuccess = () => res(p.result);
        p.onerror = () => rej(p.error);
      };
      g.onerror = () => rej(g.error);
    });
  }

  function deleteRecord(id){
    return new Promise((res, rej) => {
      const tx = db.transaction([STORE],'readwrite');
      const store = tx.objectStore(STORE);
      const d = store.delete(id);
      d.onsuccess = () => res();
      d.onerror = () => rej(d.error);
    });
  }

  function clearAllDB(){
    return new Promise((res, rej) => {
      const tx = db.transaction([STORE],'readwrite');
      const store = tx.objectStore(STORE);
      const c = store.clear();
      c.onsuccess = () => res();
      c.onerror = () => rej(c.error);
    });
  }

  function getAll(){
    return new Promise((res, rej) => {
      const tx = db.transaction([STORE],'readonly');
      const store = tx.objectStore(STORE);
      const q = store.getAll();
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  }

  // App state
  let tracks = []; // array of records
  let view = []; // indices into tracks (for search/favorites)
  let currentIndex = -1; // index into tracks
  let audio = new Audio();
  audio.preload = 'auto';
  let isPlaying = false;
  let shuffle = false;
  let repeatMode = 0; // 0 off, 1 all, 2 one
  let showOnlyFavs = false;

  // WebAudio for visualization
  let audioCtx, analyser, sourceNode;
  function ensureAudioCtx(){
    if (!audioCtx){
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      sourceNode = audioCtx.createMediaElementSource(audio);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      sourceNode.connect(analyser);
      analyser.connect(audioCtx.destination);
    }
  }

  // helpers
  function abToUrl(ab){ return URL.createObjectURL(new Blob([ab])); }
  function fmt(t){ if(!isFinite(t)) return '0:00'; const m=Math.floor(t/60), s=Math.floor(t%60).toString().padStart(2,'0'); return `${m}:${s}`; }
  function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  // render playlist
  function renderPlaylist(){
    playlistEl.innerHTML = '';
    view.forEach(i => {
      const r = tracks[i];
      const li = document.createElement('li');
      li.dataset.id = r.id;
      li.className = (i === currentIndex) ? 'active' : '';
      li.innerHTML = `
        <div class="meta">
          <div class="title">${escapeHtml(r.name)}</div>
          <div class="artist">${r.artist || new Date(r.date).toLocaleString()}</div>
        </div>
        <div class="actions">
          <button class="fav">${r.favorite ? '❤️' : '♡'}</button>
          <button class="dl">⬇</button>
          <button class="del">🗑</button>
        </div>
      `;
      li.addEventListener('click', (e) => {
        if (e.target.closest('.actions')) return;
        playById(r.id);
      });
      li.querySelector('.fav').addEventListener('click', async (e) => {
        e.stopPropagation();
        await updateRecord(r.id,{favorite: !r.favorite});
        await refresh();
      });
      li.querySelector('.dl').addEventListener('click', (e)=>{
        e.stopPropagation();
        downloadRecord(r);
      });
      li.querySelector('.del').addEventListener('click', async (e)=>{
        e.stopPropagation();
        if (!confirm(`Delete "${r.name}"?`)) return;
        await deleteRecord(r.id);
        await refresh();
      });
      playlistEl.appendChild(li);
    });
  }

  // refresh tracks from DB and apply filters
  async function refresh(){
    tracks = await getAll();
    tracks.sort((a,b)=> (a.date||0)-(b.date||0));
    applyFilters();
    updateRecs();
  }

  function applyFilters(q = (search.value||'').trim().toLowerCase()){
    if (showOnlyFavs) {
      view = tracks.map((t,i)=>t.favorite?i:-1).filter(i=>i!==-1);
    } else {
      view = tracks.map((t,i)=>i);
    }
    if (q) {
      view = view.filter(i => tracks[i].name.toLowerCase().includes(q));
    }
    renderPlaylist();
  }

  // playback helpers
  function findIndexById(id){ return tracks.findIndex(t=>t.id === id); }

  async function playById(id){
    const idx = findIndexById(Number(id));
    if (idx === -1) return;
    currentIndex = idx;
    const rec = tracks[idx];
    audio.src = abToUrl(rec.blob);
    ensureAudioCtx();
    try { await audio.play(); } catch(e) {}
    isPlaying = true;
    playBtn.textContent = '⏸';
    nowTitle.textContent = rec.name;
    nowArtist.textContent = rec.artist || '';
    favBtn.textContent = rec.favorite ? '❤️' : '♡';
    renderPlaylist();
    updateRecs();
  }

  function playPause(){
    if (!audio.src && view.length) {
      // play first visible
      playById(tracks[view[0]].id);
      return;
    }
    if (audio.paused) {
      audio.play().catch(()=>{});
      isPlaying = true;
      playBtn.textContent = '⏸';
    } else {
      audio.pause();
      isPlaying = false;
      playBtn.textContent = '▶';
    }
  }

  function next(){
    if (tracks.length === 0) return;
    if (repeatMode === 2) { audio.currentTime = 0; audio.play(); return; }
    // find current position in view
    let pos = view.indexOf(currentIndex);
    if (shuffle) {
      let r;
      if (view.length>1){
        do { r = view[Math.floor(Math.random()*view.length)]; } while (r === currentIndex);
      } else r = view[0];
      playById(tracks[r].id);
      return;
    }
    if (pos === -1) pos = 0;
    let nxt = pos + 1;
    if (nxt >= view.length){
      if (repeatMode === 1) nxt = 0; else { audio.pause(); playBtn.textContent='▶'; return; }
    }
    playById(tracks[view[nxt]].id);
  }

  function prev(){
    if (tracks.length === 0) return;
    let pos = view.indexOf(currentIndex);
    if (pos === -1) pos = 0;
    let p = pos - 1;
    if (p < 0) p = view.length - 1;
    playById(tracks[view[p]].id);
  }

  // download a record
  function downloadRecord(r){
    const url = abToUrl(r.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${r.name}.mp3`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
  }

  // bulk download (zipping clientside is heavy — we'll download one by one sequentially)
  async function downloadAllTracks(){
    for (const r of tracks) {
      downloadRecord(r);
      await new Promise(r=>setTimeout(r, 350)); // small delay
    }
  }

  // lyrics modal handling
  function openLyrics(){
    if (currentIndex === -1) return alert('No track selected');
    const rec = tracks[currentIndex];
    lyTitle.textContent = rec.name;
    lyricsArea.value = rec.lyrics || '';
    lyricsModal.classList.remove('hidden');
  }
  async function saveLyrics(){
    if (currentIndex === -1) return;
    await updateRecord(tracks[currentIndex].id, { lyrics: lyricsArea.value });
    lyricsModal.classList.add('hidden');
    await refresh();
  }

  // simple AI recommender: token overlap in titles
  function updateRecs(){
    recsEl.innerHTML = '';
    if (currentIndex === -1) return;
    const baseTokens = tokenize(tracks[currentIndex].name);
    const scores = tracks.map((t, i) => {
      if (i === currentIndex) return {i,score:-1};
      const s = tokenize(t.name).filter(x => baseTokens.includes(x)).length;
      return {i,score:s};
    }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,6);
    if (scores.length === 0) {
      recsEl.innerHTML = '<li style="opacity:.6">No local recommendations</li>';
      return;
    }
    for (const sc of scores){
      const li = document.createElement('li');
      li.textContent = tracks[sc.i].name;
      li.title = `Match score ${sc.score}`;
      li.addEventListener('click', ()=> playById(tracks[sc.i].id));
      recsEl.appendChild(li);
    }
  }
  function tokenize(s){
    return (s||'').toLowerCase().split(/[\s\-_.,]+/).filter(Boolean);
  }

  // search autosuggests
  function showSuggestions(q){
    suggestions.innerHTML = '';
    if (!q) { suggestions.classList.add('hidden'); return; }
    const matches = tracks.filter(t => t.name.toLowerCase().includes(q)).slice(0,6);
    if (matches.length===0){ suggestions.classList.add('hidden'); return; }
    for (const m of matches){
      const d = document.createElement('div');
      d.textContent = m.name;
      d.addEventListener('click', ()=> {
        search.value = m.name;
        suggestions.classList.add('hidden');
        applyFilters();
      });
      suggestions.appendChild(d);
    }
    suggestions.classList.remove('hidden');
  }

  // waveform visualization & clickable seek
  const wctx = waveCanvas.getContext('2d');
  function drawWave(){
    requestAnimationFrame(drawWave);
    if (!analyser) {
      // draw idle waves
      wctx.clearRect(0,0,waveCanvas.width,waveCanvas.height);
      const w = waveCanvas.width, h = waveCanvas.height;
      wctx.fillStyle = 'rgba(255,255,255,0.02)';
      wctx.fillRect(0,0,w,h);
      return;
    }
    const bufferLength = analyser.frequencyBinCount;
    const data = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(data);
    const w = waveCanvas.width = waveCanvas.clientWidth * devicePixelRatio;
    const h = waveCanvas.height = waveCanvas.clientHeight * devicePixelRatio;
    wctx.clearRect(0,0,w,h);
    const barWidth = w / bufferLength;
    for (let i=0;i<bufferLength;i++){
      const v = data[i] / 255;
      const barH = v * h * 0.9;
      const x = i * barWidth;
      wctx.fillStyle = `rgba(${120 + v*120}, ${160 + v*60}, ${220 - v*60}, 0.9)`;
      wctx.fillRect(x, h - barH, Math.max(1, barWidth - 1), barH);
    }
  }
  drawWave();

  // map click on canvas to seek
  waveCanvas.addEventListener('click', (e)=>{
    if (!audio.duration) return;
    const rect = waveCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = x / rect.width;
    audio.currentTime = ratio * audio.duration;
  });

  // audio events
  audio.ontimeupdate = () => {
    if (audio.duration){
      seek.value = (audio.currentTime / audio.duration).toFixed(3);
      curT.textContent = fmt(audio.currentTime);
      durT.textContent = fmt(audio.duration);
    }
  };
  audio.onended = () => next();

  // UI event bindings
  playBtn.addEventListener('click', playPause);
  prevBtn.addEventListener('click', prev);
  nextBtn.addEventListener('click', next);
  seek.addEventListener('input', ()=> {
    if (!audio.duration) return;
    audio.currentTime = Number(seek.value) * audio.duration;
  });
  volume.addEventListener('input', ()=> audio.volume = Number(volume.value));
  speed.addEventListener('change', ()=> audio.playbackRate = Number(speed.value));

  shuffleBtn.addEventListener('click', ()=>{
    shuffle = !shuffle;
    shuffleBtn.style.opacity = shuffle ? '1' : '0.6';
    shuffleBtn.title = shuffle ? 'Shuffle: On' : 'Shuffle: Off';
  });

  repeatBtn.addEventListener('click', ()=>{
    repeatMode = (repeatMode + 1) % 3;
    repeatBtn.textContent = repeatMode === 0 ? '🔁 Off' : repeatMode === 1 ? '🔁 All' : '🔁 One';
  });

  favBtn.addEventListener('click', async ()=>{
    if (currentIndex === -1) return;
    const rec = tracks[currentIndex];
    await updateRecord(rec.id, { favorite: !rec.favorite });
    await refresh();
  });

  lyricsBtn.addEventListener('click', openLyrics);
  closeLyricsBtn.addEventListener('click', ()=> lyricsModal.classList.add('hidden'));
  saveLyricsBtn.addEventListener('click', saveLyrics);

  // upload handling
  upload.addEventListener('change', async (e)=>{
    const files = Array.from(e.target.files || []);
    for (const f of files){
      if (!f.type.startsWith('audio')) continue;
      await addTrack(f);
    }
    await refresh();
    // auto-play last added
    if (tracks.length) {
      playById(tracks[tracks.length - 1].id);
    }
    upload.value = '';
  });

  // drag/drop
  document.addEventListener('dragover', e=>e.preventDefault());
  document.addEventListener('drop', async (e)=>{
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    for (const f of files){
      if (!f.type.startsWith('audio')) continue;
      await addTrack(f);
    }
    await refresh();
    if (tracks.length) playById(tracks[tracks.length - 1].id);
  });

  // search & suggestions
  search.addEventListener('input', debounce((e)=>{
    const q = (e.target.value||'').trim().toLowerCase();
    showSuggestions(q);
    applyFilters();
  }, 160));

  document.addEventListener('click', (e)=>{
    if (!search.contains(e.target) && !suggestions.contains(e.target)) suggestions.classList.add('hidden');
  });

  // show favorites
  showFavs.addEventListener('click', ()=>{
    showOnlyFavs = !showOnlyFavs;
    showFavs.style.opacity = showOnlyFavs ? '1' : '0.8';
    applyFilters();
  });

  downloadAll.addEventListener('click', async ()=> {
    if (!confirm('Download all tracks sequentially?')) return;
    await downloadAllTracks();
  });

  clearAll.addEventListener('click', async ()=>{
    if (!confirm('Clear entire library?')) return;
    await clearAllDB();
    tracks = []; view = []; currentIndex = -1; audio.pause(); audio.src='';
    nowTitle.textContent = 'No song';
    await refresh();
  });

  // theme toggle (simple invert hint)
  themeToggle.addEventListener('click', ()=>{
    const app = document.getElementById('app');
    if (app.classList.contains('moonlit-dark')) {
      app.classList.remove('moonlit-dark');
      themeToggle.textContent = '🌙';
    } else {
      app.classList.add('moonlit-dark');
      themeToggle.textContent = '☀';
    }
  });

  // lyrics save
  async function saveLyrics(){
    if (currentIndex === -1) return;
    const text = lyricsArea.value;
    await updateRecord(tracks[currentIndex].id, { lyrics: text });
    lyricsModal.classList.add('hidden');
    await refresh();
  }

  // playById helper returns playing promise
  async function playById(id){
    await playByIdImpl(id);
  }
  async function playByIdImpl(id){
    const idx = findIndexById(Number(id));
    if (idx === -1) return;
    currentIndex = idx;
    const rec = tracks[idx];
    audio.src = abToUrl(rec.blob);
    ensureAudioCtx();
    try { await audio.play(); } catch(e) {}
    isPlaying = true;
    playBtn.textContent = '⏸';
    nowTitle.textContent = rec.name;
    nowArtist.textContent = rec.artist || '';
    favBtn.textContent = rec.favorite ? '❤️' : '♡';
    renderPlaylist();
    updateRecs();
  }

  function findIndexById(id){ return tracks.findIndex(t=>t.id === id); }

  // helpers
  function debounce(fn, t=150){ let id; return (...a)=>{ clearTimeout(id); id=setTimeout(()=>fn(...a),t); }; }

  // init
  (async function init(){
    await openDB();
    await refresh();

    // restore UI prefs
    volume.value = 1; audio.volume = 1;
    speed.value = 1; audio.playbackRate = 1;

    // ensure audio context after first user gesture
    document.addEventListener('click', ()=> { try { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); } catch(e){} }, { once: true });

    // connect visualizer when audio source available
    // connect source when playing
    audio.addEventListener('play', ()=> {
      try { ensureAudioCtx(); } catch(e){}
    });

    // start loop to update recs occasionally
    setInterval(()=> updateRecs(), 1500);
  })();

  // expose some helpers to console for debugging (optional)
  window._vmusic = { refresh, tracks, db };

})();

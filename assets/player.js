/**
 * Raheem Radio Player
 * WordPress override: window.raheemPlayer = { streamUrl, metadataUrl }
 */

const DEFAULTS = {
  streamUrl:   'https://onair7.xdevel.com/proxy/xautocloud_g3xw_2307?mp=/;1/',
  metadataUrl: 'https://api.xdevel.com/inonda/history/91938564/?clientId=ac8ac671a0642395bbd462ca3e04f8330ebcc376&type=xperi',
  pollMs:      12000,
};
const cfg = Object.assign({}, DEFAULTS, window.raheemPlayer || {});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── DOM ─────────────────────────────────────────────────────────
const audio          = document.getElementById('radioAudio');
const ambientA       = document.getElementById('ambientA');
const ambientB       = document.getElementById('ambientB');
const artWrap        = document.getElementById('artWrap');
const artImg         = document.getElementById('artImg');
const artPlaceholder = document.getElementById('artPlaceholder');
const liveBadge      = document.getElementById('liveBadge');
const trackBlock     = document.getElementById('trackBlock');
const trackArtist    = document.getElementById('trackArtist');
const trackTitle     = document.getElementById('trackTitle');
const trackAlbum     = document.getElementById('trackAlbum');
const iconPlay       = document.getElementById('iconPlay');
const iconPause      = document.getElementById('iconPause');
const iconLoading    = document.getElementById('iconLoading');
const volumeSlider   = document.getElementById('volumeSlider');
const bottomBar      = document.querySelector('.bottom-bar');
const streamBtn      = document.getElementById('streamBtn');
const streamSheet    = document.getElementById('streamSheet');
const sheetOverlay   = document.getElementById('sheetOverlay');
const playlistBtn    = document.getElementById('playlistBtn');
const playlistSheet  = document.getElementById('playlistSheet');
const playlistOverlay = document.getElementById('playlistOverlay');
const playlistItems  = document.getElementById('playlistItems');
const airplayOption  = document.getElementById('airplayOption');
const castOption     = document.getElementById('castOption');
const toast          = document.getElementById('toast');

// ── State ────────────────────────────────────────────────────────
let isPlaying       = false;
let pollTimer       = null;
let pollInFlight    = false;
let lastTrackId     = null;
let ambientLayer    = 'A';
let toastTimer      = null;
let historyTracks   = [];
let castingActive   = false;
let localVolume     = 0.8; // mirrors audio.volume; saved before casting takes over
let currentArtist   = '';
let currentTitle    = '';
let currentAlbum    = '';
let currentArtUrl   = '';
const trackScrollTimers = [];

// ── Init ─────────────────────────────────────────────────────────
localVolume  = parseFloat(volumeSlider.value);
audio.volume = localVolume;
updateSlider();
initMediaSession();
// Pre-fetch current track on load so art + info are visible before play
pollMetadata();

// ── Playback ─────────────────────────────────────────────────────
function startPlay() {
  setLoading(true);
  audio.src = cfg.streamUrl;
  audio.play().catch(err => {
    console.error('[Raheem]', err);
    setLoading(false);
    showToast('Could not start stream — check your connection.');
  });
}

function stopPlay() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  setPlayState(false);
  stopPolling();
}

function setLoading(on) {
  iconPlay.style.display    = on ? 'none' : (isPlaying ? 'none'  : 'block');
  iconPause.style.display   = on ? 'none' : (isPlaying ? 'block' : 'none');
  iconLoading.style.display = on ? 'block' : 'none';
  artWrap.style.pointerEvents = on ? 'none' : '';
}

function setPlayState(playing) {
  isPlaying = playing;
  iconPlay.style.display    = playing ? 'none'  : 'block';
  iconPause.style.display   = playing ? 'block' : 'none';
  iconLoading.style.display = 'none';
  artWrap.style.pointerEvents = '';
  artWrap.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  liveBadge.classList.toggle('active', playing);
  bottomBar.classList.toggle('active', playing);
  updateMediaSession();
}

// Tap art to play / pause
artWrap.addEventListener('click', () => {
  if (castingActive) {
    if (isPlaying) castStop(); else { setLoading(true); castStream(); }
  } else {
    if (isPlaying) stopPlay(); else startPlay();
  }
});
artWrap.addEventListener('keydown', e => {
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); artWrap.click(); }
});

audio.addEventListener('playing', () => { if (castingActive) return; setPlayState(true);  pollAndSchedule(); });
audio.addEventListener('waiting',  () => { if (castingActive) return; setLoading(true); });
audio.addEventListener('canplay',  () => { if (castingActive) return; if (isPlaying) setLoading(false); });
audio.addEventListener('error',    () => { if (castingActive) return; setPlayState(false); stopPolling(); showToast('Stream error — please try again.'); });
audio.addEventListener('ended',    () => { if (castingActive) return; setPlayState(false); stopPolling(); });

// ── Metadata ─────────────────────────────────────────────────────
function pollAndSchedule() {
  pollMetadata();
  stopPolling();
  pollTimer = setInterval(pollMetadata, cfg.pollMs);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

async function pollMetadata() {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    const res = await fetch(cfg.metadataUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    applyMetadata(await res.json());
  } catch (e) {
    console.warn('[Raheem] metadata:', e.message);
  } finally {
    pollInFlight = false;
  }
}

function applyMetadata(data) {
  const tracks = data.nowPlaying || data.now_playing || data.history || data;
  if (!Array.isArray(tracks) || !tracks.length) return;

  historyTracks = tracks;

  const track = tracks[0];
  const id = track.id || `${track.artist}|${track.title}`;
  if (id === lastTrackId) return;
  lastTrackId = id;

  const artist = track.artist   || track.artistName || '';
  const title  = track.title    || track.trackTitle  || '';
  const album  = track.album    || track.albumName   || '';
  const art    = track.imageUrl || track.cover_url   || track.image || '';

  currentArtist = artist;
  currentTitle  = title;
  currentAlbum  = album;
  currentArtUrl = art;

  animateTrackChange(artist, title, album);
  if (art) updateArt(art);
  updateMediaSession();
  if (castingActive) castStream();
}

function initMediaSession() {
  if (!('mediaSession' in navigator)) return;
  // Handlers check castingActive at invocation time — registered once, never re-registered
  navigator.mediaSession.setActionHandler('play',  () => castingActive ? (setLoading(true), castStream()) : startPlay());
  navigator.mediaSession.setActionHandler('pause', () => castingActive ? castStop() : stopPlay());
  navigator.mediaSession.setActionHandler('stop',  () => castingActive ? castStop() : stopPlay());
}

function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title:   currentTitle  || 'Studio Raheem',
    artist:  currentArtist || 'Studio Raheem',
    album:   currentAlbum  || '',
    artwork: currentArtUrl
      ? [{ src: currentArtUrl, sizes: '512x512', type: 'image/jpeg' }]
      : [],
  });
  navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
}

function _setField(el, text) {
  const span = el.querySelector('span') || el.appendChild(document.createElement('span'));
  span.textContent = text;
}

function animateTrackChange(artist, title, album) {
  clearTrackScrolls();
  trackBlock.classList.add('changing');
  setTimeout(() => {
    _setField(trackArtist, artist || 'Studio Raheem');
    _setField(trackTitle,  title);
    _setField(trackAlbum,  album);
    trackBlock.classList.remove('changing');
    // Allow layout to settle before measuring overflow
    requestAnimationFrame(() => requestAnimationFrame(initTrackScrolls));
  }, 300);
}

// ── Track field scroll ────────────────────────────────────────────
function clearTrackScrolls() {
  trackScrollTimers.forEach(t => clearTimeout(t));
  trackScrollTimers.length = 0;
  [trackArtist, trackTitle, trackAlbum].forEach(el => {
    const span = el.querySelector('span');
    if (span) span.getAnimations().forEach(a => a.cancel());
  });
}

function initTrackScrolls() {
  // Collect fields that overflow their clip container
  const fields = [trackArtist, trackTitle, trackAlbum].map(el => {
    const span = el.querySelector('span');
    if (!span || !span.textContent.trim()) return null;
    const overflow = span.offsetWidth - el.offsetWidth;
    return overflow > 0 ? { el, span, overflow } : null;
  }).filter(Boolean);

  if (!fields.length) return;

  let scrollCancelled = false;

  // Patch clearTrackScrolls for this scroll session
  const prevClear = clearTrackScrolls;
  function scrollField(idx) {
    if (scrollCancelled) return;
    const { span, overflow } = fields[idx % fields.length];
    const scrollMs  = (overflow / 80) * 1000;
    const returnMs  = (overflow / 160) * 1000; // scroll back at 2× speed

    const t1 = setTimeout(() => {
      if (scrollCancelled) return;
      const fwd = span.animate(
        [{ transform: 'translateX(0)' }, { transform: `translateX(-${overflow}px)` }],
        { duration: scrollMs, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' }
      );
      fwd.onfinish = () => {
        if (scrollCancelled) { fwd.cancel(); return; }
        const t2 = setTimeout(() => {
          if (scrollCancelled) { fwd.cancel(); return; }
          const bwd = span.animate(
            [{ transform: `translateX(-${overflow}px)` }, { transform: 'translateX(0)' }],
            { duration: returnMs, easing: 'ease-in', fill: 'forwards' }
          );
          bwd.onfinish = () => {
            if (scrollCancelled) { bwd.cancel(); return; }
            fwd.cancel();
            bwd.cancel();
            scrollField(idx + 1);
          };
        }, 2000);
        trackScrollTimers.push(t2);
      };
    }, 3000);

    trackScrollTimers.push(t1);
  }

  // Mark this session cancelled when clearTrackScrolls is next called
  const origClear = clearTrackScrolls;
  clearTrackScrolls = function () {
    scrollCancelled = true;
    clearTrackScrolls = origClear;
    origClear();
  };

  scrollField(0);
}

// ── Art + ambient background ──────────────────────────────────────
function updateArt(url) {
  // Crossfade ambient layers
  const incoming = ambientLayer === 'A' ? ambientB : ambientA;
  const outgoing = ambientLayer === 'A' ? ambientA : ambientB;
  incoming.style.backgroundImage = `url(${url})`;
  incoming.style.opacity = '1';
  outgoing.style.opacity = '0';
  // Release the decoded image from the outgoing layer after the CSS transition (1.4 s)
  setTimeout(() => { outgoing.style.backgroundImage = ''; }, 1500);
  ambientLayer = ambientLayer === 'A' ? 'B' : 'A';

  // Load foreground art image
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    artImg.src = url;
    artImg.classList.add('loaded');
    artPlaceholder.classList.add('hidden');

    // Canvas colour extraction → radial gradient on body (deferred to idle time)
    const extractColor = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 40;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 40, 40);
        const d = ctx.getImageData(0, 0, 40, 40).data;
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2]; }
        const n = d.length / 4;
        r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
        document.body.style.background =
          `radial-gradient(ellipse 110% 65% at 50% 0%, rgba(${r},${g},${b},0.4) 0%, #0e0e0e 60%)`;
      } catch (_) {
        document.body.style.background = '#0e0e0e';
      }
    };
    if ('requestIdleCallback' in window) requestIdleCallback(extractColor);
    else setTimeout(extractColor, 200);
  };
  img.onerror = () => {
    artImg.classList.remove('loaded');
    artPlaceholder.classList.remove('hidden');
    document.body.style.background = '#0e0e0e';
  };
  img.src = url;
}

// ── Volume ────────────────────────────────────────────────────────
function syncSliderToReceiver(session) {
  if (!session || sliderDragging) return;
  const vol = session.getVolume();
  if (vol == null) {
    setTimeout(() => syncSliderToReceiver(session), 500);
    return;
  }
  const level = session.isMuted() ? 0 : vol;
  volumeSlider.value = level;
  updateSlider();
}

let sliderDragging = false;
volumeSlider.addEventListener('pointerdown', () => { sliderDragging = true; });
volumeSlider.addEventListener('pointerup',   () => { sliderDragging = false; });

volumeSlider.addEventListener('input', () => {
  const vol = parseFloat(volumeSlider.value);
  if (castingActive) {
    const session = cast.framework.CastContext.getInstance().getCurrentSession();
    if (session) {
      session.setVolume(vol).catch(e => console.warn('[Raheem] setVolume:', e));
      session.setMute(vol === 0).catch(e => console.warn('[Raheem] setMute:', e));
    }
  } else {
    localVolume  = vol;
    audio.volume = vol;
    audio.muted  = vol === 0;
  }
  updateSlider();
});

function updateSlider() {
  const pct = parseFloat(volumeSlider.value) * 100;
  volumeSlider.style.background =
    `linear-gradient(to right, rgba(255,255,255,0.9) ${pct}%, rgba(255,255,255,0.25) ${pct}%)`;
}

// ── Stream sheet ──────────────────────────────────────────────────
function openSheet()  { streamSheet.classList.add('open');    sheetOverlay.classList.add('open'); }
function closeSheet() { streamSheet.classList.remove('open'); sheetOverlay.classList.remove('open'); }

sheetOverlay.addEventListener('click', closeSheet);
streamSheet.querySelector('.sheet-handle').addEventListener('click', closeSheet);
document.getElementById('streamClose').addEventListener('click', closeSheet);

// ── Playlist sheet ────────────────────────────────────────────────
function openPlaylist() {
  playlistItems.innerHTML = '';
  if (!historyTracks.length) {
    const empty = document.createElement('p');
    empty.className = 'playlist-empty';
    empty.textContent = 'No history yet — play the stream first.';
    playlistItems.appendChild(empty);
  } else {
    historyTracks.forEach((t, i) => {
      const artist = t.artist   || t.artistName || '';
      const title  = t.title    || t.trackTitle  || '';
      const art    = t.imageUrl || t.cover_url   || t.image || '';
      const row = document.createElement('div');
      row.className = 'playlist-row' + (i === 0 ? ' playlist-row--now' : '');
      const query = encodeURIComponent([artist, title].filter(Boolean).join(' '));
      row.innerHTML = `
        ${art ? `<img class="playlist-art" src="${escapeHtml(art)}" alt="" loading="lazy">` : '<div class="playlist-art playlist-art--empty"></div>'}
        <div class="playlist-info">
          <span class="playlist-artist">${escapeHtml(artist)}</span>
          <span class="playlist-title">${escapeHtml(title)}</span>
        </div>
        <a class="playlist-spotify" href="https://open.spotify.com/search/${query}" target="_blank" rel="noopener" aria-label="Search on Spotify">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424a.622.622 0 0 1-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.623.623 0 0 1-.277-1.215c3.809-.87 7.076-.496 9.712 1.115a.623.623 0 0 1 .207.857zm1.223-2.722a.78.78 0 0 1-1.072.257c-2.687-1.652-6.785-2.131-9.965-1.166a.78.78 0 0 1-.973-.519.781.781 0 0 1 .519-.972c3.632-1.102 8.147-.568 11.234 1.328a.78.78 0 0 1 .257 1.072zm.105-2.835C14.692 8.95 9.375 8.775 6.297 9.71a.937.937 0 1 1-.543-1.793c3.563-1.08 9.484-.872 13.221 1.372a.937.937 0 0 1-.061 1.578z"/></svg>
        </a>
      `;
      playlistItems.appendChild(row);
    });
  }
  playlistSheet.classList.add('open');
  playlistOverlay.classList.add('open');
}
function closePlaylist() {
  playlistSheet.classList.remove('open');
  playlistOverlay.classList.remove('open');
}

playlistBtn.addEventListener('click', openPlaylist);
playlistOverlay.addEventListener('click', closePlaylist);
playlistSheet.querySelector('.sheet-handle').addEventListener('click', closePlaylist);
document.getElementById('playlistClose').addEventListener('click', closePlaylist);

let playlistTouchStartY = 0;
playlistSheet.addEventListener('touchstart', e => { playlistTouchStartY = e.touches[0].clientY; }, { passive: true });
playlistSheet.addEventListener('touchend',   e => {
  if (e.changedTouches[0].clientY - playlistTouchStartY > 60) closePlaylist();
});

// Swipe down to dismiss
let touchStartY = 0;
streamSheet.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
streamSheet.addEventListener('touchend',   e => {
  if (e.changedTouches[0].clientY - touchStartY > 60) closeSheet();
});

// AirPlay option
airplayOption.addEventListener('click', () => {
  closeSheet();
  if (audio.remote && typeof audio.remote.prompt === 'function') {
    audio.remote.prompt().catch(() => showToast('No AirPlay devices found nearby.'));
  } else {
    showToast('AirPlay is available in Safari on Apple devices.');
  }
});

// Chromecast option
castOption.addEventListener('click', () => { closeSheet(); triggerCast(); });

// ── Stream button: show/hide + smart routing ──────────────────────
let airplayAvail = false;
let castAvail    = false;

function updateStreamBtn() {
  const any = airplayAvail || castAvail;
  streamBtn.disabled = !any;
  streamBtn.classList.toggle('disabled', !any);
}

function triggerAirPlay() {
  audio.remote.prompt().catch(() => showToast('No AirPlay devices found nearby.'));
}

function triggerCast() {
  cast.framework.CastContext.getInstance()
    .requestSession()
    .catch(err => { if (err !== 'cancel') showToast('Could not connect to Chromecast.'); });
}

streamBtn.addEventListener('click', () => {
  if (airplayAvail && castAvail) { openSheet(); return; }
  if (airplayAvail) { triggerAirPlay(); return; }
  if (castAvail)    { triggerCast();    return; }
});

// AirPlay availability
if (audio.remote && typeof audio.remote.watchAvailability === 'function') {
  audio.remote.watchAvailability(avail => {
    airplayAvail = avail;
    updateStreamBtn();
  }).catch(() => {});
}

// ── Chromecast (background) ───────────────────────────────────────
let castReady          = false;
let castVolumeHandler  = null;
window['__onGCastApiAvailable'] = function (ok) {
  castReady = ok;
  if (!ok) return;
  if (typeof cast === 'undefined') {
    setTimeout(() => window['__onGCastApiAvailable'](ok), 100);
    return;
  }
  const ctx = cast.framework.CastContext.getInstance();
  ctx.setOptions({
    receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy:        chrome.cast.AutoJoinPolicy.TAB_AND_ORIGIN_SCOPED,
  });
  // SDK loaded — assume Cast is available until discovery says otherwise
  castAvail = true;
  updateStreamBtn();
  ctx.addEventListener(
    cast.framework.CastContextEventType.CAST_STATE_CHANGED,
    evt => {
      castAvail = evt.castState !== cast.framework.CastState.NO_DEVICES_AVAILABLE;
      updateStreamBtn();
      if (evt.castState === cast.framework.CastState.CONNECTED) {
        castingActive = true;
        // Silence local audio without clearing src (keeps OS media session alive)
        audio.pause();
        audio.muted = true;
        const session    = ctx.getCurrentSession();
        syncSliderToReceiver(session);
        castVolumeHandler = () => syncSliderToReceiver(ctx.getCurrentSession());
        session.addEventListener(cast.framework.SessionEventType.VOLUME_CHANGED, castVolumeHandler);
        const alreadyPlaying = session && session.getMediaSession();
        if (alreadyPlaying) {
          // Rejoined an existing cast — just sync UI and resume polling
          setPlayState(true);
          pollAndSchedule();
        } else {
          setPlayState(false);
          stopPolling();
          setLoading(true);
          castStream();
        }
      }
      if (evt.castState === cast.framework.CastState.NOT_CONNECTED) {
        const prevSession = ctx.getCurrentSession();
        if (prevSession && castVolumeHandler) {
          prevSession.removeEventListener(cast.framework.SessionEventType.VOLUME_CHANGED, castVolumeHandler);
          castVolumeHandler = null;
        }
        castingActive = false;
        audio.muted   = false;
        audio.volume  = localVolume;
        volumeSlider.value = localVolume;
        updateSlider();
        stopPlay();
      }
    }
  );
};

function castStream() {
  const session = cast.framework.CastContext.getInstance().getCurrentSession();
  if (!session) return;
  const info       = new chrome.cast.media.MediaInfo(cfg.streamUrl, 'audio/mpeg');
  info.streamType  = chrome.cast.media.StreamType.LIVE;
  const meta       = new chrome.cast.media.MusicTrackMediaMetadata();
  meta.title       = currentTitle  || 'Studio Raheem';
  meta.artistName  = currentArtist || 'Studio Raheem';
  meta.albumName   = currentAlbum  || '';
  if (currentArtUrl) meta.images = [new chrome.cast.Image(currentArtUrl)];
  info.metadata    = meta;
  session.loadMedia(new chrome.cast.media.LoadRequest(info))
    .then(() => { setPlayState(true); pollAndSchedule(); })
    .catch(err => { console.error(err); setPlayState(false); });
}

function castStop() {
  const session = cast.framework.CastContext.getInstance().getCurrentSession();
  if (!session) return;
  const media = session.getMediaSession();
  const done  = () => { setPlayState(false); stopPolling(); };
  if (media) media.stop(null, done, err => { console.error(err); done(); });
  else done();
}

// ── Toast ─────────────────────────────────────────────────────────
function showToast(msg, ms = 3500) {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), ms);
}

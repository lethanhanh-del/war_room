// Chuông kim loại đa hài (Web Audio API) cho Waiting Point — không cần file âm thanh ngoài.

let audioCtx = null;
let unlocked = false;

export function isAudioUnlocked() {
  return unlocked;
}

export function unlockAudio(onUnlock) {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  if (!audioCtx) return null;

  if (audioCtx.state === 'suspended') {
    audioCtx
      .resume()
      .then(() => {
        if (audioCtx && audioCtx.state === 'running' && !unlocked) {
          unlocked = true;
          if (onUnlock) onUnlock();
        }
      })
      .catch(() => {});
  } else if (audioCtx.state === 'running' && !unlocked) {
    unlocked = true;
    if (onUnlock) onUnlock();
  }
  return audioCtx;
}

function strikeBell(ctx, startAt, baseFreq, volume = 0.2, decay = 0.55) {
  const harmonics = [
    { mult: 1.0, amp: 1.0, dec: decay },
    { mult: 2.02, amp: 0.45, dec: decay * 0.65 },
    { mult: 3.18, amp: 0.2, dec: decay * 0.4 },
  ];
  for (const h of harmonics) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq * h.mult, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(volume * h.amp, startAt + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + h.dec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + h.dec + 0.03);
  }
}

export function playBell(kind, enabled = true, onUnlock) {
  if (!enabled) return;
  try {
    const ctx = unlockAudio(onUnlock);
    if (!ctx) return;
    const now = ctx.currentTime + 0.01;

    if (kind === 'new') {
      // DING-DONG! rõ ràng mỗi khi có task mới lên Sheet
      strikeBell(ctx, now, 880, 0.24, 0.55);
      strikeBell(ctx, now + 0.22, 1174.66, 0.26, 0.72);
    } else if (kind === 'assigned') {
      strikeBell(ctx, now, 783.99, 0.18, 0.4);
      strikeBell(ctx, now + 0.14, 1046.5, 0.2, 0.52);
    } else if (kind === 'burn') {
      // 3 tiếng chuông báo động quá hạn
      strikeBell(ctx, now, 987.77, 0.24, 0.22);
      strikeBell(ctx, now + 0.18, 987.77, 0.24, 0.22);
      strikeBell(ctx, now + 0.36, 1318.51, 0.26, 0.55);
    } else if (kind === 'clear') {
      // Hợp âm sáng khi xử lý xong
      strikeBell(ctx, now, 783.99, 0.2, 0.38);
      strikeBell(ctx, now + 0.11, 1046.5, 0.22, 0.45);
      strikeBell(ctx, now + 0.22, 1318.51, 0.25, 0.72);
    } else {
      strikeBell(ctx, now, 1046.5, 0.2, 0.45);
    }
  } catch {
    // ignore autoplay block
  }
}

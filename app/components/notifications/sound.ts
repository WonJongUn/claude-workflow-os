/**
 * 알림 사운드 — WebAudio API로 짧은 톤을 합성한다.
 *
 * 외부 mp3 파일을 추가하지 않기 위해 직접 oscillator로 합성:
 * - 짧은 chime: 두 음(880 → 1320 Hz) 100ms씩 + 부드러운 fade
 * - 사용자가 페이지에서 한 번도 인터랙션하지 않았으면 브라우저가 차단하므로 첫 재생은 시도만 하고 실패해도 무시.
 *
 * localStorage 키 'notifications.sound':
 * - 'off' 면 재생 안 함
 * - 그 외(미설정 포함)는 기본 on
 */

const STORAGE_KEY = "notifications.sound";
const VOLUME_KEY = "notifications.sound-volume";
/** 기본 볼륨 — gain peak. 1.0이면 너무 시끄러워서 0.18로 시작. */
const DEFAULT_VOLUME = 0.18;

let ctx: AudioContext | null = null;

/** 재생 가능 여부 — 사용자 설정 + 브라우저 환경. */
export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

/** 사용자 설정 갱신. */
export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // 쿼터 초과 등은 무시.
  }
}

/** 0–1 사이 gain peak. 미설정이면 DEFAULT_VOLUME. */
export function getSoundVolume(): number {
  if (typeof window === "undefined") return DEFAULT_VOLUME;
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    if (raw == null) return DEFAULT_VOLUME;
    const v = Number.parseFloat(raw);
    if (!Number.isFinite(v)) return DEFAULT_VOLUME;
    return Math.min(1, Math.max(0, v));
  } catch {
    return DEFAULT_VOLUME;
  }
}

/** 볼륨 갱신. 0–1 범위로 clamp 해서 저장. */
export function setSoundVolume(v: number): void {
  if (typeof window === "undefined") return;
  const clamped = Math.min(1, Math.max(0, v));
  try {
    window.localStorage.setItem(VOLUME_KEY, String(clamped));
  } catch {
    // 무시.
  }
}

/**
 * 짧은 chime 재생. 브라우저 autoplay 정책으로 첫 재생은 사용자 인터랙션 후에만 성공한다.
 * 정책 위반·미지원 환경은 조용히 실패.
 */
export function playNotificationSound(): void {
  if (!isSoundEnabled()) return;
  if (typeof window === "undefined") return;
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;
    const vol = getSoundVolume();
    if (vol === 0) return;
    chimeAt(ctx, now, 880, vol);
    chimeAt(ctx, now + 0.1, 1320, vol);
  } catch {
    // 어떤 이유로든 실패 시 알림 자체는 성공해야 하므로 swallow.
  }
}

/** ctx의 t시각에 freq Hz 톤을 80ms 동안 attack/release로 재생. peak는 사용자 볼륨. */
function chimeAt(ctx: AudioContext, t: number, freq: number, peak: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  // 짧은 envelope — 클릭/팝 노이즈 방지. exponentialRamp는 0이 안 되니 작은 양수로.
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peak, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.005), t + 0.08);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.09);
}

import { Platform } from 'react-native';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TING_ASSET = require('../../assets/sounds/qr-success-ting.wav') as number;

/**
 * Phát âm thanh "tin" xác nhận quét mã QR thành công trên Android, iOS (Expo Go) và Web.
 */
export async function playSuccessTing(): Promise<void> {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const playedWeb = playWebAudioChime();
    if (playedWeb) return;
  }

  try {
    const { createAudioPlayer, setAudioModeAsync } = await import('expo-audio');
    await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    const player = createAudioPlayer(TING_ASSET);
    player.volume = 1.0;
    await player.seekTo(0).catch(() => {});
    player.play();
    setTimeout(() => {
      try {
        player.remove();
      } catch {}
    }, 1500);
  } catch {
    playWebAudioChime();
  }
}

function playWebAudioChime(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return false;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const triggerNote = (freq: number, startOffset: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(0.001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.35, now + startOffset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration);
    };

    triggerNote(1318.5, 0, 0.35);
    triggerNote(1760, 0.11, 0.48);
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 900);
    return true;
  } catch {
    return false;
  }
}

import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { AppState } from 'react-native';
import { DeliveryReadResult, DeliveryReader, selectDeliveryChallenge } from './deliveryMission';

type DisplayState =
  | { status: 'syncing' | 'unavailable'; data: null }
  | { status: 'ready'; data: DeliveryReadResult };

const SYNCING: DisplayState = { status: 'syncing', data: null };

export function useDeliveryMission(reader: DeliveryReader) {
  const [state, setState] = useState<DisplayState>(SYNCING);
  const [retry, setRetry] = useState(0);

  useFocusEffect(useCallback(() => {

    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let robotId: string | undefined;

    const stop = () => {
      clearTimeout(timer);
      controller?.abort();
      controller = undefined;
      setState(SYNCING);
    };

    const poll = async () => {
      const current = new AbortController();
      controller = current;
      let delay = 2500;
      try {
        const data = await reader.read(current.signal);
        if (current.signal.aborted) return;
        if (robotId && data.robotId !== robotId) throw new Error('Delivery robot changed');
        robotId = data.robotId;
        failures = 0;
        setState({ status: 'ready', data });
        if (!data.mission) delay = 5000;
      } catch {
        if (current.signal.aborted) return;
        setState({ status: 'unavailable', data: null });
        failures += 1;
        delay = Math.min(15000, 2500 * (2 ** Math.min(failures, 3)));
      }
      timer = setTimeout(() => { void poll(); }, delay);
    };

    const start = () => {
      stop();
      failures = 0;
      void poll();
    };
    if (AppState.currentState === 'active' || AppState.currentState == null) start();
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') start();
      else stop();
    });
    return () => {
      subscription.remove();
      stop();
    };
  }, [reader, retry]));

  const mission = state.data?.mission ?? null;
  const challenge = selectDeliveryChallenge(mission, state.data?.challenge ?? null, Date.now());
  const expiresAt = challenge ? Date.parse(challenge.expiresAt) : null;
  useEffect(() => {
    if (expiresAt == null) return;
    const timer = setTimeout(() => {
      setState((previous) => previous.status === 'ready'
        && !selectDeliveryChallenge(previous.data.mission, previous.data.challenge, Date.now())
        ? { ...previous, data: { ...previous.data, challenge: null } } : previous);
    }, Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt]);

  return {
    state: state.status,
    mission,

    challenge,
    reconnect: () => setRetry((value) => value + 1),
  };
}

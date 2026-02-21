import { useAppState } from './useAppState';
import { useMemo } from 'react';

export function useSettings() {
  const state = useAppState();

  return useMemo(() => ({
    settings: state.llmSettings,
    updateSettings: state.updateLLMSettings,
  }), [state.llmSettings, state.updateLLMSettings]);
}

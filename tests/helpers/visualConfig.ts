import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useVisualConfig } from '../../src/hooks/useVisualConfig';
import type { VisualConfigValues } from '../../src/types/visualConfig';

export function runVisualConfig(yaml: string, changes: Partial<VisualConfigValues>[] = []) {
  let result: ReturnType<typeof useVisualConfig> | undefined;
  function Harness() {
    const config = useVisualConfig();
    const [phase, setPhase] = useState(0);
    if (phase === 0) {
      config.loadVisualValuesFromYaml(yaml);
      for (const change of changes) config.setVisualValues(change);
      setPhase(1);
    } else result = config;
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  if (!result) throw new Error('Visual config harness did not render');
  return result;
}

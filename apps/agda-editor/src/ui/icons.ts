/**
 * Icons — inline SVGs stroked like Lucide (paths from lucide.dev,
 * ISC license), so the panel needs no icon dependency.
 */

function icon(paths: string[], title?: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (title !== undefined) {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    t.textContent = title;
    svg.append(t);
  }
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** file-text — the file currently being edited */
export function fileIcon(): SVGSVGElement {
  return icon(
    [
      'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z',
      'M14 2v4a2 2 0 0 0 2 2h4',
      'M10 9H8',
      'M16 13H8',
      'M16 17H8',
    ],
    'The file currently being edited',
  );
}

/** server — the backend's Agda Language Server process */
export function serverIcon(): SVGSVGElement {
  return icon(
    [
      'M4 2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z',
      'M4 14h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z',
      'M6 6h.01',
      'M6 18h.01',
    ],
    'Backend: Agda Language Server (ALS)',
  );
}

/** circle-play */
export function playIcon(): SVGSVGElement {
  return icon([
    'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10Z',
    'm10 8 6 4-6 4V8Z',
  ]);
}

/** circle-pause */
export function pauseIcon(): SVGSVGElement {
  return icon([
    'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10Z',
    'M10 9v6',
    'M14 9v6',
  ]);
}

/** bug */
export function bugIcon(): SVGSVGElement {
  return icon(
    [
      'm8 2 1.88 1.88',
      'M14.12 3.88 16 2',
      'M9 7.13v-1a3.003 3.003 0 1 1 6 0v1',
      'M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6',
      'M12 20v-9',
      'M6.53 9C4.6 8.8 3 7.1 3 5',
      'M6 13H2',
      'M3 21c0-2.1 1.7-3.9 3.8-4',
      'M20.97 5c0 2.1-1.6 3.8-3.5 4',
      'M22 13h-4',
      'M17.2 17c2.1.1 3.8 1.9 3.8 4',
    ],
    'Errors found',
  );
}

/** triangle-alert — the module's warnings */
export function warningIcon(): SVGSVGElement {
  return icon(
    [
      'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 20h16a2 2 0 0 0 1.73-2Z',
      'M12 9v4',
      'M12 17h.01',
    ],
    'Warnings found',
  );
}

/** trophy */
export function trophyIcon(): SVGSVGElement {
  return icon(
    [
      'M6 9H4.5a2.5 2.5 0 0 1 0-5H6',
      'M18 9h1.5a2.5 2.5 0 0 0 0-5H18',
      'M4 22h16',
      'M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22',
      'M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22',
      'M18 2H6v7a6 6 0 0 0 12 0V2Z',
    ],
    'Type-checked, no errors',
  );
}

/** save — write the document to local storage */
export function saveIcon(): SVGSVGElement {
  return icon(
    [
      'M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
      'M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7',
      'M7 3v4a1 1 0 0 0 1 1h7',
    ],
    'Save the file',
  );
}

/** panel-right — toggle the sidebar */
export function panelRightIcon(): SVGSVGElement {
  return icon(
    ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M15 3v18'],
    'Toggle the sidebar',
  );
}

/** panel-bottom — toggle the events dock */
export function panelBottomIcon(): SVGSVGElement {
  return icon(
    ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M3 15h18'],
    'Toggle the events panel',
  );
}

/** command — the command palette */
export function commandIcon(): SVGSVGElement {
  return icon(
    [
      'M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z',
    ],
    'Command palette',
  );
}

/** sun — the light theme */
export function sunIcon(): SVGSVGElement {
  return icon(
    [
      'M12 16a4 4 0 1 0 0-8 4 4 0 1 0 0 8Z',
      'M12 2v2',
      'M12 20v2',
      'm4.93 4.93 1.41 1.41',
      'm17.66 17.66 1.41 1.41',
      'M2 12h2',
      'M20 12h2',
      'm6.34 17.66-1.41 1.41',
      'm19.07 4.93-1.41 1.41',
    ],
    'Color theme: light',
  );
}

/** moon — the dark theme */
export function moonIcon(): SVGSVGElement {
  return icon(['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'], 'Color theme: dark');
}

/** monitor — following the system theme */
export function monitorIcon(): SVGSVGElement {
  return icon(
    [
      'M5 3h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
      'M12 17v4',
      'M8 21h8',
    ],
    'Color theme: follow the system',
  );
}

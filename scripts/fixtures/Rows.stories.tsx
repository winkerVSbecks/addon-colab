// A check-only story (not in the addon's example stories): a list of rows that each have a
// "Delete" button, with buttons that prepend a row and reverse the order (a keyed reorder).
// Used by scripts/check-board-comments-match.mjs.
import React, { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

function Rows() {
  const [rows, setRows] = useState(['Row A', 'Row B', 'Row C', 'Row D']);
  return (
    <div style={{ fontFamily: 'sans-serif', padding: 16 }}>
      <button type="button" data-action="prepend" onClick={() => setRows((r) => [`Row ${r.length}`, ...r])}>
        Prepend
      </button>{' '}
      <button type="button" data-action="reverse" onClick={() => setRows((r) => [...r].reverse())}>
        Reverse
      </button>
      <ul className="rows">
        {rows.map((row) => (
          <li key={row}>
            <span>{row}</span> <button type="button">Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const meta = { title: 'Checks/Rows', component: Rows } satisfies Meta<typeof Rows>;
export default meta;
export const Default: StoryObj<typeof meta> = {};

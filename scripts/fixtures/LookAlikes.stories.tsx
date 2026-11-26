// Check-only stories (not in the addon's example stories) full of look-alike elements, each with
// buttons (`data-action`) that change the story the way an app would: filter or reorder a list,
// remove a card or one of two "Save" buttons, swap or move an element. Used by
// scripts/check-board-comments-lookalikes.mjs (a pin never attaches to a look-alike).
import React, { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

const box: React.CSSProperties = { fontFamily: 'sans-serif', fontSize: 14, padding: 12 };
const actionsStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 28 };

function Action({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button type="button" data-action={name} onClick={onClick}>
      {name}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// Rows with a "Delete" each. Keyed by row id, or by index (React then rewrites rows in place).

interface Row {
  id: string;
  label: string;
}
const START: Row[] = ['A', 'B', 'C', 'D'].map((id) => ({ id, label: `Row ${id}` }));

function Rows({ keyed }: { keyed: boolean }) {
  const [rows, setRows] = useState(START);
  const [next, setNext] = useState(0);
  const only = (ids: string[]) => setRows((r) => r.filter((row) => ids.includes(row.id)));
  return (
    <div style={box}>
      <div style={actionsStyle}>
        <Action
          name="prepend"
          onClick={() => {
            setRows((r) => [{ id: `n${next}`, label: `Row ${next}` }, ...r]);
            setNext((n) => n + 1);
          }}
        />
        <Action name="reverse" onClick={() => setRows((r) => [...r].reverse())} />
        <Action name="remove-b" onClick={() => setRows((r) => r.filter((row) => row.id !== 'B'))} />
        <Action name="remove-c" onClick={() => setRows((r) => r.filter((row) => row.id !== 'C'))} />
        <Action name="only-c-d" onClick={() => only(['C', 'D'])} />
        <Action name="only-d" onClick={() => only(['D'])} />
        <Action
          name="rename-c"
          onClick={() => setRows((r) => r.map((row) => (row.id === 'C' ? { ...row, label: 'Row B' } : row)))}
        />
        <Action name="reset" onClick={() => setRows(START)} />
      </div>
      <ul className="rows" style={{ margin: 0, paddingLeft: 20 }}>
        {rows.map((row, index) => (
          <li key={keyed ? row.id : index} style={{ marginBottom: 6 }}>
            <span>{row.label}</span> <button type="button">Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Cards with an icon-only Close button that removes the card.

const CARDS = ['Alpha', 'Beta'];

function Cards() {
  const [cards, setCards] = useState(CARDS);
  return (
    <div style={box}>
      <div style={actionsStyle}>
        <Action name="reset" onClick={() => setCards(CARDS)} />
      </div>
      {cards.map((card) => (
        <div
          key={card}
          className="card"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            border: '1px solid #ccc',
            padding: 8,
            marginBottom: 12,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 14 }}>{card}</h3>
          <button
            type="button"
            className="close"
            aria-label="Close"
            onClick={() => setCards((c) => c.filter((name) => name !== card))}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Two "Save" buttons: in a header and a footer, side by side with classes, or plain siblings.

type SavesVariant = 'header-footer' | 'classed' | 'siblings';

function Saves({ variant }: { variant: SavesVariant }) {
  const [first, setFirst] = useState(true);
  const [second, setSecond] = useState(true);
  const [ids, setIds] = useState([1, 2]);
  const reset = () => {
    setFirst(true);
    setSecond(true);
    setIds([1, 2]);
  };
  const removeFirst = () => (variant === 'siblings' ? setIds((i) => i.slice(1)) : setFirst(false));
  const removeSecond = () => (variant === 'siblings' ? setIds((i) => i.slice(0, 1)) : setSecond(false));
  return (
    <div style={box}>
      <div style={actionsStyle}>
        <Action name="remove-first" onClick={removeFirst} />
        <Action name="remove-second" onClick={removeSecond} />
        {variant === 'siblings' && (
          <Action name="prepend" onClick={() => setIds((i) => [Math.max(...i, 0) + 1, ...i])} />
        )}
        <Action name="reset" onClick={reset} />
      </div>
      {variant === 'header-footer' && (
        <>
          <header style={{ marginBottom: 24 }}>
            <span>Profile</span>{' '}
            {first && (
              <button type="button" className="save-top">
                Save
              </button>
            )}
          </header>
          <p>Body</p>
          <footer>
            <span>©</span> {second && <button type="button">Save</button>}
          </footer>
        </>
      )}
      {variant === 'classed' && (
        <div className="bar" style={{ display: 'flex', gap: 24 }}>
          {first && (
            <button type="button" className="a">
              Save
            </button>
          )}
          {second && (
            <button type="button" className="b">
              Save
            </button>
          )}
        </div>
      )}
      {variant === 'siblings' && (
        <div className="bar" style={{ display: 'flex', gap: 24 }}>
          {ids.map((id) => (
            <button key={id} type="button">
              Save
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// A unique button that moves, a Submit swapped for a disabled secondary one, and pairs of
// unlabeled inputs, images and boxes (the first of each can be removed).

const DOT =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="20" height="20"%3E%3Ccircle cx="10" cy="10" r="9" fill="%23888"/%3E%3C/svg%3E';
const boxStyle: React.CSSProperties = { width: 40, height: 20, border: '1px solid #888' };

function Misc() {
  const [moved, setMoved] = useState(false);
  const [swapped, setSwapped] = useState(false);
  const [input, setInput] = useState(true);
  const [image, setImage] = useState(true);
  const [square, setSquare] = useState(true);
  const go = (
    <button type="button" className="go">
      Go
    </button>
  );
  return (
    <div style={box}>
      <div style={actionsStyle}>
        <Action name="move" onClick={() => setMoved(true)} />
        <Action name="swap" onClick={() => setSwapped(true)} />
        <Action name="remove-input" onClick={() => setInput(false)} />
        <Action name="remove-image" onClick={() => setImage(false)} />
        <Action name="remove-box" onClick={() => setSquare(false)} />
      </div>
      <div style={{ display: 'flex', gap: 24, marginBottom: 24 }}>
        <div className="left" style={{ minWidth: 60 }}>
          {!moved && go}
        </div>
        <div className="right" style={{ minWidth: 60 }}>
          {moved && go}
        </div>
        <form onSubmit={(event) => event.preventDefault()}>
          {swapped ? (
            <button type="button" className="secondary" disabled>
              Submit
            </button>
          ) : (
            <button type="submit" className="primary">
              Submit
            </button>
          )}
        </form>
      </div>
      <div className="inputs" style={{ display: 'flex', gap: 24, marginBottom: 24 }}>
        {input && <input type="text" style={{ width: 80 }} />}
        <input type="text" style={{ width: 80 }} />
      </div>
      <div className="images" style={{ display: 'flex', gap: 24, marginBottom: 24 }}>
        {image && <img src={DOT} />}
        <img src={DOT} />
      </div>
      <div className="boxes" style={{ display: 'flex', gap: 24 }}>
        {square && <div className="box" style={boxStyle} />}
        <div className="box" style={boxStyle} />
      </div>
    </div>
  );
}

const meta = { title: 'Checks/Look-alikes', component: Rows } satisfies Meta<typeof Rows>;
export default meta;
type Story = StoryObj<typeof meta>;

export const KeyedRows: Story = { args: { keyed: true } };
export const UnkeyedRows: Story = { args: { keyed: false } };
export const CardList: Story = { args: { keyed: true }, render: () => <Cards /> };
export const HeaderFooterSaves: Story = { args: { keyed: true }, render: () => <Saves variant="header-footer" /> };
export const ClassedSaves: Story = { args: { keyed: true }, render: () => <Saves variant="classed" /> };
export const SiblingSaves: Story = { args: { keyed: true }, render: () => <Saves variant="siblings" /> };
export const Moves: Story = { args: { keyed: true }, render: () => <Misc /> };

// I/O solo-Node: legge board.json / festival.json da disco. Il browser fa fetch + makeBoard.
import { readFileSync } from 'node:fs';
import { makeBoard } from './engine.js';

export const loadBoard = (path = new URL('./board.json', import.meta.url)) =>
  makeBoard(JSON.parse(readFileSync(path, 'utf8')));

export const loadFestival = (path = new URL('./festival.json', import.meta.url)) =>
  JSON.parse(readFileSync(path, 'utf8'));

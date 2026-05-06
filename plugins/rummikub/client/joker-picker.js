import { COLORS } from './tiles.js';

let pickerEl = null;
let valuesEl = null;
let applyBtn = null;
let activeTile = null;
let activeOnApply = null;
let selectedColor = null;
let selectedValue = null;

export function initJokerPicker() {
  pickerEl = document.getElementById('joker-picker');
  if (!pickerEl) return;
  valuesEl = pickerEl.querySelector('.jp-values');
  applyBtn = pickerEl.querySelector('#jp-apply');

  if (!valuesEl.children.length) {
    for (let v = 1; v <= 13; v++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'jp-value';
      b.textContent = v;
      b.dataset.value = v;
      valuesEl.appendChild(b);
    }
  }

  pickerEl.addEventListener('click', (e) => {
    if (e.target === pickerEl) close();
    const colorBtn = e.target.closest('.jp-color');
    if (colorBtn) selectColor(colorBtn.dataset.color);
    const valueBtn = e.target.closest('.jp-value');
    if (valueBtn) selectValue(Number(valueBtn.dataset.value));
    if (e.target.id === 'jp-cancel') close();
    if (e.target.id === 'jp-apply') apply();
    if (e.target.id === 'jp-clear') clearAndClose();
  });

  document.addEventListener('keydown', (e) => {
    if (pickerEl.classList.contains('hidden')) return;
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && !applyBtn.disabled) apply();
  });
}

export function openJokerPicker(tile, onApply) {
  if (!pickerEl) initJokerPicker();
  activeTile = tile;
  activeOnApply = onApply;
  selectedColor = COLORS.includes(tile.representsColor) ? tile.representsColor : null;
  selectedValue = (Number.isInteger(tile.representsValue) && tile.representsValue >= 1 && tile.representsValue <= 13)
    ? tile.representsValue
    : null;
  refreshSelection();
  pickerEl.classList.remove('hidden');
}

function selectColor(color) {
  if (!COLORS.includes(color)) return;
  selectedColor = color;
  refreshSelection();
}

function selectValue(value) {
  if (!Number.isInteger(value) || value < 1 || value > 13) return;
  selectedValue = value;
  refreshSelection();
}

function refreshSelection() {
  for (const el of pickerEl.querySelectorAll('.jp-color')) {
    el.classList.toggle('selected', el.dataset.color === selectedColor);
  }
  for (const el of valuesEl.children) {
    el.classList.toggle('selected', Number(el.dataset.value) === selectedValue);
  }
  applyBtn.disabled = !(selectedColor && selectedValue);
}

function apply() {
  if (!activeTile || !selectedColor || !selectedValue) return;
  activeTile.representsColor = selectedColor;
  activeTile.representsValue = selectedValue;
  const cb = activeOnApply;
  close();
  cb?.();
}

function clearAndClose() {
  if (activeTile) {
    delete activeTile.representsColor;
    delete activeTile.representsValue;
  }
  const cb = activeOnApply;
  close();
  cb?.();
}

function close() {
  pickerEl.classList.add('hidden');
  activeTile = null;
  activeOnApply = null;
  selectedColor = null;
  selectedValue = null;
}

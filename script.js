const display = document.getElementById('display');
const history = document.getElementById('history');

function appendValue(value) {
  display.value += value;
}

function clearDisplay() {
  display.value = '';
  history.textContent = '';
}

function backspace() {
  display.value = display.value.slice(0, -1);
}

function toggleSign() {
  if (display.value) {
    display.value = display.value.startsWith('-')
      ? display.value.slice(1)
      : '-' + display.value;
  }
}

function calculateResult() {
  try {
    history.textContent = display.value;
    display.value = eval(display.value.replace('%', '/100'));
  } catch {
    display.value = 'Error';
  }
}

function toggleTheme() {
  document.body.classList.toggle('light');
}

document.addEventListener('keydown', e => {
  if (/[0-9+\-*/.]/.test(e.key)) appendValue(e.key);
  if (e.key === 'Enter') calculateResult();
  if (e.key === 'Backspace') backspace();
  if (e.key === 'Escape') clearDisplay();
});


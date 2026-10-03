const host = document.getElementById('probes');
const rows = [...host.querySelectorAll('details')];
const filters = [...document.querySelectorAll('[data-filter]')];
const toggle = document.getElementById('toggle-all');
const counter = document.getElementById('corpus-count');
const visible = () => rows.filter(row => !row.hidden);
function syncToggle() {
  const shown = visible();
  toggle.textContent = shown.length && shown.every(row => row.open) ? 'Close all' : 'Open all';
}
filters.forEach(button => button.addEventListener('click', () => {
  const active = button.dataset.filter;
  filters.forEach(other => other.setAttribute('aria-pressed', String(other === button)));
  rows.forEach(row => {row.hidden = active !== 'all' && (active === 'profile' ? row.dataset.profile !== 'true' : row.dataset.class !== active);});
  const count = visible().length;
  counter.textContent = `${count} ${count === 1 ? 'probe' : 'probes'}`;
  syncToggle();
}));
toggle.addEventListener('click', () => {
  const opening = toggle.textContent === 'Open all';
  visible().forEach(row => {row.open = opening;});
  syncToggle();
});
rows.forEach(row => row.addEventListener('toggle', syncToggle));

(function () {
  const search = document.getElementById('selection-search');
  const status = document.getElementById('selection-status');
  const rows = Array.from(document.querySelectorAll('#selection-table tbody tr'));
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const names = rows.map(row => normalize(row.querySelector('th').textContent));
  function filter() {
    const query = normalize(search.value);
    let count = 0;
    rows.forEach((row, index) => {
      const visible = names[index].includes(query) && (status.value === 'all' || status.value === row.dataset.status);
      row.hidden = !visible;
      if (visible) count++;
    });
    document.getElementById('selection-count').textContent = count + (count === 1 ? ' \u00e1rea' : ' \u00e1reas');
    document.getElementById('selection-empty').hidden = count !== 0;
  }
  search.addEventListener('input', filter);
  status.addEventListener('change', filter);
})();

// Token Launch Radar — the board's behaviour. Reads window.RADAR (written
// beside dashboard/ by main.ts) and renders the ranked board, its filters and
// the per-protocol detail view: facts, the model's own arithmetic for that
// protocol, and its farm plan. No network: every byte shown comes from data.js.

(function () {
  'use strict';
  var DATA = window.RADAR;
  var rows = DATA.rows.slice();
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  var state = { q: '', cat: '', chain: '', mintvl: 0, watch: false, sort: 'rank', selected: null };

  function $(id) { return document.getElementById(id); }
  function money(usd) {
    if (usd >= 1e9) return '$' + (usd / 1e9).toFixed(2) + 'B';
    if (usd >= 1e6) return '$' + (usd / 1e6).toFixed(1) + 'M';
    if (usd >= 1e3) return '$' + Math.round(usd / 1e3) + 'K';
    return '$' + usd;
  }
  function pct(v) {
    if (v === null || v === undefined) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Masthead statistics.
  $('stats').innerHTML =
    '<div><dt>Protocols scanned</dt><dd>' + DATA.protocol_count + '</dd></div>' +
    '<div><dt>On the board</dt><dd>' + rows.length + '</dd></div>' +
    '<div><dt>Watchlist covered</dt><dd>' + DATA.watchlist_count + ' / ' + DATA.watchlist_count + '</dd></div>' +
    '<div><dt>Already trading</dt><dd>' + DATA.live_count + '</dd></div>' +
    '<div><dt>Snapshot</dt><dd>' + esc(DATA.as_of) + '</dd></div>';
  $('foot').textContent =
    'Source: DefiLlama snapshot of ' + DATA.as_of + ' (' + DATA.protocol_count + ' protocols at or above $5M TVL). ' +
    'The watchlist floor is ' + money(DATA.floor_usd) + '; every watchlist protocol is on the board. ' +
    DATA.live_count + ' protocols already record a token and are set aside as the peer set the multiples come from.';

  // Category multiples strip: the model's peer table, shown not hidden.
  var chips = DATA.multiples.slice(0, 10).map(function (m) {
    return '<span class="chip">' + esc(m.category) + ' <b>' + m.multiple.toFixed(2) + '&times;</b> · ' + m.peers + (m.peers === 1 ? ' peer' : ' peers') + '</span>';
  });
  chips.push('<span class="chip global">Global median <b>' + DATA.global_multiple.toFixed(2) + '&times;</b></span>');
  $('multiples').innerHTML = chips.join('');

  // Filter option lists, built from the board itself.
  var cats = {}, chains = {};
  rows.forEach(function (r) {
    if (r.category) cats[r.category] = true;
    r.chains.forEach(function (c) { chains[c] = true; });
  });
  $('cat').innerHTML = '<option value="">All categories</option>' + Object.keys(cats).sort().map(function (c) {
    return '<option>' + esc(c) + '</option>';
  }).join('');
  $('chain').innerHTML = '<option value="">All chains</option>' + Object.keys(chains).sort().map(function (c) {
    return '<option>' + esc(c) + '</option>';
  }).join('');

  function visible() {
    var out = rows.filter(function (r) {
      if (state.watch && !r.watchlisted) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.mintvl) return false;
      if (state.q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase();
        if (hay.indexOf(state.q) < 0) return false;
      }
      return true;
    });
    var key = state.sort;
    out.sort(function (a, b) {
      if (key === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (key === 'change') return (b.change_7d || -999) - (a.change_7d || -999);
      if (key === 'age') return (b.age_years || -1) - (a.age_years || -1);
      if (key === 'name') return a.name < b.name ? -1 : 1;
      return a.rank - b.rank;
    });
    return out;
  }

  function render() {
    var list = visible();
    $('empty').hidden = list.length > 0;
    $('rows').innerHTML = list.map(function (r) {
      var age = r.age_years === null ? '—' : r.age_years.toFixed(1) + 'y';
      var badge = r.watchlisted ? '<span class="badge">Watchlist</span>' : '';
      var child = r.child_of ? '<span class="badge child">Child of ' + esc(r.child_of) + '</span>' : '';
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="selected"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' + badge + child +
        '<br><span class="pslug">' + esc(r.slug) + ' · ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + '</span></td>' +
        '<td>' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : '') + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num implied">' + money(r.implied_value_usd) + '</td>' +
        '<td class="num">' + age + '</td></tr>';
    }).join('');
    Array.prototype.forEach.call($('rows').children, function (tr) {
      tr.addEventListener('click', function () { select(tr.getAttribute('data-slug')); });
    });
  }

  function factor(label, value, width, warn) {
    return '<div class="factor"><div class="frow"><span class="fname">' + label + '</span>' +
      '<span class="fval">' + value + '</span></div><div class="bar"><div class="fill' + (warn ? ' warn' : '') +
      '" style="width:' + Math.max(2, Math.min(100, width)) + '%"></div></div></div>';
  }

  function select(slug) {
    state.selected = slug;
    var r = bySlug[slug];
    if (!r) { $('detail').innerHTML = ''; render(); return; }
    var base = r.tvl_usd * r.multiple;
    var html = '<h2>' + esc(r.name) + '</h2>' +
      '<p class="sub">#' + r.rank + ' · ' + esc(r.slug) + (r.watchlisted ? ' · on the house watchlist' : '') + '</p>' +
      '<dl class="facts">' +
      '<div><dt>TVL</dt><dd>' + money(r.tvl_usd) + '</dd></div>' +
      '<div><dt>7-day change</dt><dd>' + pct(r.change_7d) + '</dd></div>' +
      '<div><dt>Category</dt><dd>' + esc(r.category || 'Uncategorised') + '</dd></div>' +
      '<div><dt>Tracked since</dt><dd>' + (r.listed_at || 'unreported') + '</dd></div>' +
      '<div><dt>Chains</dt><dd>' + r.chains.length + '</dd></div>' +
      '<div><dt>Token recorded</dt><dd>none</dd></div></dl>' +
      '<p class="hint">Deployed on ' + esc(r.chains.join(', ') || 'one chain') + '.</p>' +
      '<h3>How this value is built</h3>' +
      factor('TVL &times; ' + (r.category || 'global') + ' peer multiple (' + r.peers + ' tokenized peer' + (r.peers === 1 ? '' : 's') + ')', money(base), 62) +
      factor('Momentum, 7d ' + pct(r.change_7d), r.momentum.toFixed(2) + '&times;', (r.momentum - 0.8) * 200) +
      factor('Tokenless age' + (r.age_years === null ? ' (unreported)' : ', ' + r.age_years.toFixed(1) + ' years'), r.age_factor.toFixed(2) + '&times;', (r.age_factor - 1) * 220) +
      factor('Chain reach, ' + r.chains.length + ' chains', r.reach_factor.toFixed(2) + '&times;', (r.reach_factor - 1) * 260);
    if (r.child_of) {
      html += factor('Child of ' + esc(r.child_of) + ' — value accrues to the parent', r.child_factor.toFixed(2) + '&times;', 35, true) +
        '<p class="note">' + esc(r.name) + ' is a version of ' + esc(r.child_of) + ', whose token already trades. ' +
        'The radar still prices it, discounted: a separate launch is the less likely path.</p>';
    }
    html += '<div class="total"><span>Implied value</span><span class="tval">' + money(r.implied_value_usd) + '</span></div>' +
      '<h3>Farm plan</h3><ol class="steps">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol>';
    $('detail').innerHTML = html;
    render();
  }

  $('q').addEventListener('input', function (e) { state.q = e.target.value.trim().toLowerCase(); render(); });
  $('cat').addEventListener('change', function (e) { state.cat = e.target.value; render(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; render(); });
  $('mintvl').addEventListener('change', function (e) { state.mintvl = Number(e.target.value); render(); });
  $('watch').addEventListener('change', function (e) { state.watch = e.target.checked; render(); });
  $('sort').addEventListener('change', function (e) { state.sort = e.target.value; render(); });

  render();
  if (rows.length > 0) select(rows[0].slug);
})();

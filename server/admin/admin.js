(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var state = { page: 1, pages: 1 };
  var inr = function (paise) { return '\u20B9' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); };
  var ist = function (iso) { return iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''; };

  // Everything from the server is inserted with textContent, never innerHTML.
  function el(tag, props, kids) {
    var e = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) { if (k === 'class') e.className = props[k]; else e.setAttribute(k, props[k]); });
    (kids || []).forEach(function (c) { e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function api(path, opt) {
    opt = opt || {};
    return fetch('/admin/api' + path, { method: opt.body ? 'POST' : 'GET', headers: opt.body ? { 'Content-Type': 'application/json' } : {}, body: opt.body ? JSON.stringify(opt.body) : undefined, credentials: 'same-origin' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (r.status === 401 && path !== '/login') { showLogin(); throw new Error('auth'); } if (!r.ok) throw new Error(j.error || 'Request failed'); return j; }); });
  }
  function showLogin() { $('#app').hidden = true; $('#login').hidden = false; }
  function showApp() { $('#login').hidden = true; $('#app').hidden = false; }

  function query() {
    var p = new URLSearchParams();
    if ($('#fq').value.trim()) p.set('q', $('#fq').value.trim());
    if ($('#fs').value) p.set('status', $('#fs').value);
    if ($('#ffrom').value) p.set('from', $('#ffrom').value);
    if ($('#fto').value) p.set('to', $('#fto').value);
    return p;
  }

  function loadSummary() {
    return api('/summary').then(function (s) {
      var m = $('#mode'); m.textContent = s.mode === 'live' ? 'LIVE MODE' : s.mode === 'test' ? 'TEST MODE' : 'PAYMENTS OFF'; m.className = 'badge ' + (s.mode || '');
      var items = [['Collected (paid)', inr(s.collectedPaise)], ['Paid bookings', s.by.paid.count], ['Pending', s.by.pending.count], ['Failed', s.by.failed.count], ['Expired', s.by.expired.count], ['Refunded', s.by.refunded.count]];
      var box = $('#cards'); box.textContent = '';
      items.forEach(function (i) { box.appendChild(el('div', { class: 'card' }, [el('b', {}, [String(i[1])]), el('span', {}, [i[0]])])); });
    });
  }

  function loadRows() {
    var p = query(); p.set('page', state.page);
    return api('/bookings?' + p.toString()).then(function (d) {
      state.pages = d.pages;
      var tb = $('#rows'); tb.textContent = '';
      d.rows.forEach(function (r) {
        var tr = el('tr', { tabindex: '0', 'data-id': r.id }, [
          el('td', {}, [ist(r.created_at)]), el('td', {}, [r.ref]), el('td', {}, [r.name]), el('td', {}, [r.mobile]),
          el('td', { class: 'wrap' }, [r.service_name]), el('td', { class: 'wrap' }, [r.package_name]),
          el('td', { class: 'wrap' }, [(r.appt_date || '') + ' ' + (r.appt_time || '')]),
          el('td', { class: 'r' }, [inr(r.amount_paise)]),
          el('td', {}, [r.payment_method || '\u2014']),
          el('td', {}, [el('span', { class: 'st ' + r.status }, [r.status])]),
          el('td', { class: 'wrap pid' }, [r.payment_id || '\u2014']),
          el('td', {}, [ist(r.paid_at) || '\u2014'])
        ]);
        tb.appendChild(tr);
      });
      $('#empty').hidden = d.rows.length > 0;
      $('#pinfo').textContent = 'Page ' + d.page + ' of ' + d.pages + ' \u00B7 ' + d.total + ' transaction' + (d.total === 1 ? '' : 's');
      $('#prev').disabled = d.page <= 1; $('#next').disabled = d.page >= d.pages;
      $('#csv').href = '/admin/api/export.csv?' + query().toString();
    });
  }
  function loadEnquiries() {
    return api('/enquiries').then(function (d) {
      var tb = $('#erows'); tb.textContent = '';
      d.rows.forEach(function (r) {
        tb.appendChild(el('tr', {}, [
          el('td', {}, [ist(r.created_at)]), el('td', {}, [r.name]), el('td', {}, [r.mobile]), el('td', { class: 'wrap' }, [r.email || '\u2014']),
          el('td', { class: 'wrap' }, [r.topic]), el('td', { class: 'wrap' }, [r.message || '\u2014']), el('td', {}, [r.source || ''])
        ]));
      });
      $('#eempty').hidden = d.rows.length > 0;
    });
  }
  function loadFreeChats() {
    var q = $('#fcq').value.trim();
    return api('/freechats' + (q ? '?q=' + encodeURIComponent(q) : '')).then(function (d) {
      var tb = $('#fcrows'); tb.textContent = '';
      d.rows.forEach(function (r) {
        var sel = el('select', { 'aria-label': 'Free chat status', 'data-id': r.id }, ['registered', 'contacted', 'completed'].map(function (s) { var o = el('option', { value: s }, [s]); if (s === r.status) o.selected = true; return o; }));
        tb.appendChild(el('tr', {}, [
          el('td', {}, [ist(r.created_at)]), el('td', { class: 'wrap' }, [r.name]), el('td', {}, [r.country_code + ' ' + r.mobile]),
          el('td', {}, [r.dob]), el('td', {}, [r.birth_time_unknown ? 'Unknown' : (r.birth_time || '\u2014')]),
          el('td', { class: 'wrap' }, [r.birth_place]), el('td', { class: 'wrap' }, [r.rashi]), el('td', { class: 'wrap' }, [r.problem_category]),
          el('td', { class: 'wrap desc' }, [r.problem_description]), el('td', {}, [sel])
        ]));
      });
      $('#fcempty').hidden = d.rows.length > 0;
      $('#fcinfo').textContent = d.rows.length + ' registration' + (d.rows.length === 1 ? '' : 's');
    });
  }
  function reload() { return Promise.all([loadSummary(), loadRows(), loadEnquiries(), loadFreeChats()]).catch(function (e) { if (e.message !== 'auth') alert(e.message); }); }

  function kv(pairs) {
    var dl = el('dl', { class: 'kv' });
    pairs.forEach(function (p) { if (p[1] === '' || p[1] == null) return; dl.appendChild(el('dt', {}, [p[0]])); dl.appendChild(el('dd', {}, [String(p[1])])); });
    return dl;
  }
  function openDetail(id) {
    api('/bookings/' + id).then(function (b) {
      $('#dt').textContent = b.name + ' \u00B7 ' + b.ref;
      var body = $('#db'); body.textContent = '';
      body.appendChild(el('h3', {}, ['Payment']));
      body.appendChild(kv([['Status', b.status], ['Amount', inr(b.amount_paise) + (b.refunded_paise ? ' (refunded ' + inr(b.refunded_paise) + ')' : '')], ['Transaction ID', b.payment_id], ['Gateway order ID', b.order_id], ['QR codes generated', b.attempts], ['Method', b.payment_method], ['Failure reason', b.failure_reason], ['Booked on', ist(b.created_at)], ['Paid on', ist(b.paid_at)], ['Mode', b.mode]]));
      body.appendChild(el('h3', {}, ['Client']));
      body.appendChild(kv([['Name', b.name], ['Mobile', b.mobile], ['Email', b.email], ['Language', b.language], ['Date of birth', b.dob], ['Time of birth', b.birth_time_unknown ? 'Unknown' : b.birth_time], ['Place of birth', b.birth_place], ['Birth country', b.birth_country]]));
      body.appendChild(el('h3', {}, ['Consultation']));
      body.appendChild(kv([['Service', b.service_name], ['Package', b.package_name + (b.package_duration ? ' (' + b.package_duration + ')' : '')], ['Date', b.appt_date], ['Time', b.appt_time]]));
      if (b.details.length) { body.appendChild(el('h3', {}, ['Client\u2019s answers'])); body.appendChild(kv(b.details)); }
      if (b.events.length) { body.appendChild(el('h3', {}, ['Payment log'])); body.appendChild(kv(b.events.map(function (e) { return [ist(e.at), e.source + ': ' + (e.event || '') + ' \u2192 ' + e.status_after + (e.note ? ' (' + e.note + ')' : '')]; }))); }
      $('#dlg').showModal();
    }).catch(function (e) { if (e.message !== 'auth') alert(e.message); });
  }

  $('#lf').addEventListener('submit', function (e) {
    e.preventDefault(); $('#le').textContent = '';
    api('/login', { body: { username: $('#lu').value, password: $('#lp').value } })
      .then(function () { $('#lp').value = ''; showApp(); return reload(); })
      .catch(function (err) { $('#le').textContent = err.message; });
  });
  $('#logout').addEventListener('click', function () { api('/logout', { body: {} }).then(showLogin); });
  $('#refresh').addEventListener('click', reload);
  $('#ff').addEventListener('submit', function (e) { e.preventDefault(); state.page = 1; reload(); });
  $('#fclear').addEventListener('click', function () { HTMLFormElement.prototype.reset.call($('#ff')); state.page = 1; reload(); });
  $('#prev').addEventListener('click', function () { if (state.page > 1) { state.page--; loadRows(); } });
  $('#next').addEventListener('click', function () { if (state.page < state.pages) { state.page++; loadRows(); } });
  $('#fcq').addEventListener('input', function () { clearTimeout(state.fct); state.fct = setTimeout(loadFreeChats, 250); });
  $('#fcrows').addEventListener('change', function (e) {
    var t = e.target; if (!t || t.tagName !== 'SELECT') return;
    api('/freechats/' + t.dataset.id + '/status', { body: { status: t.value } }).catch(function (err) { if (err.message !== 'auth') alert(err.message); loadFreeChats(); });
  });
  $('#dc').addEventListener('click', function () { $('#dlg').close(); });
  $('#rows').addEventListener('click', function (e) { var tr = e.target.closest('tr'); if (tr) openDetail(tr.dataset.id); });
  $('#rows').addEventListener('keydown', function (e) { if (e.key === 'Enter') { var tr = e.target.closest('tr'); if (tr) openDetail(tr.dataset.id); } });

  api('/me').then(function () { showApp(); return reload(); }).catch(function () { showLogin(); });
})();

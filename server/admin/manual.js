'use strict';
const tb = document.querySelector('#t tbody'), msg = document.getElementById('msg');
const td = (tr, v) => { const c = document.createElement('td'); if (v instanceof Node) c.appendChild(v); else c.textContent = v == null ? '' : v; tr.appendChild(c); };
async function act(ref, a) { await fetch(`/admin/api/manual/${ref}/${a}`, { method: 'POST' }); load(); }
async function load() {
  const r = await fetch('/admin/api/manual');
  if (r.status === 401) { msg.textContent = 'Please log in at /admin first.'; return; }
  const rows = await r.json(); tb.textContent = '';
  for (const p of rows) {
    const tr = document.createElement('tr');
    td(tr, p.ref); td(tr, p.name); td(tr, p.mobile); td(tr, p.info); td(tr, p.status);
    if (p.screenshot) { const a = document.createElement('a'); a.href = `/admin/api/manual/${p.ref}/screenshot`; a.target = '_blank'; a.textContent = 'View screenshot'; td(tr, a); } else td(tr, 'not uploaded');
    const box = document.createElement('span');
    if (p.status === 'submitted' || p.status === 'created') for (const a of ['approve', 'reject']) { const b = document.createElement('button'); b.textContent = a; b.onclick = () => act(p.ref, a); box.appendChild(b); }
    td(tr, box); tb.appendChild(tr);
  }
}
load(); setInterval(load, 15000);

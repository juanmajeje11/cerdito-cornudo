/* Supabase adapter. Empty config keeps the local demo available. */
(() => {
  const config = window.CERDITO_CONFIG || {};
  if (!config.supabaseUrl || !config.publishableKey || !window.supabase?.createClient) return;

  document.body.classList.add('auth-screen');
  const client = window.supabase.createClient(config.supabaseUrl, config.publishableKey);
  const remote = { client, restaurantId: null, ready: false, channel: null };
  let pendingRequestId = null;
  let reportPeriod = '7d';
  let reportStart = '';
  let reportEnd = '';
  window.CerditoRemote = remote;

  const escape = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const showLogin = (message = '') => {
    document.body.classList.add('auth-screen');
    content.innerHTML = `<div class="login-wrap"><form class="login-card" id="loginForm"><img class="login-logo" src="assets/logo-cerdito.jpg" alt="Cerdito Cornudo · Parrilla"><div class="eyebrow">CERDITO CORNUDO · COLOMBIA</div><h1>Bienvenido al servicio</h1><p>Ingresa con la cuenta que te asignó administración.</p>${message ? `<div class="login-error">${escape(message)}</div>` : ''}<label for="loginEmail">Correo electrónico</label><input id="loginEmail" type="email" autocomplete="username" required placeholder="tu@restaurante.com"><label for="loginPassword">Contraseña</label><input id="loginPassword" type="password" autocomplete="current-password" required><button class="btn btn-primary login-submit" type="submit">Ingresar</button><small>Si no tienes acceso, pídele una cuenta a administración.</small></form></div>`;
    $('#loginForm').onsubmit = async e => {
      e.preventDefault();
      const button = e.currentTarget.querySelector('button'); button.disabled = true; button.textContent = 'Ingresando…';
      const { error } = await client.auth.signInWithPassword({ email: $('#loginEmail').value.trim(), password: $('#loginPassword').value });
      if (error) { button.disabled = false; button.textContent = 'Ingresar'; return showLogin('No pudimos iniciar sesión. Revisa tu correo y contraseña.'); }
      await loadWorkspace();
    };
  };

  const fail = error => {
    console.error('Cerdito Cornudo:', error);
    toast(error?.message || 'No se pudo sincronizar. Intenta de nuevo.');
  };

  async function loadWorkspace() {
    const { data: { user } } = await client.auth.getUser();
    if (!user) return showLogin();
    const { data: profile, error: profileError } = await client.from('profiles')
      .select('user_id,restaurant_id,full_name,role,active').eq('user_id', user.id).single();
    if (profileError || !profile?.active) {
      await client.auth.signOut();
      return showLogin('Esta cuenta todavía no está habilitada para Cerdito Cornudo.');
    }

    const [productsRes, categoriesRes, tablesRes, ordersRes, profilesRes] = await Promise.all([
      client.from('products').select('id,category_id,name,description,price_cop,emoji,available,sort_order,categories(name)').eq('restaurant_id', profile.restaurant_id).order('sort_order'),
      client.from('categories').select('id,name,sort_order,active').eq('restaurant_id', profile.restaurant_id).order('sort_order'),
      client.from('dining_tables').select('id,label,active,sort_order').eq('restaurant_id', profile.restaurant_id).order('sort_order'),
      client.from('orders').select('id,order_number,dining_table_id,table_label,status,subtotal_cop,total_cop,created_by,created_at,closed_at,cancel_reason,order_items(id,product_id,product_name,unit_price_cop,quantity,notes)').eq('restaurant_id', profile.restaurant_id).order('created_at', { ascending: false }),
      client.from('profiles').select('user_id,full_name').eq('restaurant_id', profile.restaurant_id)
    ]);
    const failed = [productsRes,categoriesRes,tablesRes,ordersRes,profilesRes].find(x => x.error);
    if (failed) { fail(failed.error); return; }

    remote.restaurantId = profile.restaurant_id;
    remote.ready = true;
    state.role = profile.role === 'admin' ? 'Administración' : 'Mesera';
    state.currentUser = { id: profile.user_id, name: profile.full_name };
    state.categories = categoriesRes.data || [];
    state.tables = tablesRes.data || [];
    state.products = (productsRes.data || []).map(p => ({
      id: p.id, categoryId: p.category_id, category: p.categories?.name || 'Sin categoría',
      name: p.name, desc: p.description, price: Number(p.price_cop), emoji: p.emoji,
      available: p.available, sortOrder: p.sort_order
    }));
    const names = Object.fromEntries((profilesRes.data || []).map(p => [p.user_id, p.full_name]));
    state.orders = (ordersRes.data || []).map(o => ({
      uuid: o.id, id: `CC-${String(o.order_number).padStart(4, '0')}`,
      table: o.table_label, tableId: o.dining_table_id,
      items: (o.order_items || []).map(i => ({ productId: i.product_id, name: i.product_name, price: Number(i.unit_price_cop), qty: i.quantity, note: i.notes || '' })),
      total: Number(o.total_cop), status: ({ sent: 'enviado', closed: 'cerrado', cancelled: 'anulado' })[o.status],
      createdAt: o.created_at, closedAt: o.closed_at, createdBy: names[o.created_by] || 'Equipo', createdById: o.created_by,
      cancelReason: o.cancel_reason
    }));
    state.counter = (ordersRes.data?.[0]?.order_number || 0) + 1;
    document.body.classList.remove('auth-screen');
    $('#roleButton strong').textContent = profile.full_name;
    $('#roleButton .avatar').textContent = profile.full_name.split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();
    $('#roleButton .chevron').textContent = '⌄';
    $('#roleLabel').textContent = state.role;
    $('.demo-pill').innerHTML = '<i></i> EN VIVO · COMPARTIDO';
    $('.demo-pill').classList.add('online-pill');
    $('.footer-note').textContent = 'Cerdito Cornudo · Pedidos compartidos en tiempo real';
    updateCount(); render();
    if (!remote.channel) {
      remote.channel = client.channel(`cerdito-${profile.restaurant_id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${profile.restaurant_id}` }, () => refreshOrders())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: `restaurant_id=eq.${profile.restaurant_id}` }, () => loadWorkspace())
        .subscribe();
    }
  }

  async function refreshOrders() {
    if (!remote.ready) return;
    const { data, error } = await client.from('orders')
      .select('id,order_number,dining_table_id,table_label,status,subtotal_cop,total_cop,created_by,created_at,closed_at,cancel_reason,order_items(id,product_id,product_name,unit_price_cop,quantity,notes)')
      .eq('restaurant_id', remote.restaurantId).order('created_at', { ascending: false });
    if (error) return fail(error);
    const { data: profiles } = await client.from('profiles').select('user_id,full_name').eq('restaurant_id', remote.restaurantId);
    const names = Object.fromEntries((profiles || []).map(p => [p.user_id, p.full_name]));
    state.orders = (data || []).map(o => ({
      uuid:o.id,id:`CC-${String(o.order_number).padStart(4,'0')}`,table:o.table_label,tableId:o.dining_table_id,
      items:(o.order_items||[]).map(i=>({productId:i.product_id,name:i.product_name,price:Number(i.unit_price_cop),qty:i.quantity,note:i.notes||''})),
      total:Number(o.total_cop),status:({sent:'enviado',closed:'cerrado',cancelled:'anulado'})[o.status],
      createdAt:o.created_at,closedAt:o.closed_at,createdBy:names[o.created_by]||'Equipo',createdById:o.created_by,cancelReason:o.cancel_reason
    }));
    updateCount(); render();
  }

  function hookOrderScreen() {
    if (!remote.ready || view !== 'order') return;
    const availableProducts = state.products.filter(p => p.available);
    if (!availableProducts.length) {
      const empty = content.querySelector('.products .empty-state');
      if (empty) {
        empty.innerHTML = state.role === 'Administración'
          ? 'La carta todavía está vacía. <button class="btn btn-small" id="startMenuSetup">Agregar el primer producto</button>'
          : 'La carta todavía no tiene productos disponibles. Pídele a administración que la configure.';
        const setup = $('#startMenuSetup');
        if (setup) setup.onclick = () => { setView('menu'); setTimeout(() => $('#addProduct')?.click(), 0); };
      }
      const send = $('#sendOrder');
      if (send) send.disabled = true;
    }
    const cartTip = content.querySelector('.cart-card .tip');
    if (cartTip) cartTip.innerHTML = 'El pedido se guardará y compartirá con el equipo.<br>Impuestos por configurar.';
    const select = $('#tableSelect');
    if (select && !select.dataset.remote) {
      select.dataset.remote = '1';
      select.innerHTML = '<option value="">Seleccionar</option>' + state.tables.filter(t=>t.active).map(t=>`<option value="${t.id}">${escape(t.label)}</option>`).join('') + '<option value="__takeaway">Para llevar</option>';
    }
    const button = $('#sendOrder');
    if (button) button.onclick = async () => {
      if (!select.value) return toast('Selecciona una mesa para continuar.');
      const entries = Object.entries(cart).filter(([id])=>state.products.some(p=>p.id===id));
      if (!entries.length) return toast('Agrega al menos un producto.');
      pendingRequestId ||= window.crypto.randomUUID();
      button.disabled = true; button.textContent = 'Guardando pedido…';
      const { error } = await client.rpc('create_order', {
        p_request_id: pendingRequestId,
        p_dining_table_id: select.value === '__takeaway' ? null : select.value,
        p_items: entries.map(([product_id, item])=>({product_id,quantity:item.qty,notes:item.note||''}))
      });
      if (error) { button.disabled = false; button.textContent = 'Guardar pedido'; return fail(error); }
      pendingRequestId = null; cart = {}; await refreshOrders(); setView('orders'); toast('Pedido compartido con el equipo.');
    };
  }

  function hookOrderActions() {
    if (!remote.ready || view !== 'orders') return;
    if (!content.querySelector('.orders-filter')) {
      const toolbar = document.createElement('div');
      toolbar.className = 'toolbar orders-filter';
      toolbar.innerHTML = '<input class="search" id="orderSearch" placeholder="Buscar por pedido, mesa o mesero…"><select class="field" id="orderStatus"><option value="all">Todos los estados</option><option value="enviado">Enviados</option><option value="cerrado">Cerrados</option><option value="anulado">Anulados</option></select>';
      content.querySelector('.table-card')?.before(toolbar);
      const filterRows = () => {
        const term = ($('#orderSearch')?.value || '').trim().toLocaleLowerCase('es-CO');
        const status = $('#orderStatus')?.value || 'all';
        content.querySelectorAll('.data-table tbody tr').forEach(row => {
          const badge = row.querySelector('.status');
          const rowStatus = badge?.className.match(/status-([a-z]+)/)?.[1] || '';
          row.hidden = (status !== 'all' && rowStatus !== status) || !row.textContent.toLocaleLowerCase('es-CO').includes(term);
        });
      };
      $('#orderSearch').oninput = filterRows;
      $('#orderStatus').onchange = filterRows;
    }
    content.querySelectorAll('.data-table tbody tr').forEach(row => {
      const displayId = row.querySelector('td strong')?.textContent;
      const order = state.orders.find(o => o.id === displayId);
      const detailCell = row.children[2];
      if (order && detailCell && !detailCell.querySelector('[data-detail]')) {
        const detail = document.createElement('button');
        detail.className = 'btn btn-small order-details';
        detail.type = 'button';
        detail.dataset.detail = displayId;
        detail.textContent = 'Ver';
        detailCell.append(' ', detail);
      }
      if (order && state.role === 'Administración' && order.status === 'cerrado') {
        const actions = row.querySelector('.row-actions');
        if (actions && !actions.querySelector('[data-cancel]')) {
          const cancel = document.createElement('button');
          cancel.className = 'btn btn-small'; cancel.type = 'button';
          cancel.dataset.cancel = displayId; cancel.textContent = 'Anular'; actions.append(cancel);
        }
      }
    });
    content.querySelectorAll('[data-detail]').forEach(button => button.onclick = () => openOrderDetails(button.dataset.detail));
    content.querySelectorAll('[data-close]').forEach(button => button.onclick = async () => {
      const order = state.orders.find(o => o.id === button.dataset.close); if (!order) return;
      if (state.role !== 'Administración' && order.createdById !== state.currentUser.id) return toast('Solo puedes cerrar los pedidos que registraste.');
      modal(`<h2>¿Cerrar ${escape(order.id)}?</h2><p>El servicio quedará finalizado y el valor se contará en el panel de ventas. Este cierre no registra ni confirma un pago.</p><div class="modal-actions"><button class="btn" data-dismiss>Volver</button><button class="btn btn-primary" id="confirmClose">Cerrar pedido</button></div>`);
      $('#confirmClose').onclick = async () => {
        const confirm = $('#confirmClose'); confirm.disabled = true; confirm.textContent = 'Cerrando…';
        const { error } = await client.rpc('close_order', { p_order_id: order.uuid });
        if (error) { confirm.disabled=false; confirm.textContent='Cerrar pedido'; return fail(error); }
        closeModal(); await refreshOrders(); toast(`${order.id} cerrado.`);
      };
    });
    content.querySelectorAll('[data-close]').forEach(button => {
      const order = state.orders.find(o => o.id === button.dataset.close);
      if (order && state.role !== 'Administración' && order.createdById !== state.currentUser.id) button.hidden = true;
    });
    content.querySelectorAll('[data-cancel]').forEach(button => button.onclick = () => openRemoteCancel(button.dataset.cancel));
  }

  function openOrderDetails(displayId) {
    const order = state.orders.find(o => o.id === displayId); if (!order) return;
    const items = order.items.map(item => `<div class="order-detail-line"><div><strong>${escape(item.name)}</strong><small>${item.qty} × ${money(item.price)}${item.note ? ` · ${escape(item.note)}` : ''}</small></div><strong>${money(item.qty * item.price)}</strong></div>`).join('');
    const status = ({ enviado:'Enviado', cerrado:'Cerrado', anulado:'Anulado' })[order.status] || order.status;
    modal(`<h2>Pedido ${escape(order.id)}</h2><p>${escape(order.table)} · ${escape(formatDate(order.createdAt))} · ${escape(status)}</p><div class="order-detail-items">${items || '<p>Sin productos</p>'}</div><div class="order-detail-total"><span>Total</span><strong>${money(order.total)}</strong></div>${order.cancelReason ? `<p class="login-error">Motivo de anulación: ${escape(order.cancelReason)}</p>` : ''}<div class="modal-actions"><button class="btn" data-dismiss>Volver</button></div>`);
  }

  function openRemoteCancel(displayId) {
    const order = state.orders.find(o=>o.id===displayId); if (!order) return;
    modal(`<h2>Anular pedido ${escape(displayId)}</h2><p>Se conservará en el historial y no contará en ventas.</p><label for="cancelReason">Motivo de anulación</label><textarea id="cancelReason" rows="3" placeholder="Motivo…"></textarea><div class="modal-actions"><button class="btn" data-dismiss>Volver</button><button class="btn btn-primary" id="confirmCancel">Anular pedido</button></div>`);
    $('#confirmCancel').onclick = async () => {
      const reason=$('#cancelReason').value.trim(); if(reason.length<3)return toast('Escribe el motivo de anulación.');
      const button=$('#confirmCancel');button.disabled=true;
      const {error}=await client.rpc('cancel_order',{p_order_id:order.uuid,p_reason:reason});
      if(error){button.disabled=false;return fail(error);}
      closeModal();await refreshOrders();toast(`${displayId} anulado con motivo registrado.`);
    };
  }

  async function ensureCategory(name) {
    let category=state.categories.find(c=>c.name.toLowerCase()===name.toLowerCase());
    if(category)return category.id;
    const {data,error}=await client.from('categories').insert({restaurant_id:remote.restaurantId,name}).select('id,name,sort_order,active').single();
    if(error)throw error;state.categories.push(data);return data.id;
  }

  function hookMenuActions() {
    if (!remote.ready || view !== 'menu' || state.role !== 'Administración') return;
    if (!state.products.length) {
      const list = $('.menu-admin');
      if (list) list.innerHTML = '<div class="section-card empty-state">Empieza cargando los productos y precios reales de Cerdito Cornudo. La carta quedará compartida con todos los dispositivos.</div>';
    }
    content.querySelectorAll('[data-toggle]').forEach(button=>button.onclick=async()=>{
      const p=state.products.find(x=>x.id===button.dataset.toggle);if(!p)return;
      const {error}=await client.from('products').update({available:!p.available}).eq('id',p.id);
      if(error)return fail(error);await loadWorkspace();toast(`${p.name}: ${p.available?'no disponible':'disponible'}.`);
    });
    content.querySelectorAll('[data-edit]').forEach(button=>button.onclick=()=>productModal(state.products.find(x=>x.id===button.dataset.edit)));
    if($('#addProduct'))$('#addProduct').onclick=()=>productModal();
  }

  function hookProductModal() {
    if (!remote.ready || !$('#saveProduct')) return;
    $('#saveProduct').onclick=async()=>{
      const name=$('#prodName').value.trim(),category=$('#prodCategory').value.trim(),price=Number($('#prodPrice').value),description=$('#prodDesc').value.trim();
      if(!name||!category||price<=0)return toast('Completa nombre, categoría y precio.');
      const button=$('#saveProduct');button.disabled=true;
      try {
        const categoryId=await ensureCategory(category);
        const existingId=$('[data-editing-product]')?.dataset.editingProduct;
        let query;
        if(existingId)query=client.from('products').update({name,category_id:categoryId,price_cop:price,description}).eq('id',existingId);
        else query=client.from('products').insert({restaurant_id:remote.restaurantId,category_id:categoryId,name,price_cop:price,description,emoji:'🍽️',available:true});
        const {error}=await query;if(error)throw error;
        closeModal();await loadWorkspace();toast('Carta compartida actualizada.');
      } catch(error) {button.disabled=false;fail(error);}
    };
  }

  const observer = new MutationObserver(() => {
    hookOrderScreen(); hookOrderActions(); hookMenuActions(); hookProductModal();
    if (remote.ready && view === 'dashboard' && !content.querySelector('.live-dashboard')) renderLiveDashboard();
  });
  observer.observe(content, { childList:true, subtree:true });

  function dayKeyOffset(offset) {
    const d = new Date(); d.setDate(d.getDate() + offset);
    return new Intl.DateTimeFormat('en-CA', { timeZone:'America/Bogota', year:'numeric', month:'2-digit', day:'2-digit' }).format(d);
  }

  function shiftDayKey(key, offset) {
    const d = new Date(`${key}T12:00:00-05:00`); d.setDate(d.getDate() + offset);
    return new Intl.DateTimeFormat('en-CA', { timeZone:'America/Bogota', year:'numeric', month:'2-digit', day:'2-digit' }).format(d);
  }

  function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }

  function renderLiveDashboard() {
    const today = dayKeyOffset(0);
    const start = reportPeriod === 'today' ? today : reportPeriod === '30d' ? dayKeyOffset(-29) : reportPeriod === 'custom' ? (reportStart || dayKeyOffset(-6)) : dayKeyOffset(-6);
    const end = reportPeriod === 'custom' ? (reportEnd || today) : today;
    if (start > end) { toast('La fecha inicial debe ser anterior a la final.'); reportPeriod='7d'; return renderLiveDashboard(); }
    const sales = state.orders.filter(o => o.status === 'cerrado' && o.closedAt && dateKey(new Date(o.closedAt)) >= start && dateKey(new Date(o.closedAt)) <= end);
    const total = sales.reduce((sum,o) => sum + o.total, 0);
    const units = sales.reduce((sum,o) => sum + o.items.reduce((n,i) => n + i.qty, 0), 0);
    const ranking = {};
    sales.forEach(o => o.items.forEach(i => { ranking[i.name] ??= {qty:0,total:0}; ranking[i.name].qty += i.qty; ranking[i.name].total += i.qty * i.price; }));
    const rank = Object.entries(ranking).sort((a,b) => b[1].qty - a[1].qty);
    const chartDays = Array.from({length:7},(_,i)=>shiftDayKey(end,i-6));
    const totalsByDay = chartDays.map(key => sales.filter(o => dateKey(new Date(o.closedAt)) === key).reduce((sum,o) => sum + o.total,0));
    const max = Math.max(...totalsByDay,10000);
    content.innerHTML = `<div class="live-dashboard">${heading('Resumen de ventas','Consulta ventas confirmadas por cierre de servicio; anulaciones excluidas.')}
      <div class="toolbar report-filters"><label>Periodo <select class="field" id="reportPeriod"><option value="today" ${reportPeriod==='today'?'selected':''}>Hoy</option><option value="7d" ${reportPeriod==='7d'?'selected':''}>Últimos 7 días</option><option value="30d" ${reportPeriod==='30d'?'selected':''}>Últimos 30 días</option><option value="custom" ${reportPeriod==='custom'?'selected':''}>Rango personalizado</option></select></label>${reportPeriod==='custom'?`<label>Desde <input class="field" id="reportStart" type="date" value="${escape(reportStart||start)}"></label><label>Hasta <input class="field" id="reportEnd" type="date" value="${escape(reportEnd||end)}"></label>`:''}<button class="btn btn-primary" id="exportSales" ${sales.length?'':'disabled'}>Descargar CSV</button></div>
      <div class="stats-grid"><div class="stat-card"><div class="stat-title">Ventas del periodo</div><div class="stat-value">${money(total)}</div><div class="stat-foot">COP · por fecha de cierre</div></div><div class="stat-card"><div class="stat-title">Pedidos cerrados</div><div class="stat-value">${sales.length}</div><div class="stat-foot">Servicio completado</div></div><div class="stat-card"><div class="stat-title">Unidades vendidas</div><div class="stat-value">${units}</div><div class="stat-foot">Productos en pedidos cerrados</div></div><div class="stat-card"><div class="stat-title">Ticket promedio</div><div class="stat-value">${sales.length?money(Math.round(total/sales.length)):'—'}</div><div class="stat-foot">Por pedido cerrado</div></div></div>
      <div class="dashboard-grid"><section class="chart-card"><div class="panel-heading"><h2>Ventas · últimos 7 días</h2><span class="muted">Por fecha de cierre</span></div><div class="bar-chart">${chartDays.map((key,i)=>`<div class="bar-wrap"><span class="bar-value">${totalsByDay[i]?shortMoney(totalsByDay[i]):''}</span><div class="bar ${key===today?'today-bar':''}" style="height:${Math.max(2,totalsByDay[i]/max*76)}%" title="${money(totalsByDay[i])}"></div><span class="bar-label">${new Intl.DateTimeFormat('es-CO',{timeZone:'America/Bogota',weekday:'short'}).format(new Date(`${key}T12:00:00-05:00`)).replace('.','')}</span></div>`).join('')}</div></section><section class="chart-card"><div class="panel-heading"><h2>Más vendidos del periodo</h2><span class="muted">Por unidades</span></div>${rank.slice(0,8).map(([name,x],i)=>`<div class="rank-row"><span class="rank-num">${i+1}</span><div><div class="rank-name">${escape(name)}</div><div class="rank-units">${x.qty} unidades</div></div><div class="rank-sales">${money(x.total)}</div></div>`).join('')||'<div class="empty-state">Aún no hay pedidos cerrados en este periodo.</div>'}</section></div>
      <p class="tip" style="text-align:left;margin-top:13px">Cerrar un pedido lo cuenta como venta para estos reportes; no registra el medio de pago ni configura impuestos.</p></div>`;
    $('#reportPeriod').onchange = e => { reportPeriod=e.target.value; reportStart=''; reportEnd=''; renderLiveDashboard(); };
    $('#reportStart')?.addEventListener('change',e=>{reportStart=e.target.value;renderLiveDashboard();});
    $('#reportEnd')?.addEventListener('change',e=>{reportEnd=e.target.value;renderLiveDashboard();});
    $('#exportSales').onclick = () => {
      const rows = [['Pedido','Fecha cierre','Mesa','Mesero','Producto','Cantidad','Precio unitario COP','Total línea COP']];
      sales.forEach(o => o.items.forEach(i => rows.push([o.id,formatDate(o.closedAt),o.table,o.createdBy,i.name,i.qty,i.price,i.qty*i.price])));
      const csv = '\uFEFF' + rows.map(row=>row.map(csvCell).join(';')).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
      const link = document.createElement('a'); link.href=url; link.download=`cerdito-ventas-${start}-${end}.csv`; link.click(); URL.revokeObjectURL(url);
    };
  }

  function shortMoney(n) { return n>=1000000?`$${(n/1000000).toFixed(1)}M`:n>=1000?`$${Math.round(n/1000)}k`:`$${n}`; }
  const originalProductModal = window.productModal;
  if (originalProductModal) window.productModal = function(product=null) {
    originalProductModal(product);
    if (remote.ready && product) {
      const title=$('.modal h2');
      if(title) title.insertAdjacentHTML('afterend',`<span data-editing-product="${product.id}" hidden></span>`);
    }
    hookProductModal();
  };

  $('#roleButton').onclick = async () => {
    await client.auth.signOut();
    remote.ready=false;remote.channel&&client.removeChannel(remote.channel);remote.channel=null;
    showLogin('Sesión cerrada.');
  };

  async function start() {
    setHeader();
    const {data:{session},error}=await client.auth.getSession();
    if(error)return showLogin('No pudimos conectar con la base de datos.');
    if(!session)return showLogin();
    await loadWorkspace();
  }

  start().catch(fail);
})();


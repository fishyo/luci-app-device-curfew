'use strict';
'require view';
'require form';
'require uci';
'require ui';
'require fs';
'require network';

var CTL = '/usr/bin/device_curfew_ctl';
var MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
var TIME_RE = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

function readFile(path) {
	return L.resolveDefault(fs.read(path), '').then(function(res) {
		/* fs.read() resolves to a string; keep compatibility with object results */
		if (res && typeof res === 'object')
			return res.data || '';
		return res || '';
	});
}

function runCtl(args) {
	return fs.exec(CTL, args).then(function(res) {
		if (!res || res.code !== 0)
			throw new Error((res && (res.stderr || res.stdout)) || _('未知错误'));
		location.reload();
	}).catch(function(err) {
		ui.addNotification(null, E('p', _('操作失败�?) + (err.message || err)), 'danger');
	});
}

function validateTime(section_id, value) {
	if (!value)
		return _('时间不能为空');
	if (!TIME_RE.test(value))
		return _('需�?HH:MM 格式的时�?);
	return true;
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(fs.exec(CTL, ['status']), null).then(function(res) {
				return (res && res.stdout) ? res.stdout : '{}';
			}),
			L.resolveDefault(network.getHostHints(), null),
			readFile('/tmp/dhcp.leases'),
			readFile('/proc/net/arp'),
			L.resolveDefault(network.getNetworks(), []),
			uci.load('device_curfew')
		]);
	},

	render: function(data) {
		var statusRaw = data[0] || '{}';
		var hints = data[1] || {};
		var leasesRaw = data[2] || '';
		var arpRaw = data[3] || '';
		var networks = data[4] || [];

		var statusObj;
		try {
			statusObj = JSON.parse(statusRaw);
		} catch (e) {
			statusObj = {};
		}

		var statusMap = {};
		L.toArray(statusObj.clients).forEach(function(c) {
			if (c && c.mac)
				statusMap[c.mac.toLowerCase()] = c;
		});

		/* Collect the router's own addresses so it is not offered as a target */
		var routerIPs = {};
		routerIPs[location.hostname] = true;
		networks.forEach(function(net) {
			var addrs = [];
			try {
				addrs = L.toArray(net.getIPAddrs()).concat(L.toArray(net.getIP6Addrs()));
			} catch (e) {}
			addrs.forEach(function(a) {
				routerIPs[String(a).split('/')[0]] = true;
			});
		});

		// Gather all scanned LAN devices from network.getHostHints(), DHCP leases and ARP
		var knownDevices = {};

		if (hints && hints.hosts) {
			for (var hmac in hints.hosts) {
				var h = hints.hosts[hmac];
				var mLower = hmac.toLowerCase();
				var ip = L.toArray(h.ipaddrs || h.ipv4)[0] || '';
				knownDevices[mLower] = { mac: mLower, ip: ip, name: h.name || '' };
			}
		}

		if (leasesRaw) {
			var lines = leasesRaw.trim().split('\n');
			for (var i = 0; i < lines.length; i++) {
				var p = lines[i].split(/\s+/);
				if (p.length >= 4 && MAC_RE.test(p[1])) {
					var lmac = p[1].toLowerCase();
					var lip = p[2];
					var lhost = (p[3] === '*') ? '' : p[3];
					if (!knownDevices[lmac]) {
						knownDevices[lmac] = { mac: lmac, ip: lip, name: lhost };
					} else {
						if (!knownDevices[lmac].name && lhost) knownDevices[lmac].name = lhost;
						if (!knownDevices[lmac].ip && lip) knownDevices[lmac].ip = lip;
					}
				}
			}
		}

		if (arpRaw) {
			var arpLines = arpRaw.trim().split('\n');
			for (var j = 1; j < arpLines.length; j++) {
				var ap = arpLines[j].split(/\s+/);
				if (ap.length >= 4 && MAC_RE.test(ap[3]) && ap[3] !== '00:00:00:00:00:00') {
					var amac = ap[3].toLowerCase();
					var aip = ap[0];
					if (!knownDevices[amac]) {
						knownDevices[amac] = { mac: amac, ip: aip, name: '' };
					} else if (!knownDevices[amac].ip) {
						knownDevices[amac].ip = aip;
					}
				}
			}
		}

		var sortedMacs = Object.keys(knownDevices).filter(function(kmac) {
			var d = knownDevices[kmac];
			return !(d.ip && routerIPs[d.ip]);
		}).sort(function(a, b) {
			var da = knownDevices[a], db = knownDevices[b];
			return (da.name || da.ip || a).localeCompare(db.name || db.ip || b);
		});

		function deviceLabel(kmac, unnamed) {
			var dev = knownDevices[kmac];
			return (dev.name || unnamed) + ' (' + (dev.ip ? dev.ip + ' | ' : '') + kmac + ')';
		}

		var m, s, o;

		m = new form.Map('device_curfew', _('设备定时控制'),
			_('按时间段阻断指定设备的网络访问。阻断期间仍允许 DHCP �?IPv6 邻居发现报文，设备保持局域网连接�?));

		// --- Section 1: Global Setting ---
		s = m.section(form.NamedSection, 'global', 'global', _('全局设置'));
		o = s.option(form.Flag, 'enabled', _('启用'), _('关闭后清空阻断列表，所有设备恢复联网�?));
		o.default = '1';
		o.rmempty = false;

		// --- Section 2: Managed clients ---
		s = m.section(form.GridSection, 'client', _('受控设备'),
			_('临时放行在到期后自动恢复按定时规则管控�?));
		s.addremove = true;
		s.anonymous = true;

		o = s.option(form.Value, 'name', _('名称'));
		o.rmempty = false;

		// MAC field: dropdown of scanned devices, manual input allowed
		o = s.option(form.Value, 'mac', _('MAC 地址'));
		o.rmempty = false;
		sortedMacs.forEach(function(kmac) {
			o.value(kmac, deviceLabel(kmac, _('未命�?)));
		});
		var currentClients = uci.sections('device_curfew', 'client');
		currentClients.forEach(function(cs) {
			var cmac = (cs.mac || '').toLowerCase();
			if (cmac && !knownDevices[cmac])
				o.value(cmac, (cs.name || 'Device') + ' (' + cmac + ')');
		});
		o.validate = function(section_id, value) {
			if (!value)
				return _('MAC 地址不能为空');
			if (!MAC_RE.test(value))
				return _('MAC 地址格式无效（例�?00:11:22:33:44:55�?);
			var lower = value.toLowerCase();
			var dup = uci.sections('device_curfew', 'client').some(function(cs) {
				return cs['.name'] !== section_id && (cs.mac || '').toLowerCase() === lower;
			});
			return dup ? _('�?MAC 地址已存�?) : true;
		};
		o.write = function(section_id, value) {
			var newMac = value.toLowerCase();
			var oldMac = (uci.get('device_curfew', section_id, 'mac') || '').toLowerCase();
			// Keep rules bound to this device when its MAC is edited
			if (oldMac && oldMac !== newMac) {
				uci.sections('device_curfew', 'rule').forEach(function(rs) {
					if ((rs.client || '').toLowerCase() === oldMac)
						uci.set('device_curfew', rs['.name'], 'client', newMac);
				});
			}
			return uci.set('device_curfew', section_id, 'mac', newMac);
		};

		// Current access state reported by device_curfew_ctl status
		o = s.option(form.DummyValue, '_status', _('当前状�?));
		o.modalonly = false;
		o.cfgvalue = function(section_id) {
			var c_mac = (uci.get('device_curfew', section_id, 'mac') || '').toLowerCase();
			var c = statusMap[c_mac];
			if (!c)
				return _('未生�?);
			if (c.status === 'blocked')
				return _('已阻�?);
			if (c.status === 'temp_pass')
				return _('临时放行（剩�?%d 分钟�?).format(Math.ceil((c.remaining_seconds || 0) / 60));
			return _('允许');
		};

		o = s.option(form.Button, '_btn_pass', _('临时放行'));
		o.inputtitle = function(section_id) {
			var mac = (uci.get('device_curfew', section_id, 'mac') || '').toLowerCase();
			var c = statusMap[mac];
			if (c && c.status === 'temp_pass')
				return _('放行�?(修改/取消)');
			return _('临时放行');
		};
		o.inputstyle = 'action';
		o.editable = true;
		o.modalonly = false;
		o.onclick = function(ev, section_id) {
			var mac = (uci.get('device_curfew', section_id, 'mac') || '').toLowerCase();
			if (!mac) {
				ui.addNotification(null, E('p', _('该设备尚未设�?MAC 地址')), 'warning');
				return;
			}
			var devName = uci.get('device_curfew', section_id, 'name') || mac;
			var c = statusMap[mac] || {};
			var isTemp = (c.status === 'temp_pass');
			var remMins = Math.ceil((c.remaining_seconds || 0) / 60);

			var customInput = E('input', {
				'type': 'number',
				'class': 'cbi-input-text',
				'style': 'width: 100px; display: inline-block; margin-right: 8px;',
				'min': '1',
				'max': '1440',
				'value': '45',
				'placeholder': '1-1440'
			});

			var customRow = E('div', {
				'class': 'cbi-value',
				'style': 'display: none;'
			}, [
				E('label', { 'class': 'cbi-value-title' }, _('自定义分�?)),
				E('div', { 'class': 'cbi-value-field' }, [
					customInput,
					E('span', _('分钟 (范围 1 ~ 1440)'))
				])
			]);

			var durationSelect = E('select', {
				'class': 'cbi-input-select',
				'style': 'width: 100%; max-width: 260px;',
				'change': function(e) {
					if (this.value === 'custom') {
						customRow.style.display = '';
						customInput.focus();
					} else {
						customRow.style.display = 'none';
					}
				}
			}, [
				E('option', { 'value': '15' }, _('15 分钟')),
				E('option', { 'value': '30', 'selected': 'selected' }, _('30 分钟')),
				E('option', { 'value': '60' }, _('1 小时 (60 分钟)')),
				E('option', { 'value': '120' }, _('2 小时 (120 分钟)')),
				E('option', { 'value': '240' }, _('4 小时 (240 分钟)')),
				E('option', { 'value': '480' }, _('8 小时 (480 分钟)')),
				E('option', { 'value': 'custom' }, _('自定义时�?..'))
			]);

			var modalContent = [
				E('div', { 'class': 'cbi-section' }, [
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('受控设备')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('strong', devName + ' (' + mac + ')')
						])
					]),
					(isTemp ? E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('当前状�?)),
						E('div', { 'class': 'cbi-value-field', 'style': 'font-weight: bold;' }, [
							_('正在临时放行中，剩余�?%d 分钟').format(remMins)
						])
					]) : ''),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('放行时长')),
						E('div', { 'class': 'cbi-value-field' }, [ durationSelect ])
					]),
					customRow
				]),
				E('div', { 'class': 'right' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'click': ui.hideModal
					}, _('取消')),
					' ',
					(isTemp ? E('button', {
						'class': 'btn cbi-button cbi-button-reset',
						'style': 'margin-right: 8px;',
						'click': function() {
							ui.hideModal();
							runCtl(['clear_temp_pass', mac]);
						}
					}, _('恢复常规管控')) : ''),
					E('button', {
						'class': 'btn cbi-button cbi-button-action',
						'click': function() {
							var val = durationSelect.value;
							var mins = 30;
							if (val === 'custom') {
								mins = parseInt(customInput.value, 10);
								if (isNaN(mins) || mins < 1 || mins > 1440) {
									ui.addNotification(null, E('p', _('请输入有效的自定义分钟数 (1 �?1440 之间)')), 'warning');
									return;
								}
							} else {
								mins = parseInt(val, 10);
							}
							ui.hideModal();
							runCtl(['temp_pass', mac, String(mins)]);
						}
					}, isTemp ? _('更新放行时长') : _('确认放行'))
				])
			];

			ui.showModal(_('临时放行设置'), modalContent);
		};

		o = s.option(form.Flag, 'enabled', _('启用'));
		o.default = '1';
		o.editable = true;

		// --- Section 3: Schedule rules ---
		s = m.section(form.GridSection, 'rule', _('定时规则'),
			_('为受控设备设置断网时段。恢复时间早于断网时间时，表示跨越午夜（�?20:20 至次�?06:00）�?));
		s.addremove = true;
		s.anonymous = true;

		// Rules are bound to a device by MAC address (anonymous section IDs are not stable)
		o = s.option(form.ListValue, 'client', _('归属设备'));
		o.rmempty = false;
		var clientMacs = {};
		currentClients.forEach(function(cs) {
			var cmac = (cs.mac || '').toLowerCase();
			if (!cmac || clientMacs[cmac])
				return;
			clientMacs[cmac] = true;
			o.value(cmac, (cs.name || cs['.name']) + ' (' + cmac + ')');
		});
		uci.sections('device_curfew', 'rule').forEach(function(rs) {
			var ref = rs.client;
			if (!ref || clientMacs[ref.toLowerCase()])
				return;
			// Legacy reference by section name: resolve to that client's MAC
			var legacyMac = (uci.get('device_curfew', ref, 'mac') || '').toLowerCase();
			if (!legacyMac || !clientMacs[legacyMac])
				o.value(ref, ref + ' ' + _('（未找到对应设备�?));
		});
		o.cfgvalue = function(section_id) {
			var ref = uci.get('device_curfew', section_id, 'client');
			if (!ref)
				return ref;
			if (MAC_RE.test(ref))
				return ref.toLowerCase();
			var legacyMac = (uci.get('device_curfew', ref, 'mac') || '').toLowerCase();
			return (legacyMac && clientMacs[legacyMac]) ? legacyMac : ref;
		};

		o = s.option(form.MultiValue, 'week_day', _('星期'));
		o.value('1', _('周一'));
		o.value('2', _('周二'));
		o.value('3', _('周三'));
		o.value('4', _('周四'));
		o.value('5', _('周五'));
		o.value('6', _('周六'));
		o.value('7', _('周日'));
		o.default = ['1', '2', '3', '4'];
		o.rmempty = false;

		o = s.option(form.Value, 'block_time', _('开始时�?));
		o.placeholder = '20:20';
		o.rmempty = false;
		o.validate = validateTime;

		o = s.option(form.Value, 'resume_time', _('结束时间'));
		o.placeholder = '06:00';
		o.rmempty = false;
		o.validate = function(section_id, value) {
			var res = validateTime(section_id, value);
			if (res !== true)
				return res;
			var bt = this.section.formvalue(section_id, 'block_time');
			if (bt && bt === value)
				return _('结束时间不能与开始时间相�?);
			return true;
		};

		o = s.option(form.Flag, 'enabled', _('启用'));
		o.default = '1';
		o.editable = true;

		return m.render().then(function(mapNode) {
			// Quick-add section built from standard CBI markup
			var devSelect = E('select', { 'class': 'cbi-input-select' }, [
				E('option', { 'value': '' }, _('-- 请选择 --'))
			]);

			sortedMacs.forEach(function(kmac) {
				devSelect.appendChild(E('option', { 'value': kmac }, deviceLabel(kmac, _('未命�?))));
			});

			var addBtn = E('button', {
				'class': 'btn cbi-button cbi-button-add',
				'click': function(ev) {
					ev.preventDefault();
					var selectedMac = (devSelect.value || '').toLowerCase();
					if (!selectedMac) {
						ui.addNotification(null, E('p', _('请选择一个设�?)), 'warning');
						return;
					}

					var exists = uci.sections('device_curfew', 'client').some(function(cs) {
						return (cs.mac || '').toLowerCase() === selectedMac;
					});
					if (exists) {
						ui.addNotification(null, E('p', _('该设备已在受控设备中')), 'info');
						return;
					}

					var dev = knownDevices[selectedMac] || { mac: selectedMac, name: '' };
					var clientName = dev.name || ('Device_' + selectedMac.substring(9).replace(/:/g, ''));

					// Named section with deterministic ID: stable across saves
					var sid = 'dev_' + selectedMac.replace(/:/g, '');
					if (!uci.get('device_curfew', sid))
						uci.add('device_curfew', 'client', sid);
					uci.set('device_curfew', sid, 'name', clientName);
					uci.set('device_curfew', sid, 'mac', selectedMac);
					uci.set('device_curfew', sid, 'enabled', '1');
					uci.set('device_curfew', sid, 'override_until', '0');

					// Changes are staged; user still needs to "Save & Apply"
					return uci.save().then(function() {
						location.reload();
					}).catch(function(err) {
						ui.addNotification(null, E('p', _('添加失败�?) + (err.message || err)), 'danger');
					});
				}
			}, _('添加'));

			var toolbar = E('div', { 'class': 'cbi-section' }, [
				E('h3', _('添加设备')),
				E('div', { 'class': 'cbi-section-descr' },
					_('从已发现的局域网设备中选择并添加到受控设备，然后在定时规则中设置时段，保存并应用后生效�?)),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('设备')),
					E('div', { 'class': 'cbi-value-field' }, [ devSelect, ' ', addBtn ])
				])
			]);

			var clientSecNode = mapNode.querySelector('#cbi-device_curfew-client') || mapNode.querySelectorAll('.cbi-section')[1];
			if (clientSecNode)
				clientSecNode.parentNode.insertBefore(toolbar, clientSecNode);
			else
				mapNode.appendChild(toolbar);

			return mapNode;
		});
	}
});

// Real file:// Chromium acceptance; optional test tools, never page dependencies.
// npm install --prefix scratch/browser --no-package-lock playwright-core @sparticuz/chromium
// NODE_PATH=./scratch/browser/node_modules node experiments/library-browser.js
// Or supply CHROMIUM_PATH with playwright-core installed on NODE_PATH.
'use strict';

var assert = require('assert/strict');
var path = require('path');
var url = require('url');
var chromium = require('playwright-core').chromium;
var checks = 0;
function ok(value, label) {
	assert.ok(value, label);
	console.log('PASS ' + label);
	checks++;
}

async function run() {
	var bundled = process.env.CHROMIUM_PATH ? null : require('@sparticuz/chromium').default;
	var browser = await chromium.launch({
		executablePath: process.env.CHROMIUM_PATH || await bundled.executablePath(),
		args: bundled ? bundled.args : [],
		headless: true
	});
	try {
		console.log('Chromium ' + browser.version());
		var page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
		var errors = [];
		page.on('pageerror', function (error) { errors.push('page: ' + error.message); });
		page.on('console', function (message) {
			if (message.type() === 'error') errors.push('console: ' + message.text());
		});
		page.on('requestfailed', function (request) { errors.push('resource: ' + request.url()); });
		await page.goto(url.pathToFileURL(path.join(__dirname, '..', 'library.html')).href);
		await page.waitForFunction(function () { return window.COLSIM && COLSIM.frame > 0; });
		async function state() {
			return page.evaluate(function () {
				var app = M2_LIBRARY, canvas = app.mount.querySelector('#c');
				return {
					started: COLSIM.started, frame: COLSIM.frame, time: COLSIM.t, rate: COLSIM.dG,
					paused: COLSECTION.syncPaused, origin: COLSECTION.origin,
					checksum: COLSECTION.pack.checksum, expected: SECTION_PACKS['earth-gc0'].checksum,
					status: app.status.dataset.state, text: app.status.textContent,
					isolated: canvas !== document.getElementById('c') && canvas.getRootNode() === app.shadowRoot,
					pixels: document.getElementById('c').toDataURL(),
					painted: canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some(function (v) { return v !== 0; })
				};
			});
		}
		async function click(id) {
			await page.locator('#m2-' + id).click();
			var result = await state();
			assert.equal(result.status, 'pass', result.text);
			return result;
		}
		var initial = await state();
		ok(initial.started && initial.isolated && initial.painted && initial.checksum === initial.expected,
			'file page starts the baked section and paints a tree-scoped canvas');
		var paused = await click('pause');
		await page.waitForTimeout(350);
		var held = await state();
		ok(held.paused && held.time === paused.time, 'paused clock holds over 350 ms');
		var delta = await page.evaluate(function () {
			var frame = COLSIM.frame, time = COLSIM.t;
			document.getElementById('m2-step').click();
			return { frame: COLSIM.frame - frame, time: COLSIM.t - time, rate: COLSIM.dG,
				expected: COLUI.sToGeo(1 / 1000) / 1e6 };
		});
		var stepped = await state();
		ok(stepped.status === 'pass' && delta.frame === 1 && Math.abs(delta.time - delta.expected) < 1e-12 && delta.rate === 0,
			'one click advances exactly one configured simulation frame: ' + JSON.stringify(delta) + ' · ' + stepped.text);
		await page.waitForTimeout(350);
		ok((await state()).time === stepped.time, 'single step remains paused across animation frames');
		await click('couple');
		ok(await page.evaluate(function () { return COLCOUPLING.last.matched > 0 && !COLSECTION.bad; }),
			'baked coupling enters through the host API');
		await click('log');
		var recordCount = await page.evaluate(function () {
			return CoreLogFormat.parse(M2_LIBRARY.mount.querySelector('#sObsOut').value).records.length;
		});
		ok(recordCount > 0, 'placed core log parses as v2 (' + recordCount + ' records)');
		var stopped = await click('stop');
		await page.waitForTimeout(350);
		var still = await state();
		ok(!still.started && still.frame === stopped.frame && still.time === stopped.time,
			'stop cancels simulation progress');
		await click('restart');
		await page.waitForFunction(function () { return COLSIM.started && COLSIM.frame > 0; });
		var restarted = await state();
		ok(restarted.origin === 'earth-gc0' && restarted.checksum === initial.expected && restarted.isolated,
			'restart restores the primary section in its nested host');
		ok(restarted.pixels === initial.pixels, 'host-owned canvas pixels remain untouched');
		ok(errors.length === 0, 'no page, console or resource errors: ' + errors.join(' | '));
		console.log('ALL PASS (' + checks + ' checks)');
	} finally {
		await browser.close();
	}
}
run().catch(function (error) { console.error(error); process.exitCode = 1; });

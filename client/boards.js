/**
 * UI BBS view
 */

var util = require('util');
var blessed = require('blessed');
var app = require('../bbs').app;

/**
 * Formats and color codes TTL strings from remaining milliseconds
 *
 * RED    - <1h remaining
 * CYAN   - <=1d remaining
 * BLUE   - <=4d remaining
 * GREEN  - all else
 */
function formatRemainingTime(ms) {
	if (ms<=0) {
		return '{red-bg}{white-fg}TTL: EXPIRED{/white-fg}{/red-bg}';
	}

	var x = Math.floor(ms / 1000);
	var seconds = x % 60;
	x = Math.floor(x / 60);
	var minutes = x % 60;
	x = Math.floor(x / 60);
	var hours = x % 24;
	x = Math.floor(x / 24);
	var days = x;


	if (days > 0) {
		var color = 'green';
		if (days < 5)
			color = 'blue';
		if (days == 1)
			color = 'cyan';
		return util.format('{%s-fg}TTL: %dd %dh{/%s-fg}', color, days, hours, color);
	}

	if (hours > 0) {
		return util.format('{cyan-fg}TTL: %dh %dm{/cyan-fg}', hours, minutes);
	}

	return util.format('{red-fg}TTL: %dm %ds{/red-fg}', minutes, seconds);
}

function Boards(screen, statusBar) {
	this.screen = screen;
	this.statusBar = statusBar;

	this.list = new blessed.List({
		parent: screen,
		top: 3,
		bottom: 2,
		left: 0,
		right: 0,

		mouse: true,
		keys: true,

		scrollable: true,
		scrollbar: {
			fg: 'green',
			bg: 'blue'
		},

		border: {
			type: 'line',
			fg: 'green',
			bg: 'black'
		},

		bg: 'black',
		fg: 'green',
		selectedFg: 'white',
		selectedBg: 'green',
		selectedBold: true,
		itemFg: 'green',
		itemBg: 'black',

		tags: true,

		items: []
	});

	this.title = new blessed.Text({
		left: 2,
		fg: 'green',
		bg: 'black'
	});

	this.list.prepend(this.title);

	this.list.key('tab', function (ch, key) {
		app.menu.setActive('chat');
		app.tabs.bbs.hide();
		app.tabs.chat.activate();
		app.screen.render();
	});

	var scope = this;
	this.list.key('C-r', function (ch, key) {
		scope.list.clearItems();
		scope.setTitle('Loading...');
		app.screen.render();
		app.client.send({ type: 'threads' });
	});

	this.setTitle('Loading...');
}

Boards.prototype.setTitle = function(text) {
	this.title.setContent(' ' + text + ' ');
};

Boards.prototype.activate = function() {
	if (this.statusBar)
		this.statusBar.set('ESC: Exit | TAB: Change tab | CTRL-R: Reload');

	this.setTitle('Loading...');
	app.client.send({ type: 'threads' });

	this.list.removeAllListeners('action');
	this.list.show();

	var scope = this;
	this.list.pick(function (el, selected) {
		if (!selected) {
			app.tabs.bbs.activate();
			app.screen.render();
			return;
		}

		var matches = selected.match(/^\#(\d+)\t.*/);
		if (!matches) {
			app.tabs.bbs.activate();
			app.screen.render();
			return;
		}

		var threadID = parseInt(matches[1]);
		app.client.send({ type: 'thread', thread: threadID });

		// TODO: show thread UI and wait for setThreadContents
	});
};

Boards.prototype.hide = function() {
	this.list.hide();
};

Boards.prototype.setThreads = function(threads) {
	this.list.clearItems();

	var topics = [];

	var format = '#%d\t%s\t\t\t{bold}%s{/bold}'
	for (var i=0; i<threads.length; i++) {
		var thread = threads[i];
		var timeRemaining = thread.ttl - (Date.now() - thread.created);
		topics.push(util.format(format, thread.id, formatRemainingTime(timeRemaining), thread.title));
	}

	this.list.setItems(topics);
	this.setTitle('Topics');
	app.screen.render();
};

Boards.prototype.setThreadContents = function(thread) {
	// TODO
};

module.exports = Boards;

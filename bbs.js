/**
 * BBS client - this "shell" is spawned by the SSH gateway
 */

// Setup logs
var winston = require('winston');
var logger = new (winston.Logger)({
	transports: [
		// new (winston.transports.Console)(),
		new (winston.transports.File)({ filename: 'debug.log' })
	]
});
exports.logger = logger;

// Setup app data bus
var app = {
	screen: null,
	menu: null,
	hint: null,
	tabs: {
		chat: null,
		bbs: null
	},

	client: null,
	key: 'debug',
	username: '--Disconnected--',
	userlist: {}
};
exports.app = app;


// UI components
var blessed = require('blessed');
var TabMenu = require('./client/tabmenu');
var StatusBar = require('./client/statusbar');
var Chat = require('./client/chat');
var Boards = require('./client/boards');

// Network client
var Client = require('./client/client');

if (process.argv.length == 3) {
	app.key = process.argv[2];
	if (app.key.length != 64) {
		logger.error('Invalid key');
		process.exit(1);
	}
}

var client = new Client();

var screen = blessed.screen({
	ignoreLocked: ['C-c']
});
var menu = new TabMenu(screen);
var hint = new StatusBar(screen, '{bold}2600 ni youkoso{/bold}');

app.screen = screen;
app.menu = menu;
app.hint = hint;
app.tabs.chat = new Chat(screen, hint);
app.tabs.bbs = new Boards(screen, hint);
app.client = client;

app.tabs.bbs.hide();
app.tabs.chat.activate();

// Quit on escape or Control-C.
screen.key(['escape', 'C-c'], function (ch, key) {
	client.send({ type: 'quit'}, function() {
		client.destroy();
		process.exit(0);
	});
});

screen.render();

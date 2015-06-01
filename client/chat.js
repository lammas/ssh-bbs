/**
 * UI chat view
 */

var blessed = require('blessed');
var app = require('../bbs').app;

var USERLIST_WIDTH = 24;

var commands = {
	'/passwd': {
		callback: onPasswd,
		help: 'Changes password',
		usage: '\tUsage: {cyan-fg}/passwd <current password> <new password>{/cyan-fg}'
	},

	'/users': {
		callback: onUsers,
		help: 'Shows connected users',
		usage: false
	},

	'/msg': {
		callback: onMsg,
		help: 'Send private message to user',
		usage: '\tUsage: {cyan-fg}/msg <nick> <text>{/cyan-fg}'
	},

	'/quit': {
		callback: onQuit,
		help: 'Disconnect (shortcut: ESC)',
		usage: false
	},

	'/help': {
		callback: onHelp,
		help: 'Shows this message',
		usage: false
	}
}

function onHelp(chat) {
	chat.addLine('');
	chat.addLine('=== Help ====================================================================');

	for (var cmd in commands) {
		chat.addLine('\t{cyan-fg}' + cmd + '{/cyan-fg} - ' + commands[cmd].help);
	}

	chat.addLine('=============================================================================');
	chat.addLine('');
}

function onUsers(chat) {
	chat.addLine('{cyan-fg}* Requesing userlist...{/cyan-fg}');
	app.client.send({ type: 'users'});
}

function onMsg(chat, command, args) {
	if (args.length < 2)
		return true;
	var nick = args.shift();
	var text = args.join(' ');
	chat.addLine('{bold}>{red-fg}' + nick + '{/red-fg}<{/bold} '+ text);
	app.client.send({ type: 'privmsg', target: nick, body: text });
}

function onQuit(chat, command, args) {
	app.client.send({ type: 'quit'}, function() {
		app.client.destroy();
		process.exit(0);
	});
}

function onPasswd(chat, command, args) {
	if (args.length != 2)
		return true;

	chat.addLine('{bold}* {red-fg}Requesing password change...{/red-fg}{/bold}');
	app.client.send({ type: 'password', current: args[0], password: args[1] });
}

function handleCommand(chat, text) {
	var words = text.split(' ');
	if (words.length == 0)
		return;

	var cmd = words.shift();
	if (!(cmd in commands)) {
		chat.addLine('{magenta-fg}*{/magenta-fg} No such command.');
		return;
	}

	var command = commands[cmd];
	if (command.callback(chat, cmd, words) === true && command.usage) {
		chat.addLine(command.usage);
	}
}

function Chat(screen, statusBar) {
	this.screen = screen;
	this.statusBar = statusBar;

	this.box = new blessed.Box({
		parent: screen,
		top: 3,
		bottom: 2,
		left: 0,
		right: 0
	});

	this.prompt = new blessed.Text({
		parent: this.box,
		bottom: 0,
		left: 0,
		width: 2,
		height: 1,
		tags: true,
		style: {
			fg: 'green',
			bg: 'black'
		},
		content: '{bold}> {/bold}'
	})

	this.buffer = new blessed.Text({
		parent: this.box,
		tags: true,
		scrollable: true,
		scrollbar: {
			fg: 'red',
			bg: 'blue'
		},
		top: 0,
		bottom: 1,
		left: 0,
		right: USERLIST_WIDTH,
		style: {
			fg: 'green',
			bg: 'black'
		}
	});

	this.users = new blessed.List({
		parent: this.box,
		top: 0,
		bottom: 1,
		right: 0,
		width: USERLIST_WIDTH,

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

	this.command = new blessed.Textbox({
		parent: this.box,
		bottom: 0,
		height: 1,
		left: 2,
		right: 0,
		inputOnFocus: true,
		keys: false,
		style: {
			fg: 'green',
			bg: 'black'
		}
	});

	var scope = this;

	this.command.key('enter', function(ch, key) {
		var text = scope.command.getValue();
		if (text.length>0) {
			if (text.substring(0, 1) == '/') {
				handleCommand(scope, text);
			}
			else {
				scope.buffer.pushLine('{bold}<' + app.username + '>{/bold} '+ text);
				scope.buffer.setScrollPerc(100);
				app.client.send({ type: 'pubmsg', body: text});
			}
		}

		scope.command.clearValue();
		scope.command.focus();
		scope.screen.render();
	});

	this.command.key(['pageup', 'pagedown'], function (ch, key) {
		if (key.name == 'pageup') {
			scope.buffer.scroll(-1);
		}
		else {
			scope.buffer.scroll(1);
		}
		scope.screen.render();
	});

	this.command.key('escape', function (ch, key) {
		app.client.send({ type: 'quit'}, function() {
			app.client.destroy();
			process.exit(0);
		});
	});

	this.command.key('tab', function (ch, key) {
		var text = scope.command.getValue();
		text = text.substring(0, text.length-1); // removes tab
		scope.command.setValue(text);

		if (text.length>0) {
			if (text.substring(0, 1) == '/') { // Complete command
				app.tabs.chat.addLine('{magenta-fg}DEBUG:{/magenta-fg} command = ' + JSON.stringify(text));

				var cmds = Object.keys(commands);
				var candidates = [];
				while (cmds.length>0) {
					var c = cmds.shift();
					if (c.indexOf(text) == 0) {
						candidates.push(c);
					}
				}
				app.tabs.chat.addLine('{magenta-fg}DEBUG:{/magenta-fg} candidates = ' + JSON.stringify(candidates));
				if (candidates.length>0) {
					if (candidates.length == 1) {
						scope.command.setValue(candidates[0] + ' ');
					}
					else {
						app.tabs.chat.addLine('\t' + candidates.join(' '));
					}
					scope.screen.render();
				}
				return;
			}

			// var last = text.split(' ').pop();
			// if (last.length>0) {
			// 	// TODO: look up user from userlist
			// 	screen.render();
			// 	return;
			// }
		}

		/** Disabled until bbs part is finished */
		// app.menu.setActive('bbs');
		// app.tabs.chat.hide();
		// app.tabs.bbs.activate();
		app.tabs.chat.addLine('{red-fg}Sorry, BBS part is disabled until it is usable.{/red-fg}');
		scope.screen.render();
	});
}

Chat.prototype.activate = function() {
	if (this.statusBar)
		this.statusBar.set('ESC: Exit | TAB: Change tab | PGUP/PGDN: Scroll | /help');
	this.box.show();
	this.command.focus();
};

Chat.prototype.hide = function() {
	this.box.hide();
}

Chat.prototype.addLine = function(text) {
	this.buffer.pushLine(text);
	this.buffer.setScrollPerc(100);
	this.screen.render();
};

Chat.prototype.updateUsers = function(users) {
	this.users.clearItems();
	var i = 0, index = 0;
	for (var nick in users) {
		if (nick == app.username)
			index = i;
		if (users[nick] > 1)
			nick = nick + ' {red-fg}(' + users[nick] + '){/red-fg}';
		this.users.add(nick);
		i++;
	}
	this.users.select(index);
	this.screen.render();
};

module.exports = Chat;

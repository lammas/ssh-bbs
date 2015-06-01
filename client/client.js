/**
 * The network client
 */

var net = require('net');
var logger = require('../bbs').logger;
var app = require('../bbs').app;

function handleMessage(client, msg) {
	var chat = app.tabs.chat;
	var bbs = app.tabs.bbs;

	if (msg.type == 'user' && msg.username) {
		chat.addLine('{magenta-fg}Logon:{/magenta-fg} {bold}{cyan-fg}' + msg.username + '{/}');
		app.username = msg.username;
	}

	else if (msg.type == 'users') {
		chat.updateUsers(msg.users);
		var users = '  ';
		for (var user in msg.users) {
			users += '{bold}' + user + '{/bold}';
			if (msg.users[user]>1)
				users += '{red-fg}(' + msg.users[user] + '){/red-fg}';
			users += ' ';
		}
		chat.addLine('{magenta-fg}Users:{/magenta-fg}');
		chat.addLine(users);
	}

	else if (msg.type == 'status') {
		chat.addLine('{magenta-fg}STATUS:{/magenta-fg} ' + JSON.stringify(msg));
	}

	else if (msg.type == 'error' && msg.body) {
		chat.addLine('{red-fg}Error:{/red-fg} ' + msg.body);
	}

	else if (msg.type == 'notice' && msg.body) {
		chat.addLine('{magenta-fg}Notice:{/magenta-fg} ' + msg.body);
	}

	else if (msg.type == 'join' && msg.nick) {
		chat.addLine('Join {bold}{cyan-fg}' + msg.nick + '{/}');
		client.send({ type: 'users'});
	}

	else if (msg.type == 'pubmsg' && msg.nick && msg.body) {
		chat.addLine('{bold}<' + msg.nick + '>{/bold} ' + msg.body);
	}

	else if (msg.type == 'privmsg' && msg.nick && msg.body) {
		chat.addLine('{red-fg}{bold}*' + msg.nick + '*{/bold} {/red-fg}' + msg.body);
	}

	else if (msg.type == 'quit' && msg.nick && msg.body) {
		chat.addLine('Quit {bold}' + msg.nick + '{/bold} (' + msg.body + ')');
		client.send({ type: 'users'});
	}

	// BBS responses
	else if (msg.type == 'threads' && msg.body) {
		bbs.setThreads(msg.body);
		chat.addLine('{magenta-fg}THREADS:{/magenta-fg} ' + JSON.stringify(msg.body));
	}

	else if (msg.type == 'thread' && msg.body) {
		bbs.setThreadContents(msg.body);
		chat.addLine('{magenta-fg}THREAD:{/magenta-fg} ' + JSON.stringify(msg.body));
	}
}

function Client() {
	this.host = '127.0.0.1';
	this.port = 8420;
	this.client = new net.Socket();

	var scope = this;

	this.client.connect(this.port, this.host, function() {
		scope.send({ type: 'key', key: app.key });
	});

	this.client.on('data', function(data) {
		var buffer = data.toString();
		var lines = buffer.split('\n');
		for (var i=0; i<lines.length; i++) {
			if (lines[i].length == 0)
				continue;

			try {
				var msg = JSON.parse(lines[i]);
				handleMessage(scope, msg);
			}
			catch (e) {
				logger.error('EXCEPTION: parse: ', e);
				logger.error('OFFENDING PACKET: ', data.toString());
			}
		}
	});

	this.client.on('close', function() {
		process.exit(0);
	});
}

Client.prototype.send = function(data, callback) {
	try {
		var message = JSON.stringify(data) + '\n';
		this.client.write(message, callback);
	}
	catch (e) {
		logger.error('EXCEPTION: send(): ', e);
	}
};

Client.prototype.destroy = function() {
	this.client.destroy();
};

module.exports = Client;

var fs = require('fs');
var net = require('net');
var levelup = require('level');
var bcrypt = require('bcrypt');

var port = 8420;
var keyWindow = 1000; // in ms
var maxThreadTitle = 40;
var minPasswordLength = 8;

var serverStart = 0;
var clients = [];
var keys = {};
var threads = {};
var nextThreadID = 1;

var DB_LOCK_FILE = './auth.lock';

function auth(username, password, callback) {
	if (fs.existsSync(DB_LOCK_FILE)) {
		console.log('ERROR: Auth failed due to DB lock');
		callback(false);
		return;
	}

	fs.closeSync(fs.openSync(DB_LOCK_FILE, 'w'));

	var db = levelup('./auth.db');
	db.get(username, function (err, hash) {
		db.close();
		fs.unlinkSync(DB_LOCK_FILE);

		if (err) {
			callback(false);
			return;
		}

		if (!bcrypt.compareSync(password, hash)) {
			callback(false);
			return;
		}

		callback(true);
	});
}

function changePassword(socket, msg) {
	function success() {
		send(socket, {
			type: 'notice',
			body: 'Password changed.'
		});
	}

	function fail(message) {
		send(socket, {
			type: 'notice',
			body: message
		});
	}

	if (msg.current && msg.password) {
		if (msg.password.length < minPasswordLength) {
			fail('Unable to change password: password is too short.');
			return;
		}

		if (fs.existsSync(DB_LOCK_FILE)) {
			console.log('ERROR: Password change failed due to DB lock');
			fail('Unable to change password (database locked).');
			return;
		}

		fs.closeSync(fs.openSync(DB_LOCK_FILE, 'w'));

		var db = levelup('./auth.db');

		db.get(socket.username, function (err, hash) {
			if (err) {
				fail('Unable to change password: no such user.');
				db.close();
				fs.unlinkSync(DB_LOCK_FILE);
				return;
			}

			if (!bcrypt.compareSync(msg.current, hash)) {
				fail('Unable to change password: current password not correct.');
				db.close();
				fs.unlinkSync(DB_LOCK_FILE);
				return;
			}

			var salt = bcrypt.genSaltSync(10);
			var hash = bcrypt.hashSync(msg.password, salt);
			db.put(socket.username, hash, function (err) {
				db.close();
				fs.unlinkSync(DB_LOCK_FILE);
				if (err)
					fail('Unable to change password (database I/O error).');
				else
					success();
			});
		});
	}
	else {
		fail('Malformed password change request.');
	}
}

function generateThreadID() {
	return nextThreadID++;
}

function generateKey() {
	var key = '';
	for (var i=0; i<16; i++)
		key += Math.floor((1 + Math.random()) * 0x10000).toString(36);
	return key;
}

function handleNew(socket, msg) {
	socket.state = "NO-AUTH";

	if (msg.type == 'key' && msg.key) {
		if (msg.key == 'debug') {
			keys['debug'] = 'DEBUG-OPER';
		}

		if (msg.key in keys) {
			socket.state = "AUTHED";
			socket.authenticated = true;
			socket.username = keys[msg.key];
			socket.key = msg.key;
			delete keys[msg.key];
			clients.push(socket);

			console.log('DEBUG: Logon %s (key = %s)', socket.username, socket.key);
			send(socket, { type: 'user', username: socket.username });
			send(socket, { type: 'join', nick: socket.username });
			sendStatus(socket);
			broadcast(socket, {type: 'join', nick: socket.username});
		}
		else {
			console.log('ERROR: Auth fail');
			socket.destroy();
		}
	}

	else if (msg.type == 'auth' && msg.username && msg.password) {
		auth(msg.username, msg.password, function (success) {
			if (!success) {
				console.log('ERROR: Failed auth attempt for user %s', msg.username);
				socket.destroy();
				return;
			}
			socket.state = "WAIT-KEY";
			var key = generateKey();
			keys[key] = msg.username;
			socket.write(key);
			socket.destroy();
			setTimeout(function() {
				socket.state = "KEY-TIMEOUT";
				if (!getSocketByUsername(msg.username)) {
					delete keys[key];
					console.log('ERROR: Connection for key %s timed out!', key);
				}
			}, keyWindow);
		});
	}

	else {
		console.log('ERROR: Unauthenticated client tried to use API');
		socket.destroy();
	}
}

function sendUsers(socket) {
	var response = {
		type: 'users',
		users: {}
	};
	for (var i=0; i<clients.length; i++) {
		if (clients[i].username in response.users)
			response.users[clients[i].username]++;
		else
			response.users[clients[i].username] = 1;
	}
	send(socket, response);
}

function sendStatus(socket) {
	var response = {
		type: 'status',
		uptime: Math.floor((new Date().getTime() / 1000) - serverStart),
		users: clients.length
	};
	send(socket, response);
}

function createNewThread(username, title, body, ttl) {
	ttl = parseInt(ttl);
	if (title.length<1 || body.length<1 || ttl<1)
		return false;

	var thread = {
		'id': generateThreadID(),
		'username': username,
		'title': title.substring(0, maxThreadTitle),
		'body': body,
		'ttl': ttl,
		'created': Date.now(),
		'messages': []
	};

	return thread;
}

function postMessage(thread, username, message) {
	if (message.length == 0)
		return false;

	var post = {
		'username': username,
		'message': message
	};
	thread.messages.push(post);
	return thread;
}

function handleMessage(socket, msg) {
	if (socket.authenticated == false) {
		return handleNew(socket, msg);
	}

	// General commands

	if (msg.type == 'quit') {
		kill(socket, 'Quit');
	}

	else if (msg.type == 'users') {
		sendUsers(socket);
	}

	else if (msg.type == 'status') {
		sendStatus(socket);
	}

	else if (msg.type == 'password') {
		changePassword(socket, msg);
	}

	// Chat commands

	else if (msg.type == 'pubmsg') {
		broadcast(socket, { type: 'pubmsg', nick: socket.username, body: msg.body });
	}

	else if (msg.type == 'privmsg') {
		if (msg.target) {
			var target = getSocketByUsername(msg.target);
			if (target) {
				send(target, { type: 'privmsg', nick: socket.username, body: msg.body });
			}
			else {
				send(socket, { type: 'error', body: 'No such user' });
			}
		}
	}

	// BBS commands
	else if (msg.type == 'threads') {
		var topics = [];
		for (var id in threads) {
			topics.push(threads[id]);
		}
		var now = Date.now();
		topics.sort(function (a, b) {
			var tA = a.ttl - (now - a.created);
			var tB = b.ttl - (now - b.created);
			return (tA-tB);
		});
		send(socket, { type: 'threads', body: topics });
	}

	else if (msg.type == 'thread') {
		if (msg.thread && msg.thread in threads) {
			send(socket, { type: 'thread', body: threads[msg.thread] });
		}
		else {
			send(socket, { type: 'error', body: 'No such thread' });
		}
	}

	else if (msg.type == 'new') {
		if (!msg.title || !msg.body || !msg.ttl) {
			send(socket, { type: 'error', body: 'Cannot create thread: invalid parameters' });
		}
		else {
			var thread = createNewThread(socket.username, msg.title, msg.body, msg.ttl);
			if (thread) {
				threads[thread.id] = thread;
				send(socket, { type: 'thread', body: thread });
			}
			else {
				send(socket, { type: 'error', body: 'Could not create thread' });
			}
		}
	}

	else if (msg.type == 'delete') {
		if (msg.thread && msg.thread in threads) {
			var thread = threads[msg.thread];
			if (thread.username === socket.username) {
				delete threads[msg.thread];
				send(socket, { type: 'delete', body: 'Thread deleted' });
			}
			else {
				send(socket, { type: 'error', body: 'Cannot delete thread: no privileges' });
			}
		}
		else {
			send(socket, { type: 'error', body: 'No such thread' });
		}
	}

	else if (msg.type == 'post') {
		if (msg.thread && msg.thread in threads && msg.body) {
			var thread = threads[msg.thread];
			if (!postMessage(thread, socket.username, msg.body)) {
				send(socket, { type: 'error', body: 'Cannot post to thread' });
			}
			else {
				send(socket, { type: 'thread', body: thread });
			}
		}
		else {
			send(socket, { type: 'error', body: 'No such thread' });
		}
	}
}

var server = net.createServer(function (socket) {
	socket.authenticated = false;
	socket.username = false;
	socket.key = false;
	socket.state = "CREATED";

	socket.on('data', function (data) {
		// console.log('onData',  data.toString());
		var buffer = data.toString();
		var lines = buffer.split('\n');
		for (var i=0; i<lines.length; i++) {
			if (lines[i].length == 0)
				continue;
			try {
				var msg = JSON.parse(lines[i]);
				console.log('\tMSG#%s: ', i, msg);
				handleMessage(socket, msg);
			}
			catch (e) {
				console.log('EXCEPTION!\n');
				console.log('\t', e.message);
				console.log('\t', e.stack);
				console.log('ERROR: Unable to parse message: ', data.toString());
				kill(socket, 'Killed: indecent hacking');
			}
		}
	});


	socket.on('end', function() {
		console.log('DEBUG: Connection terminated: %s (%s)', socket.username, socket.state);
		kill(socket, 'Connection terminated');
	});

	socket.on('error', function(error) {
		console.log('DEBUG: Socket error: ', error);
		kill(socket, 'Connection error');
	});
});

function send(socket, data) {
	var message = JSON.stringify(data) + '\n';
	socket.write(message);
}

function broadcast(from, data) {
	if (clients.length === 0) {
		console.log('DEBUG: No clients, no broadcast');
		return;
	}

	var message = JSON.stringify(data) + '\n';
	clients.forEach(function (socket, index) {
		if (socket === from)
			return;
		socket.write(message);
	});
};

function kill(socket, message) {
	socket.destroy();
	removeSocket(socket);
	delete keys[socket.key];

	if (socket.authenticated) {
		if (!message)
			message = 'Killed for no reason';
		broadcast(socket, { type: 'quit', nick: socket.username, body: message});
	}

	socket.authenticated = false;
	socket.username = false;
	socket.key = false;
}

function removeSocket(socket) {
	var client = clients.indexOf(socket);
	if (client != -1) {
		clients.splice(client, 1);
		return true;
	}
	console.log('WARNING: removeSocket called on socket that was not in the list', socket.name);
	return false;
}

function getSocketByUsername(username) {
	for (var i=0; i<clients.length; i++) {
		if (clients[i].username === username)
			return clients[i];
	}
	return false;
}

server.on('error', function(error) {
	console.log("Server error:", error.message);
});

server.listen(port, '127.0.0.1', function() {
	serverStart = new Date().getTime() / 1000;
	console.log("Server listening at localhost:" + port);

	// var thread = createNewThread('nsa', 'Hardcoded sticky thread', 'NSA Rules', 120*1000);
	// threads[thread.id] = thread;
	// var thread = createNewThread('nobody', 'Lol wat', 'Message body', 120*1000);
	// threads[thread.id] = thread;
	// var thread = createNewThread('bob', 'This thread will be here for a while', 'A-yup', 60*60*72*1000);
	// threads[thread.id] = thread;
	// var thread = createNewThread('eve', '2h thread', 'Early bird special', 60*60*2*1000);
	// threads[thread.id] = thread;
});

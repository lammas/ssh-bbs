var fs = require('fs');
var levelup = require('level');
var bcrypt = require('bcrypt');

var DB_LOCK_FILE = './auth.lock';

if (process.argv.length != 4) {
	console.log('Usage: node add-user <username> <password>');
	process.exit(0);
}

var username = process.argv[2];
var password = process.argv[3];

if (username.length<1) {
	console.log('ERROR: Invalid username');
	process.exit(0);
}

// if (password.length<8) {
// 	console.log('ERROR: Password too short');
// 	process.exit(0);
// }

if (fs.existsSync(DB_LOCK_FILE)) {
	console.log('ERROR: Database locked. Try later or remove the lock manually if the server is not running.');
	process.exit(0);
}

fs.closeSync(fs.openSync(DB_LOCK_FILE, 'w'));

var db = levelup('./auth.db');
db.get(username, function (err, value) {
	if (value) {
		console.log('ERROR: user %s already exists.', username);
		fs.unlinkSync(DB_LOCK_FILE);
		db.close();
		return;
	}

	var salt = bcrypt.genSaltSync(10);
	var hash = bcrypt.hashSync(password, salt);

	db.put(username, hash, function (err) {
		db.close();
		fs.unlinkSync(DB_LOCK_FILE);
		if (err)
			return console.log('ERROR: DB I/O error: ', err);
		console.log('Added user %s', username);
	});
});

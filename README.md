# ssh-bbs
Terminal chat and BBS implemented with libssh and node.js

_Currently in a very alpha stage of development and a bit broken due to changes in the blessed library. Will be fixed soon._


# Building

C dependencies:
* libssh

Node.js dependencies:
* blessed
* level
* bcrypt
* winston (debugging)

Steps for building:

	sudo apt-get install libssh-dev
	npm install


# Usage

First generate keys (no passphrase is required):

	./gen-keys.sh

Add users:

	node add-user alice 5ecR37P4$$w0rD

Start the ssh-gateway:

	./bin/ssh-gateway 127.0.0.1 3333

Start the backend:

	node server.js &

Log in:

	ssh -p 3333 alice@127.0.0.1

#include "config.h"

#include <libssh/callbacks.h>
#include <libssh/poll.h>
#include <libssh/server.h>

#include <fcntl.h>
#ifdef HAVE_LIBUTIL_H
#include <libutil.h>
#endif
#ifdef HAVE_PTY_H
#include <pty.h>
#endif
#include <signal.h>
#include <stdlib.h>
#ifdef HAVE_UTMP_H
#include <utmp.h>
#endif
#ifdef HAVE_UTIL_H
#include <util.h>
#endif
#include <sys/ioctl.h>
#include <sys/wait.h>

#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <string.h>

#include <stdio.h>

#define LISTEN_ADDR "127.0.0.1"
#define LISTEN_PORT "3333"

#define DSA_KEY "keys/host_dsa"
#define RSA_KEY "keys/host_rsa"

#define KEYS_FOLDER "/etc/ssh/"

#define BUF_SIZE 1048576
#define SESSION_END (SSH_CLOSED | SSH_CLOSED_ERROR)

/* A userdata struct for channel. */
struct channel_data_struct {
	/* pid of the child process the channel will spawn. */
	pid_t pid;
	/* For PTY allocation */
	socket_t pty_master;
	socket_t pty_slave;
	/* For communication with the child process. */
	socket_t child_stdin;
	socket_t child_stdout;
	/* Only used for subsystem and exec requests. */
	socket_t child_stderr;
	/* Event which is used to poll the above descriptors. */
	ssh_event event;
	/* Terminal size struct. */
	struct winsize *winsize;

	void* sdata;
};

/* A userdata struct for session. */
struct session_data_struct {
	/* Pointer to the channel the session will allocate. */
	ssh_channel channel;
	int auth_attempts;
	int authenticated;
	char key[65];
};

static int data_function(ssh_session session, ssh_channel channel, void *data,
						 uint32_t len, int is_stderr, void *userdata) {
	struct channel_data_struct *cdata = (struct channel_data_struct *) userdata;

	(void) session;
	(void) channel;
	(void) is_stderr;

	if (len == 0 || cdata->pid < 1 || kill(cdata->pid, 0) < 0) {
		return 0;
	}

	return write(cdata->child_stdin, (char *) data, len);
}

static int pty_request(ssh_session session, ssh_channel channel,
					   const char *term, int cols, int rows, int py, int px,
					   void *userdata) {
	struct channel_data_struct *cdata = (struct channel_data_struct *)userdata;

	(void) session;
	(void) channel;
	(void) term;

	cdata->winsize->ws_row = rows;
	cdata->winsize->ws_col = cols;
	cdata->winsize->ws_xpixel = px;
	cdata->winsize->ws_ypixel = py;

	if (openpty(&cdata->pty_master, &cdata->pty_slave, NULL, NULL,
				cdata->winsize) != 0) {
		fprintf(stderr, "Failed to open pty\n");
		return SSH_ERROR;
	}
	return SSH_OK;
}

static int pty_resize(ssh_session session, ssh_channel channel, int cols,
					  int rows, int py, int px, void *userdata) {
	struct channel_data_struct *cdata = (struct channel_data_struct *)userdata;

	(void) session;
	(void) channel;

	cdata->winsize->ws_row = rows;
	cdata->winsize->ws_col = cols;
	cdata->winsize->ws_xpixel = px;
	cdata->winsize->ws_ypixel = py;

	if (cdata->pty_master != -1) {
		return ioctl(cdata->pty_master, TIOCSWINSZ, cdata->winsize);
	}

	return SSH_ERROR;
}

static int exec_pty(struct channel_data_struct *cdata) {
	struct session_data_struct *sdata = (struct session_data_struct *)cdata->sdata;

	switch(cdata->pid = fork()) {
		case -1:
			close(cdata->pty_master);
			close(cdata->pty_slave);
			fprintf(stderr, "Failed to fork\n");
			return SSH_ERROR;
		case 0:
			close(cdata->pty_master);
			if (login_tty(cdata->pty_slave) != 0) {
				exit(1);
			}
			execl("/usr/bin/node", "node", "bbs.js", sdata->key, NULL);
			exit(0);
		default:
			close(cdata->pty_slave);
			/* pty fd is bi-directional */
			cdata->child_stdout = cdata->child_stdin = cdata->pty_master;
	}
	return SSH_OK;
}

static int shell_request(ssh_session session, ssh_channel channel,
						 void *userdata) {
	struct channel_data_struct *cdata = (struct channel_data_struct *) userdata;

	(void) session;
	(void) channel;

	if(cdata->pid > 0) {
		return SSH_ERROR;
	}

	if (cdata->pty_master != -1 && cdata->pty_slave != -1) {
		return exec_pty(cdata);
	}
	/* Client requested a shell without a pty, let's pretend we allow that */
	return SSH_OK;
}

static int getkey(const char* username, const char* password, char* key) {
#define SENDBUF_SIZE 256
#define RECVBUF_SIZE 128

	int sockfd, n;
	struct sockaddr_in servaddr;
	char sendbuf[SENDBUF_SIZE];
	char recvbuf[128];
	const char* format = "{\"type\":\"auth\",\"username\":\"%s\",\"password\":\"%s\"}";

	if (strlen(username) == 0 || strlen(username) > 32)
		return 0;
	if (strlen(password) == 0 || strlen(password) > 64)
		return 0;

	n = snprintf(sendbuf, SENDBUF_SIZE, format, username, password);
	if (n>SENDBUF_SIZE)
		return 0;

	memset(&servaddr, 0, sizeof(servaddr));
	servaddr.sin_family = AF_INET;
	servaddr.sin_addr.s_addr = inet_addr("127.0.0.1");
	servaddr.sin_port = htons(8420);

	sockfd = socket(AF_INET,SOCK_STREAM, 0);
	connect(sockfd, (struct sockaddr *)&servaddr, sizeof(servaddr));

	sendto(sockfd, sendbuf, strlen(sendbuf), 0, (struct sockaddr *)&servaddr, sizeof(servaddr));
	n = recvfrom(sockfd, recvbuf, RECVBUF_SIZE, 0, NULL, NULL);
	if (n!=64)
		return 0;

	recvbuf[n] = 0;
	memcpy(key, recvbuf, 65);
	return 1;

#undef SENDBUF_SIZE
#undef RECVBUF_SIZE
}


static int auth_password(ssh_session session, const char *user,
						 const char *pass, void *userdata) {
	struct session_data_struct *sdata = (struct session_data_struct *) userdata;
	(void) session;

	memset(sdata->key, 0, 65);
	if (getkey(user, pass, sdata->key)) {
		sdata->authenticated = 1;
		return SSH_AUTH_SUCCESS;
	}

	sdata->auth_attempts++;
	return SSH_AUTH_DENIED;
}

static ssh_channel channel_open(ssh_session session, void *userdata) {
	struct session_data_struct *sdata = (struct session_data_struct *) userdata;

	sdata->channel = ssh_channel_new(session);
	return sdata->channel;
}

static int process_stdout(socket_t fd, int revents, void *userdata) {
	char buf[BUF_SIZE];
	int n = -1;
	ssh_channel channel = (ssh_channel) userdata;

	if (channel != NULL && (revents & POLLIN) != 0) {
		n = read(fd, buf, BUF_SIZE);
		if (n > 0) {
			ssh_channel_write(channel, buf, n);
		}
	}

	return n;
}

static int process_stderr(socket_t fd, int revents, void *userdata) {
	char buf[BUF_SIZE];
	int n = -1;
	ssh_channel channel = (ssh_channel) userdata;

	if (channel != NULL && (revents & POLLIN) != 0) {
		n = read(fd, buf, BUF_SIZE);
		if (n > 0) {
			ssh_channel_write_stderr(channel, buf, n);
		}
	}

	return n;
}

static void handle_session(ssh_event event, ssh_session session) {
	int n, rc;

	/* Structure for storing the pty size. */
	struct winsize wsize = {
		.ws_row = 0,
		.ws_col = 0,
		.ws_xpixel = 0,
		.ws_ypixel = 0
	};

	/* Our struct holding information about the channel. */
	struct channel_data_struct cdata = {
		.pid = 0,
		.pty_master = -1,
		.pty_slave = -1,
		.child_stdin = -1,
		.child_stdout = -1,
		.child_stderr = -1,
		.event = NULL,
		.winsize = &wsize,
		.sdata = NULL
	};

	/* Our struct holding information about the session. */
	struct session_data_struct sdata = {
		.channel = NULL,
		.auth_attempts = 0,
		.authenticated = 0
	};

	struct ssh_channel_callbacks_struct channel_cb = {
		.userdata = &cdata,
		.channel_pty_request_function = pty_request,
		.channel_pty_window_change_function = pty_resize,
		.channel_shell_request_function = shell_request,
		.channel_data_function = data_function
	};

	struct ssh_server_callbacks_struct server_cb = {
		.userdata = &sdata,
		.auth_password_function = auth_password,
		.channel_open_request_session_function = channel_open,
	};

	cdata.sdata = &sdata;

	ssh_callbacks_init(&server_cb);
	ssh_callbacks_init(&channel_cb);

	ssh_set_server_callbacks(session, &server_cb);

	if (ssh_handle_key_exchange(session) != SSH_OK) {
		fprintf(stderr, "%s\n", ssh_get_error(session));
		return;
	}

	ssh_set_auth_methods(session, SSH_AUTH_METHOD_PASSWORD);
	ssh_event_add_session(event, session);

	n = 0;
	while (sdata.authenticated == 0 || sdata.channel == NULL) {
		/* If the user has used up all attempts, or if he hasn't been able to
		 * authenticate in 10 seconds (n * 100ms), disconnect. */
		if (sdata.auth_attempts >= 3 || n >= 100) {
			return;
		}

		if (ssh_event_dopoll(event, 100) == SSH_ERROR) {
			fprintf(stderr, "%s\n", ssh_get_error(session));
			return;
		}
		n++;
	}


	ssh_set_channel_callbacks(sdata.channel, &channel_cb);

	do {
		/* Poll the main event which takes care of the session, the channel and
		 * even our child process's stdout/stderr (once it's started). */
		if (ssh_event_dopoll(event, -1) == SSH_ERROR) {
		  ssh_channel_close(sdata.channel);
		}

		/* If child process's stdout/stderr has been registered with the event,
		 * or the child process hasn't started yet, continue. */
		if (cdata.event != NULL || cdata.pid == 0) {
			continue;
		}
		/* Executed only once, once the child process starts. */
		cdata.event = event;
		/* If stdout valid, add stdout to be monitored by the poll event. */
		if (cdata.child_stdout != -1) {
			if (ssh_event_add_fd(event, cdata.child_stdout, POLLIN, process_stdout,
								 sdata.channel) != SSH_OK) {
				fprintf(stderr, "Failed to register stdout to poll context\n");
				ssh_channel_close(sdata.channel);
			}
		}

		/* If stderr valid, add stderr to be monitored by the poll event. */
		if (cdata.child_stderr != -1){
			if (ssh_event_add_fd(event, cdata.child_stderr, POLLIN, process_stderr,
								 sdata.channel) != SSH_OK) {
				fprintf(stderr, "Failed to register stderr to poll context\n");
				ssh_channel_close(sdata.channel);
			}
		}
	} while(ssh_channel_is_open(sdata.channel) &&
			(cdata.pid == 0 || waitpid(cdata.pid, &rc, WNOHANG) == 0));

	close(cdata.pty_master);
	close(cdata.child_stdin);
	close(cdata.child_stdout);
	close(cdata.child_stderr);

	/* Remove the descriptors from the polling context, since they are now
	 * closed, they will always trigger during the poll calls. */
	ssh_event_remove_fd(event, cdata.child_stdout);
	ssh_event_remove_fd(event, cdata.child_stderr);

	/* If the child process exited. */
	if (kill(cdata.pid, 0) < 0 && WIFEXITED(rc)) {
		rc = WEXITSTATUS(rc);
		ssh_channel_request_send_exit_status(sdata.channel, rc);
	/* If client terminated the channel or the process did not exit nicely,
	 * but only if something has been forked. */
	} else if (cdata.pid > 0) {
		kill(cdata.pid, SIGKILL);
	}

	ssh_channel_send_eof(sdata.channel);
	ssh_channel_close(sdata.channel);

	/* Wait up to 5 seconds for the client to terminate the session. */
	for (n = 0; n < 50 && (ssh_get_status(session) & SESSION_END) == 0; n++) {
		ssh_event_dopoll(event, 100);
	}
}

/* SIGCHLD handler for cleaning up dead children. */
static void sigchld_handler(int signo) {
	(void) signo;
	while (waitpid(-1, NULL, WNOHANG) > 0);
}

int main(int argc, char **argv) {
	ssh_bind sshbind;
	ssh_session session;
	ssh_event event;
	struct sigaction sa;

	/* Set up SIGCHLD handler. */
	sa.sa_handler = sigchld_handler;
	sigemptyset(&sa.sa_mask);
	sa.sa_flags = SA_RESTART | SA_NOCLDSTOP;
	if (sigaction(SIGCHLD, &sa, NULL) != 0) {
		fprintf(stderr, "Failed to register SIGCHLD handler\n");
		return 1;
	}

	ssh_init();
	sshbind = ssh_bind_new();
	ssh_bind_options_set(sshbind, SSH_BIND_OPTIONS_RSAKEY, RSA_KEY);
	// ssh_bind_options_set(sshbind, SSH_BIND_OPTIONS_DSAKEY, DSA_KEY);
	// ssh_bind_options_set(sshbind, SSH_BIND_OPTIONS_ECDSAKEY, KEYS_FOLDER "ssh_host_ecdsa_key");

	ssh_bind_options_set(sshbind, SSH_BIND_OPTIONS_BINDADDR, LISTEN_ADDR);
	ssh_bind_options_set(sshbind, SSH_BIND_OPTIONS_BINDPORT_STR, LISTEN_PORT);

	ssh_bind_options_set(sshbind, SSH_BIND_OPTIONS_LOG_VERBOSITY_STR, "2");

	if(ssh_bind_listen(sshbind) < 0) {
		fprintf(stderr, "%s\n", ssh_get_error(sshbind));
		return 1;
	}

	while (1) {
		session = ssh_new();
		if (session == NULL) {
			fprintf(stderr, "Failed to allocate session\n");
			continue;
		}

		/* Blocks until there is a new incoming connection. */
		if(ssh_bind_accept(sshbind, session) != SSH_ERROR) {
			switch(fork()) {
				case 0:
					/* Remove the SIGCHLD handler inherited from parent. */
					sa.sa_handler = SIG_DFL;
					sigaction(SIGCHLD, &sa, NULL);
					/* Remove socket binding, which allows us to restart the
					 * parent process, without terminating existing sessions. */
					ssh_bind_free(sshbind);

					event = ssh_event_new();
					if (event != NULL) {
						/* Blocks until the SSH session ends by either
						 * child process exiting, or client disconnecting. */
						handle_session(event, session);
						ssh_event_free(event);
					} else {
						fprintf(stderr, "Could not create polling context\n");
					}
					ssh_disconnect(session);
					ssh_free(session);

					exit(0);
				case -1:
					fprintf(stderr, "Failed to fork\n");
			}
		} else {
			fprintf(stderr, "%s\n", ssh_get_error(sshbind));
		}
		/* Since the session has been passed to a child fork, do some cleaning
		 * up at the parent process. */
		ssh_disconnect(session);
		ssh_free(session);
	}

	ssh_bind_free(sshbind);
	ssh_finalize();
	return 0;
}

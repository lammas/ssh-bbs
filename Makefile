CXX = gcc
# CFLAGS = -Wall -std=c11 -O3 -Iinclude -Isrc -D_POSIX_C_SOURCE=200809L
CFLAGS = -Wall -std=c11 -ggdb -Iinclude -Isrc -D_POSIX_C_SOURCE=200809L
LFLAGS = -s -lssh -lz -lutil
OUTFILE = bin/ssh-gateway

OBJS = obj/gateway.o

all: makedirs $(OUTFILE)

makedirs:
	mkdir -p obj

$(OUTFILE) : $(OBJS)
	$(CXX) $(OBJS) -o $(OUTFILE) $(LFLAGS)

obj/%.o : src/%.c
	gcc $(CFLAGS) -c $< -o $@

.PHONY: clean
clean:
	rm -rf $(OUTFILE) $(OBJS)

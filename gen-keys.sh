#!/bin/sh

ssh-keygen -t rsa -b 4096 -f keys/host_rsa
ssh-keygen -t dsa -b 1024 -f keys/host_dsa

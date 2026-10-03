#!/bin/sh
unset ELECTRON_RUN_AS_NODE
exec zypak-wrapper /app/inlark/inlark "$@"

#!/bin/sh
# usage: views.sh file scale prefix "name:cx,cz,tx,tz" ...
F=$1; SC=$2; P=$3; shift 3
for v in "$@"; do n=${v%%:*}; c=${v#*:}; IFS=, read cx cz tx tz <<E
$c
E
timeout 220 node shot.mjs "http://127.0.0.1:5173/view.html?f=$F&s=$SC&cx=$cx&cy=1.55&cz=$cz&tx=$tx&ty=1.3&tz=$tz" /tmp/claude-0/-home-claude/13eee734-fa76-535d-be03-3a170d27c6f5/scratchpad/$P-$n.png >/dev/null 2>&1; echo done $n; done

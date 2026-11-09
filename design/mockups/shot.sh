#!/bin/sh
# usage: shot.sh <page> <theme> <out.png>   (headless Chrome screenshot of the whole board)
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DIR="$(cd "$(dirname "$0")" && pwd)"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=2300,2000 --virtual-time-budget=3000 \
  --screenshot="$3" "file://$DIR/$1.html?theme=$2" >/dev/null 2>&1

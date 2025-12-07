#!/bin/bash

CITIES=(
  "Berlin"
  "Warsaw"
  "Chicago"
  "Miami"
  "London"
  "Paris"
)

# Pick a random city
CURRENT_CITY=${CITIES[$RANDOM % ${#CITIES[@]}]}

echo "Switching to $CURRENT_CITY..."

protonvpn disconnect

protonvpn connect --city "$CURRENT_CITY"
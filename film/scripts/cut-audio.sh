#!/usr/bin/env bash
# Build the 60 second bar-aligned edit of Specimen_Room.mp3.
#
# THE GRID, measured rather than assumed
# --------------------------------------
# Two section boundaries in the track are unambiguous at 20 ms resolution:
#
#   240.000 s   the return out of the breakdown. 239.95 s reads -28.1 dB and
#               240.00 s reads -10.8 dB. A 17 dB step inside one 50 ms block.
#   208.000 s   the last strong downbeat of the full section before the drop.
#               The drop itself is a decay, not a cut, so the hit is the anchor.
#
# They are 32.000 s apart, which is 16 bars. That forces the tempo to exactly
# 120.000 BPM, the bar to exactly 2.000 s, and the bar to exactly 60 frames at
# 30 fps. Downbeats are at 208.000 + 2n.
#
# An earlier pass put the tempo at 120.0597 with zero phase, from a comb over
# the whole file. That estimate was weak (comb energy 0.31) because the intro
# and the breakdown are in it, and it was one bar out on both boundaries. The
# clean-region estimate that replaced it locked onto the track's offbeat tick
# instead. The two section edges are worth more than either: they are loud,
# sharp, and were never fitted to.
#
# THE EDIT
# --------
# The film needs 30 bars. The breakdown is 16 bars and half the film spent in
# it would fight a cut that is meant to move, so it is halved with one splice:
#
#   segment A   188.000 s + 28.000 s   14 bars: 10 into the drop, 4 after it
#   segment B   232.000 s + 32.000 s   16 bars: 4 of ramp, 12 of the return
#
# The joint is 216.000 s to 232.000 s. Both sit at about -23.5 dB, measured —
# the quietest pair of bar lines available, and the easiest place in the track
# to hide a cut. A 24 ms fade either side removes the click.
#
# Seeking is done on decoded PCM, never on the MP3: -ss on an MP3 lands on the
# nearest encoded frame, and at 48 kHz those are 24 ms apart.
set -euo pipefail

SRC="${1:-public/Specimen_Room.mp3}"
OUT="${2:-public/specimen-cut.m4a}"

tmp=$(mktemp -d)
ffmpeg -v error -i "$SRC" -ac 2 -ar 48000 -c:a pcm_s16le "$tmp/full.wav" -y
PCM="$tmp/full.wav"

cut () { # start len out
  ffmpeg -v error -ss "$1" -t "$2" -i "$PCM" \
    -af "afade=t=in:st=0:d=0.024,afade=t=out:st=$(python3 -c "print($2-0.024)"):d=0.024" \
    -c:a pcm_s16le "$3" -y
}
cut 188.000 28.000 "$tmp/a.wav"
cut 232.000 32.000 "$tmp/b.wav"

printf "file '%s'\nfile '%s'\n" "$tmp/a.wav" "$tmp/b.wav" > "$tmp/list.txt"
ffmpeg -v error -f concat -safe 0 -i "$tmp/list.txt" -c:a aac -b:a 192k "$OUT" -y
rm -rf "$tmp"

echo -n "duration: "
ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$OUT"

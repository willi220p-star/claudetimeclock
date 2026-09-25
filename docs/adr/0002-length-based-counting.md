# 0002 Length-based hours counting

Status: accepted (2026-09-25)

## Context
Interns often start a little early or late. Counting only time inside the scheduled window would punish an 8:30 start on a 9:00 schedule.

## Decision
A day counts by length, not by window. `countable = min(worked, 600)`, `base = min(countable, scheduled)`, and anything above the scheduled length becomes an overtime request that a supervisor approves in full or in part. **Late** (first clock-in more than 15 minutes after the scheduled start) is punctuality only and never reduces hours.

An auto-closed shift is closed at its own clock-in time, so it counts 0 until a punch fix is approved (security review, loophole 8; this overrides the build prompt's R5.5.1 "close at scheduled end").

## Consequences
The hours report reflects real time worked. Overtime always has a human decision behind it.
